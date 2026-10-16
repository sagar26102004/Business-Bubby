-- 0030 — Card reads carry the catalog preview again.
--
-- WHY: 0027 made `businesses.card` (card_doc: the document minus the six
-- catalogs, PLUS a preview of each — the first priced item per category — and
-- `catalogCounts`). The card on Explore leads with that preview and its door
-- ("Banana Shake ₹120 · 🛒 Order", src/features/businesses/BusinessCard.tsx
-- reads `offeringBuckets(business)[0]`). 0029 then rebuilt `business_cards`,
-- `nearby_cards` and `offer_cards` on `data - 'menu' - … - 'portfolio'`, which
-- drops the previews AND the counts, so every card in Explore, the map, search
-- and the ad slot lost its lead item and its Order/Buy/Request button.
--
-- This puts `b.card` back as the card document in all three. Same columns,
-- same types, same signatures — CREATE OR REPLACE is enough. The stored card is
-- smaller on disk than the stripped document it replaces (preview lists are
-- short), so this costs no egress.

create or replace view public.business_cards
with (security_invoker = true) as
select
  b.id,
  b.card as data,
  r.rating_avg,
  r.rating_count,
  b.owner_id,
  b.listing_active
from public.businesses b
left join public.business_ratings r on r.business_id = b.id;

grant select on public.business_cards to anon, authenticated;

create or replace function public.nearby_cards(
  p_lat double precision,
  p_lng double precision,
  p_radius_km double precision default 20,
  p_min_count int default 100,
  p_exclude_types text[] default '{item}',
  p_types text[] default null,
  p_tags text[] default null,
  p_sort text default 'shuffle',
  p_seed int default 0,
  p_offset int default 0,
  p_limit int default 20
)
returns table (data jsonb, rating_avg double precision, rating_count int, distance_km double precision)
language sql
stable
set search_path = public
as $$
  with pool as (
    select p.*, r.rating_avg, r.rating_count,
      coalesce(r.rating_avg, 0) * log(1 + coalesce(r.rating_count, 0)) as score,
      md5(p_seed::text || p.id::text) as shuffle
    from public.nearby_pool(p_lat, p_lng, p_radius_km, p_min_count, p_exclude_types) p
    left join public.business_ratings r on r.business_id = p.id
    where (p_types is null and p_tags is null)
       or p.type = any(coalesce(p_types, '{}'))
       or p.tags_lc && coalesce(p_tags, '{}')
  ),
  page as (
    select * from pool
    order by
      case when p_sort = 'nearest' then round((coalesce(distance_km, 1e9) * 100)::numeric) end nulls last,
      case when p_sort = 'popular' then score end desc nulls last,
      shuffle
    offset greatest(p_offset, 0) limit least(greatest(p_limit, 0), 100)
  )
  select b.card, page.rating_avg, page.rating_count, page.distance_km
  from page join public.businesses b on b.id = page.id
  order by
    case when p_sort = 'nearest' then round((coalesce(page.distance_km, 1e9) * 100)::numeric) end nulls last,
    case when p_sort = 'popular' then page.score end desc nulls last,
    page.shuffle;
$$;

create or replace function public.offer_cards()
returns table (data jsonb)
language sql
stable
set search_path = public
as $$
  select b.card
  from public.businesses b
  where b.data -> 'offers' is not null and b.data -> 'offers' <> '[]'::jsonb;
$$;

grant execute on function public.nearby_cards(double precision, double precision, double precision, int, text[], text[], text[], text, int, int, int) to anon, authenticated;
grant execute on function public.offer_cards() to anon, authenticated;

-- 0029 — Explore's feed, one page at a time, ranked in the database.
--
-- WHY: Explore used to download EVERY business card (0026's business_cards) and
-- rank them on the phone. Fine at 600 listings; at 40,000 (the bulk import of
-- 16 Oct 2026) it is ~60 MB in 41 sequential requests before the first card
-- shows — and that egress alone would spend the free plan's 5 GB in ~80 opens.
-- Now the phone asks for 20, then 10 more as it scrolls.
--
--   nearby_cards(...)    one page of the feed: the same ring rule, category
--                        filter and three orders Explore had (shuffle / nearest /
--                        popular), as card documents with the rating joined on.
--   nearby_summary(...)  the numbers the header needs from the WHOLE feed: how
--                        many in total, per browse category (the chip counts),
--                        and how far the list reaches ("Within N km").
--
-- THE RING (was HOME_RADIUS_KM / HOME_MIN_COUNT in app/(tabs)/index.tsx): every
-- listing within p_radius_km of the point — unless that's fewer than
-- p_min_count, then the p_min_count nearest. With no point: p_min_count of them.
-- A null p_radius_km means no ring: every listing (the category pages, the map
-- uses the visible area as its radius and p_min_count 0).
--
-- lat / lng / tags_lc are stored generated columns so the ranking never has to
-- open the jsonb document of every row; the whole document is read only for
-- the page that is returned. Mirrors domain/nearby.ts (the mock and Path B's
-- client use that) — keep the two in step.
--
-- Everything here is public listing data, readable by anyone already (0002);
-- both functions are security INVOKER, so they read under the caller's RLS.

create or replace function public.jsonb_tags_lc(tags jsonb)
returns text[]
language sql
immutable
set search_path = public
as $$
  select coalesce(array_agg(lower(btrim(t))), '{}')
  from jsonb_array_elements_text(case when jsonb_typeof(tags) = 'array' then tags else '[]'::jsonb end) t;
$$;

alter table public.businesses
  add column if not exists lat double precision
    generated always as ((data -> 'location' -> 'point' ->> 'latitude')::double precision) stored,
  add column if not exists lng double precision
    generated always as ((data -> 'location' -> 'point' ->> 'longitude')::double precision) stored,
  add column if not exists tags_lc text[]
    generated always as (public.jsonb_tags_lc(data -> 'tags')) stored;

create index if not exists businesses_nearby_idx on public.businesses (lat, lng) include (type, tags_lc);

/** Great-circle distance in km (the same haversine as lib/geo.ts). */
create or replace function public.km_between(lat1 double precision, lng1 double precision, lat2 double precision, lng2 double precision)
returns double precision
language sql
immutable
as $$
  select 2 * 6371 * asin(sqrt(
    power(sin(radians(lat2 - lat1) / 2), 2) +
    cos(radians(lat1)) * cos(radians(lat2)) * power(sin(radians(lng2 - lng1) / 2), 2)
  ));
$$;

/**
 * The feed's pool: (id, type, tags_lc, distance_km) of every listing the ring
 * admits, before any category filter. Shared by both functions below.
 */
create or replace function public.nearby_pool(
  p_lat double precision,
  p_lng double precision,
  p_radius_km double precision,
  p_min_count int,
  p_exclude_types text[]
)
returns table (id uuid, type text, tags_lc text[], distance_km double precision)
language sql
stable
set search_path = public
as $$
  with base as (
    select b.id, b.type, b.tags_lc,
      case when p_lat is null or b.lat is null then null
           else public.km_between(p_lat, p_lng, b.lat, b.lng) end as distance_km
    from public.businesses b
    where not (b.type = any(coalesce(p_exclude_types, '{}')))
  ),
  -- p_radius_km null = no ring at all (the category pages): every listing.
  ring as (
    select count(*) as n from base where p_radius_km is null or distance_km <= p_radius_km
  )
  select x.id, x.type, x.tags_lc, x.distance_km from base x, ring
  where ring.n >= p_min_count and (p_radius_km is null or x.distance_km <= p_radius_km)
  union all
  select y.id, y.type, y.tags_lc, y.distance_km from (
    select * from base order by distance_km nulls last, id limit greatest(p_min_count, 0)
  ) y, ring
  where ring.n < p_min_count;
$$;

drop function if exists public.nearby_cards(double precision, double precision, double precision, int, text[], text[], text[], text, int, int, int);

create or replace function public.nearby_cards(
  p_lat double precision,
  p_lng double precision,
  p_radius_km double precision default 20,
  p_min_count int default 100,
  p_exclude_types text[] default '{item}',
  -- The browse category: a listing matches on ANY of its types or (lower-cased) tags.
  -- Both null = no category, everything in the pool.
  p_types text[] default null,
  p_tags text[] default null,
  -- 'shuffle' (seeded random, stable for one seed) | 'nearest' | 'popular'
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
      -- Popular = a rating weighted by how many gave it (one 5★ doesn't beat a hundred 4.7s).
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
  select b.data - 'menu' - 'products' - 'services' - 'plans' - 'rentals' - 'portfolio',
    page.rating_avg, page.rating_count, page.distance_km
  from page join public.businesses b on b.id = page.id
  order by
    case when p_sort = 'nearest' then round((coalesce(page.distance_km, 1e9) * 100)::numeric) end nulls last,
    case when p_sort = 'popular' then page.score end desc nulls last,
    page.shuffle;
$$;

create or replace function public.nearby_summary(
  p_lat double precision,
  p_lng double precision,
  p_radius_km double precision default 20,
  p_min_count int default 100,
  p_exclude_types text[] default '{item}',
  -- [{ "id": "food", "types": ["shop"], "tags": ["cafe", "bakery"] }, …], tags lower-cased.
  p_intents jsonb default '[]'
)
returns jsonb
language sql
stable
set search_path = public
as $$
  with pool as (
    select * from public.nearby_pool(p_lat, p_lng, p_radius_km, p_min_count, p_exclude_types)
  ),
  intents as (
    select i ->> 'id' as id,
      array(select jsonb_array_elements_text(coalesce(i -> 'types', '[]'))) as types,
      array(select jsonb_array_elements_text(coalesce(i -> 'tags', '[]'))) as tags
    from jsonb_array_elements(coalesce(p_intents, '[]')) i
  )
  select jsonb_build_object(
    'total', (select count(*) from pool),
    'reachKm', (select max(distance_km) from pool),
    'counts', coalesce((
      select jsonb_object_agg(i.id, (
        select count(*) from pool p where p.type = any(i.types) or p.tags_lc && i.tags
      ))
      from intents i
    ), '{}'::jsonb)
  );
$$;

grant execute on function public.nearby_cards(double precision, double precision, double precision, int, text[], text[], text[], text, int, int, int) to anon, authenticated;
grant execute on function public.nearby_summary(double precision, double precision, double precision, int, text[], jsonb) to anon, authenticated;
grant execute on function public.nearby_pool(double precision, double precision, double precision, int, text[]) to anon, authenticated;

-- ── Speed (same day): a cold first call was hitting the anon statement timeout. ──
-- The ranking needs only id/lat/lng/type/tags_lc: with id in the index the pool
-- is an index-only scan and never reads the 1.5 KB documents of 40,000 rows.
drop index if exists public.businesses_nearby_idx;
create index if not exists businesses_nearby_idx on public.businesses (lat, lng) include (id, type, tags_lc);

-- The ad slot needs only the businesses that HAVE an offer (a few dozen of
-- 40,000): a partial index finds them without a scan. Cards, like 0026.
create index if not exists businesses_has_offers_idx on public.businesses (id)
  where data -> 'offers' is not null and data -> 'offers' <> '[]'::jsonb;

create or replace function public.offer_cards()
returns table (data jsonb)
language sql
stable
set search_path = public
as $$
  select b.data - 'menu' - 'products' - 'services' - 'plans' - 'rentals' - 'portfolio'
  from public.businesses b
  where b.data -> 'offers' is not null and b.data -> 'offers' <> '[]'::jsonb;
$$;
grant execute on function public.offer_cards() to anon, authenticated;

-- business_cards gains owner_id (appended, so CREATE OR REPLACE keeps every
-- existing column): "the businesses I own" is now an indexed filter
-- (businesses_owner_idx) instead of downloading 40,000 cards to find two.
create or replace view public.business_cards
with (security_invoker = true) as
select
  b.id,
  b.data - 'menu' - 'products' - 'services' - 'plans' - 'rentals' - 'portfolio' as data,
  r.rating_avg,
  r.rating_count,
  b.owner_id
from public.businesses b
left join public.business_ratings r on r.business_id = b.id;

-- listing_active: the document's `listingActive` as a real column (missing =
-- active, like domain/listingActive.ts), so "my ACTIVE businesses" never opens
-- the documents — the super-admin owns 36,000 inactive bulk listings.
alter table public.businesses
  add column if not exists listing_active boolean
    generated always as (coalesce((data ->> 'listingActive')::boolean, true)) stored;
create index if not exists businesses_owner_active_idx on public.businesses (owner_id) where listing_active;

create or replace view public.business_cards
with (security_invoker = true) as
select
  b.id,
  b.data - 'menu' - 'products' - 'services' - 'plans' - 'rentals' - 'portfolio' as data,
  r.rating_avg,
  r.rating_count,
  b.owner_id,
  b.listing_active
from public.businesses b
left join public.business_ratings r on r.business_id = b.id;

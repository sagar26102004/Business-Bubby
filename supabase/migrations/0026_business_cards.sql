-- ===========================================================================
-- 0026 · Business cards + ratings, computed in the database
-- ===========================================================================
-- Explore and the Deals feed only draw CARDS: name, photo, tags, location,
-- offers, rating. They were downloading the whole `businesses` document for
-- every listing (8.2 MB for 605 listings on 2026-10-12, 7.3 MB of it menus and
-- product lists no card shows) and EVERY review row (3.7 MB, 15.6k rows) just to
-- average the stars on the client. On a phone that was most of a minute.
--
--   business_ratings — avg + count per business, a GROUP BY instead of a
--                      download of every review.
--   business_cards   — the business document minus its catalogs, with the
--                      rating already joined on. ~0.9 MB for the same 605.
--
-- Both are `security_invoker` views, so they read under the CALLER's RLS —
-- the same public-read policies `businesses` and `reviews` already have (0002).
-- Nothing becomes visible here that wasn't visible before.
--
-- The full document is still read from `businesses` wherever a catalog is
-- needed (the business page, search, the workspace).

create or replace view public.business_ratings
with (security_invoker = true) as
select
  business_id,
  round(avg((data ->> 'rating')::numeric), 1)::float8 as rating_avg,
  count(*)::int as rating_count
from public.reviews
group by business_id;

create or replace view public.business_cards
with (security_invoker = true) as
select
  b.id,
  b.data - 'menu' - 'products' - 'services' - 'plans' - 'rentals' - 'portfolio' as data,
  r.rating_avg,
  r.rating_count
from public.businesses b
left join public.business_ratings r on r.business_id = b.id;

grant select on public.business_ratings to anon, authenticated;
grant select on public.business_cards to anon, authenticated;

-- ===========================================================================
-- 0027 · Fast search + card previews
-- ===========================================================================
-- TWO JOBS, both about not shipping 8 MB of catalogs to a phone.
--
-- 1. CARD PREVIEWS. 0026's `business_cards` stripped the catalogs entirely, but
--    a card still shows "Popular: Masala Dosa ₹80 · 42 dishes" and an
--    Order/Buy/Enroll button — both read from the catalogs (domain/offerings.ts:
--    the first PRICED item in library-section order, and the item count).
--    So each catalog is now cut down, not cut out: per category (rentals: per
--    category + subcategory, because the app re-files old rentals by their
--    subcategory) it keeps ONE item — the first priced one, else the first —
--    with only the fields the card reads (name, price, category, basis).
--    Because the app's section sort is stable, that is always a superset of
--    what it would pick from the full list, so the card shows the same item. `catalogCounts` carries the real
--    lengths for the "42 dishes" label. Stored as a generated column, so it is
--    computed once per write, not once per read.
--
-- 2. SEARCH. People search by business NAME ("Sharma Sweets"), by KIND of
--    business ("cafe", "plumber") and by what it SELLS ("banana shake"). Search
--    used to download every full listing (8 MB) and substring-match it on the
--    phone, ranked only by distance. Now:
--      search_terms       one row per searchable term per business, with its
--                         kind (name / type / item / section / about), kept in
--                         step by a trigger on `businesses`, trigram-indexed.
--      search_businesses  ranks businesses for a query: every word is matched
--                         on its own (a typo or two forgiven), a hit on the
--                         NAME outweighs one on the TYPE, which outweighs one on
--                         an ITEM; returns the matching items so the card can
--                         say "Banana Shake ₹120".
--      search_suggest     as-you-type suggestions, each with what it is.
--    The client joins the ids to the card list it already holds (0026) and
--    breaks relevance ties by distance. Mirrors domain/search.ts — keep the
--    weights in step.
--
-- Everything here is public listing data, readable by anyone already (0002).

create extension if not exists pg_trgm with schema extensions;
create extension if not exists fuzzystrmatch with schema extensions;

-- ---------------------------------------------------------------------------
-- 1 · Card previews
-- ---------------------------------------------------------------------------

drop view if exists public.business_cards;
alter table public.businesses drop column if exists card;
drop function if exists public.card_doc(jsonb);
drop function if exists public.card_preview(jsonb);
drop function if exists public.card_preview(jsonb, boolean);
drop function if exists public.search_businesses(text, int);

create or replace function public.card_preview(items jsonb, fine boolean default false)
returns jsonb
language sql
immutable
set search_path = public
as $$
  select coalesce(jsonb_agg(p.item order by p.ord), '[]'::jsonb)
  from (
    select distinct on (
        coalesce(x ->> 'category', ''),
        case when fine then coalesce(x ->> 'subcategory', '') end,
        case when fine then coalesce(x ->> 'subcategoryId', '') end
      )
      jsonb_strip_nulls(jsonb_build_object(
        'name', x -> 'name',
        'price', x -> 'price',
        'category', x -> 'category',
        'basis', x -> 'basis',
        -- only rentals are re-filed by these (upgradeRentalFiling/rentalCategory)
        'subcategory', case when fine then x -> 'subcategory' end,
        'subcategoryId', case when fine then x -> 'subcategoryId' end
      )) as item,
      o as ord
    from jsonb_array_elements(
      case when jsonb_typeof(items) = 'array' then items else '[]'::jsonb end
    ) with ordinality as t(x, o)
    order by
      coalesce(x ->> 'category', ''),
      case when fine then coalesce(x ->> 'subcategory', '') end,
      case when fine then coalesce(x ->> 'subcategoryId', '') end,
      coalesce(x ->> 'price', '') = '',   -- priced first
      o                                   -- then as listed
  ) p
$$;

create or replace function public.card_doc(d jsonb)
returns jsonb
language sql
immutable
set search_path = public
as $$
  select (d - 'menu' - 'products' - 'services' - 'plans' - 'rentals' - 'portfolio')
    || jsonb_build_object(
      'menu', card_preview(d -> 'menu'),
      'products', card_preview(d -> 'products'),
      'services', card_preview(d -> 'services'),
      'plans', card_preview(d -> 'plans'),
      'rentals', card_preview(d -> 'rentals', true),
      'catalogCounts', jsonb_build_object(
        'menu', coalesce(jsonb_array_length(case when jsonb_typeof(d -> 'menu') = 'array' then d -> 'menu' end), 0),
        'products', coalesce(jsonb_array_length(case when jsonb_typeof(d -> 'products') = 'array' then d -> 'products' end), 0),
        'services', coalesce(jsonb_array_length(case when jsonb_typeof(d -> 'services') = 'array' then d -> 'services' end), 0),
        'plans', coalesce(jsonb_array_length(case when jsonb_typeof(d -> 'plans') = 'array' then d -> 'plans' end), 0),
        'rentals', coalesce(jsonb_array_length(case when jsonb_typeof(d -> 'rentals') = 'array' then d -> 'rentals' end), 0)
      )
    )
$$;

alter table public.businesses
  add column if not exists card jsonb generated always as (public.card_doc(data)) stored;

create or replace view public.business_cards
with (security_invoker = true) as
select
  b.id,
  b.card as data,
  r.rating_avg,
  r.rating_count
from public.businesses b
left join public.business_ratings r on r.business_id = b.id;

grant select on public.business_cards to anon, authenticated;

-- ---------------------------------------------------------------------------
-- 2 · Search index
-- ---------------------------------------------------------------------------

create table if not exists public.search_terms (
  business_id uuid not null references public.businesses (id) on delete cascade,
  -- name | type | item | section | about  (weights in search_businesses)
  kind        text not null,
  term        text not null,
  term_l      text not null,
  -- an item's price label, shown beside it in results ("Banana Shake ₹120")
  detail      text,
  primary key (business_id, kind, term_l)
);

create index if not exists search_terms_trgm
  on public.search_terms using gin (term_l extensions.gin_trgm_ops);

alter table public.search_terms enable row level security;
drop policy if exists search_terms_read on public.search_terms;
create policy search_terms_read on public.search_terms for select using (true);
-- No write policies: only the trigger below (SECURITY DEFINER) writes here.
grant select on public.search_terms to anon, authenticated;

/** Rebuild one business's rows from its document. */
create or replace function public.search_terms_refresh(p_id uuid, d jsonb)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  delete from public.search_terms where business_id = p_id;
  if d is null then return; end if;

  insert into public.search_terms (business_id, kind, term, term_l, detail)
  select distinct on (kind, lower(trim(term)))
    p_id, kind, trim(term), lower(trim(term)), detail
  from (
    select 'name' as kind, d ->> 'name' as term, null::text as detail, 1 as pri
    union all
    select 'type', d ->> 'providerType', null, 1
    union all
    select 'type', jsonb_array_elements_text(
      case when jsonb_typeof(d -> 'tags') = 'array' then d -> 'tags' else '[]'::jsonb end), null, 1
    union all
    select 'type', replace(d ->> 'subcategoryId', '-', ' '), null, 2
    union all
    select 'about', d ->> 'tagline', null, 1
    union all
    select 'about', d ->> 'description', null, 1
    union all
    -- everything the business offers, across all five lists
    select 'item', x ->> 'name', nullif(x ->> 'price', ''),
      case when coalesce(x ->> 'price', '') = '' then 2 else 1 end
    from jsonb_array_elements(
      (case when jsonb_typeof(d -> 'menu') = 'array' then d -> 'menu' else '[]'::jsonb end)
      || (case when jsonb_typeof(d -> 'products') = 'array' then d -> 'products' else '[]'::jsonb end)
      || (case when jsonb_typeof(d -> 'services') = 'array' then d -> 'services' else '[]'::jsonb end)
      || (case when jsonb_typeof(d -> 'plans') = 'array' then d -> 'plans' else '[]'::jsonb end)
      || (case when jsonb_typeof(d -> 'rentals') = 'array' then d -> 'rentals' else '[]'::jsonb end)
    ) x
    union all
    -- the folders those items are filed in ("Beverages", "Shakes", a brand)
    select 'section', s, null, 1
    from jsonb_array_elements(
      (case when jsonb_typeof(d -> 'menu') = 'array' then d -> 'menu' else '[]'::jsonb end)
      || (case when jsonb_typeof(d -> 'products') = 'array' then d -> 'products' else '[]'::jsonb end)
      || (case when jsonb_typeof(d -> 'services') = 'array' then d -> 'services' else '[]'::jsonb end)
      || (case when jsonb_typeof(d -> 'plans') = 'array' then d -> 'plans' else '[]'::jsonb end)
      || (case when jsonb_typeof(d -> 'rentals') = 'array' then d -> 'rentals' else '[]'::jsonb end)
    ) x,
    lateral unnest(
      array[x ->> 'category', x ->> 'brand']
      || string_to_array(coalesce(x ->> 'subcategory', ''), ' › ')
    ) s
  ) t
  where term is not null and length(trim(term)) between 2 and 120
  order by kind, lower(trim(term)), pri;
end;
$$;

create or replace function public.search_terms_sync()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  perform public.search_terms_refresh(new.id, new.data);
  return null;
end;
$$;

drop trigger if exists businesses_search_terms on public.businesses;
create trigger businesses_search_terms
  after insert or update of data on public.businesses
  for each row execute function public.search_terms_sync();
-- Deletes cascade through the foreign key.

-- Backfill every existing listing.
select public.search_terms_refresh(id, data) from public.businesses;

-- ---------------------------------------------------------------------------
-- 3 · Search + suggestions
-- ---------------------------------------------------------------------------

/**
 * Rank businesses for a free-text query.
 *
 * Each word (2+ letters) is matched on its own against every term of a
 * business; per word the business keeps its best hit, scored
 *   weight(kind) × quality
 * with weight  name 10 · type 7 · item 5 · section 3 · about 1
 * and quality  exact 1 · a whole word 0.9 · starts with 0.8 ·
 *              a word starts with 0.7 · contains 0.5 ·
 *              one typo (two in words of 7+ letters) 0.45.
 * Typos are judged by EDIT DISTANCE on whole words that start with the same
 * letter, not trigram similarity — similarity let "plumber" match "cucumber"
 * and "number". A term that holds several of the words ("Paneer Tikka" for
 * "paneer tika") earns a phrase bonus, and one that holds the WHOLE query
 * ("Banana Shake") a bigger one.
 *
 * Ordered by how many of the words matched, then score. `tier` is the kind of
 * the strongest hit — name 4 when the name covered every word, name/type 3,
 * item 2, section 1, about 0. `strength` is 2 when every word matched a
 * WHOLE word ("dal" in "Dal Fry"), 1 when only the start of one ("Dalchini"),
 * 0 for looser hits. The client sorts by (words, tier, strength, distance). When the query IS a business type ("cafe"), a name hit is tier 3
 * like a tag hit: a café named "Cafe Kono" is no more a café than one tagged
 * Cafe, and the nearer one should come first. `hits` are the matching items.
 */
create or replace function public.search_businesses(q text, max_results int default 100)
returns table (business_id uuid, words int, tier int, strength int, score real, hits jsonb)
language sql
stable
set search_path = public, extensions
set pg_trgm.word_similarity_threshold = 0.4
as $$
  with whole as (
    select lower(trim(regexp_replace(coalesce(q, ''), '\s+', ' ', 'g'))) w
  ),
  toks as (
    select distinct t
    from regexp_split_to_table(
      lower(regexp_replace(coalesce(q, ''), '[^[:alnum:][:space:]]+', ' ', 'g')), '\s+'
    ) t
    where length(t) >= 2
  ),
  ntok as (select count(*)::int n from toks),
  type_query as (
    select exists (
      select 1 from public.search_terms s, whole
      where s.kind = 'type' and s.term_l = whole.w
    ) yes
  ),
  raw as (
    select s.business_id, s.kind, s.term, s.detail, k.t,
      case s.kind when 'name' then 10 when 'type' then 7 when 'item' then 5
                  when 'section' then 3 else 1 end as weight,
      case
        when s.term_l = k.t then 1.0
        when s.term_l ~ ('\m' || k.t || '\M') then 0.9
        when s.term_l like k.t || '%' then 0.8
        when s.term_l ~ ('\m' || k.t) then 0.7
        when strpos(s.term_l, k.t) > 0 then 0.5
        when length(k.t) >= 4 and exists (
          select 1
          from regexp_split_to_table(s.term_l, '[^[:alnum:]]+') w
          where length(w) >= 3
            and left(w, 1) = left(k.t, 1)
            and levenshtein(left(w, 64), k.t) <= case when length(k.t) >= 7 then 2 else 1 end
        ) then 0.45
        else 0
      end as quality
    from (
      -- Two index-friendly probes instead of one OR (which forces a scan of
      -- every term): a substring hit, then a typo candidate that isn't one.
      select s.*, k.t
      from toks k
      join public.search_terms s on s.term_l like '%' || k.t || '%'
      union all
      select s.*, k.t
      from toks k
      join public.search_terms s
        on length(k.t) >= 4
       and k.t <% s.term_l
       and s.term_l not like '%' || k.t || '%'
    ) s
    cross join lateral (select s.t) k
  ),
  hit as (
    select business_id, kind, term, detail, t, weight, quality, weight * quality as pts
    from raw
    where quality > 0
  ),
  best as (   -- each business's best hit per word
    select distinct on (business_id, t) business_id, t, kind, pts, quality
    from hit
    order by business_id, t, pts desc
  ),
  phrase as ( -- one term carrying several of the words, or the whole query
    select business_id,
      max(
        weight * (c - 1) * 0.5
        + case when (select n from ntok) > 1 then
            case when term_l = (select w from whole) then weight * 1.0
                 when term_l like (select w from whole) || '%' then weight * 0.6
                 when strpos(term_l, (select w from whole)) > 0 then weight * 0.4
                 else 0 end
          else 0 end
      ) as bonus
    from (
      select business_id, term, lower(term) as term_l, max(weight) as weight,
        count(distinct t) as c
      from hit
      group by business_id, term
    ) x
    where c > 1
    group by business_id
  ),
  agg as (
    select b.business_id,
      count(*)::int as words,
      (sum(b.pts) + coalesce(max(p.bonus), 0))::real as score,
      max(case b.kind when 'name' then 3 when 'type' then 3 when 'item' then 2
                      when 'section' then 1 else 0 end) as tier,
      bool_and(b.kind = 'name') as all_name,
      case when min(b.quality) >= 0.9 then 2 when min(b.quality) >= 0.7 then 1 else 0 end as strength
    from best b
    left join phrase p on p.business_id = b.business_id
    group by b.business_id
  )
  select a.business_id,
    a.words,
    case when a.all_name and a.words = (select n from ntok) and not (select yes from type_query)
         then 4 else a.tier end as tier,
    a.strength,
    a.score,
    coalesce((
      select jsonb_agg(jsonb_build_object('name', i.term, 'price', i.detail) order by i.p desc, i.term)
      from (
        select h.term, max(h.detail) as detail, sum(h.pts) as p
        from hit h
        where h.business_id = a.business_id and h.kind = 'item'
        group by h.term
        order by sum(h.pts) desc, h.term
        limit 3
      ) i
    ), '[]'::jsonb) as hits
  from agg a
  order by a.words desc, a.score desc
  limit greatest(1, least(coalesce(max_results, 100), 1000));
$$;

/**
 * As-you-type suggestions: distinct terms that start with the text (or have a
 * word that does), kinds of business first ("Cafe" stands for many places),
 * then business names, items and folders, then how many businesses carry them.
 * A business NAME carries its id, so tapping it can open the page directly.
 */
create or replace function public.search_suggest(q text, max_results int default 8)
returns table (term text, kind text, businesses int, business_id uuid)
language sql
stable
set search_path = public, extensions
set pg_trgm.word_similarity_threshold = 0.4
as $$
  with needle as (
    select lower(trim(regexp_replace(coalesce(q, ''), '\s+', ' ', 'g'))) n
  ),
  m as (
    select s.term, s.term_l, s.kind, s.business_id,
      case when s.term_l like n.n || '%' then 0
           when strpos(s.term_l, ' ' || n.n) > 0 then 1
           when strpos(s.term_l, n.n) > 0 then 2
           else 3 end as how
    from public.search_terms s, needle n
    where length(n.n) >= 2
      and s.kind in ('name', 'type', 'item', 'section')
      and (
        s.term_l like '%' || n.n || '%'
        -- a typo in a single word ("resturant"): same edit-distance rule as search
        or (length(n.n) >= 4 and strpos(n.n, ' ') = 0 and n.n <% s.term_l and exists (
          select 1 from regexp_split_to_table(s.term_l, '[^[:alnum:]]+') w
          where length(w) >= 3
            and left(w, 1) = left(n.n, 1)
            and levenshtein(left(w, 64), n.n) <= case when length(n.n) >= 7 then 2 else 1 end
        ))
      )
  ),
  g as (
    select min(term) as term, term_l,
      -- a kind of business (it stands for many) before one business's name,
      -- then items, then folders
      (array_agg(kind order by case kind when 'type' then 0 when 'name' then 1
                                         when 'item' then 2 else 3 end))[1] as kind,
      count(distinct business_id)::int as businesses,
      min(how) as how,
      case when count(distinct business_id) = 1 then min(business_id::text)::uuid end as business_id
    from m
    group by term_l
  )
  select g.term, g.kind, g.businesses,
    case when g.kind = 'name' then g.business_id end
  from g
  order by g.how,
    case g.kind when 'type' then 0 when 'name' then 1 when 'item' then 2 else 3 end,
    g.businesses desc, length(g.term), g.term
  limit greatest(1, least(coalesce(max_results, 8), 20));
$$;

grant execute on function public.search_businesses(text, int) to anon, authenticated;
grant execute on function public.search_suggest(text, int) to anon, authenticated;

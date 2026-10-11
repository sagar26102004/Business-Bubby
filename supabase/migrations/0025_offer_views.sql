-- ===========================================================================
-- 0025 · Offer views
-- ===========================================================================
-- How many times customers have seen each offer, per day, so the workspace
-- Offers screen can show "184 views · 12 today" from real numbers.
--
-- Offers live inside `businesses.data` (the document model), and the people who
-- see an offer are strangers to that business who cannot write its row. So, as
-- with ad_record_event (0014), counting goes through a SECURITY DEFINER function
-- that can only ever add 1 to an offer that exists — never through a public
-- write policy. Counts are kept in their own table rather than on the business
-- document so a view never rewrites (and re-caches) the whole listing.
--
-- Honest limitation, same as ads: any client may call this, so the figure is a
-- good-faith measure of reach. Nothing is billed on it.
--
-- `day` is the India-time date, which is what "today" means to every business
-- on the platform.

create table if not exists public.offer_views (
  business_id uuid not null references public.businesses (id) on delete cascade,
  offer_id    text not null,
  day         date not null default ((now() at time zone 'Asia/Kolkata')::date),
  views       bigint not null default 0,
  primary key (business_id, offer_id, day)
);

alter table public.offer_views enable row level security;

-- Read: the business's own team (owner + employees). No write policies at all —
-- the function below is the only way in.
drop policy if exists offer_views_select on public.offer_views;
create policy offer_views_select on public.offer_views
  for select using (is_business_member(business_id, auth.uid()));

create or replace function public.offer_record_view(p_business_id uuid, p_offer_id text)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  -- Only an offer that is actually on the business counts; anything else is
  -- stale or made up, and must not leave a row behind.
  if not exists (
    select 1
      from businesses b,
           jsonb_array_elements(coalesce(b.data -> 'offers', '[]'::jsonb)) o
     where b.id = p_business_id
       and o ->> 'id' = p_offer_id
  ) then
    return;
  end if;

  insert into offer_views (business_id, offer_id, day, views)
  values (p_business_id, p_offer_id, (now() at time zone 'Asia/Kolkata')::date, 1)
  on conflict (business_id, offer_id, day)
  do update set views = offer_views.views + 1;
end;
$$;

comment on function public.offer_record_view(uuid, text) is
  'Count one customer view of an offer. Callable by any viewer; engagement only, never billing.';

grant execute on function public.offer_record_view(uuid, text) to anon, authenticated;

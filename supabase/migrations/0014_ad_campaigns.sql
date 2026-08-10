-- Localo ad_campaigns — the paid ad slot on the Home screen (document model).
--
-- WHAT THIS IS
-- A business pays to put one of its `Offer`s in front of the neighborhood. The
-- row carries no creative: `data.offerId` points at an offer on the business,
-- and the card is rendered from that offer live, so editing the offer updates
-- the running ad and there is never a second copy to drift.
--
-- `data jsonb` is the full AdCampaign (src/domain/types.ts). `business_id` and
-- `status` are pulled out as columns because RLS keys on both: everyone must be
-- able to read RUNNING ads (that's the whole point of an ad), while only the
-- business behind one may see its pending and rejected requests.
--
-- WHO DECIDES WHAT
--   business member — creates a request, and may stop its own campaign early.
--   platform admin  — approves, rejects, and marks payment received.
--   anyone at all   — reads active campaigns, and counts views/taps.
-- A business must NOT be able to approve itself, so the insert policy pins new
-- rows to 'pending' and the member update policy only permits 'stopped'.
-- Approving is left entirely to `is_super_admin()` (migration 0006).
--
-- Idempotent: safe to run more than once.

-- ---------------------------------------------------------------------------
-- 1. The table
-- ---------------------------------------------------------------------------
create table if not exists ad_campaigns (
  id          uuid primary key default gen_random_uuid(),
  business_id uuid not null references businesses (id) on delete cascade,
  -- 'pending' | 'active' | 'rejected' | 'stopped'. There is no 'expired': a run
  -- ending is a fact about the clock, not a decision, so it's derived from
  -- data.endsAt on read rather than written by a sweep that needs something
  -- awake to run it.
  status      text not null default 'pending',
  data        jsonb not null,
  created_at  timestamptz not null default now()
);

create index if not exists ad_campaigns_business_idx on ad_campaigns (business_id);
-- The customer-facing read is "every running ad", so status leads the index.
create index if not exists ad_campaigns_status_idx on ad_campaigns (status, created_at desc);

alter table ad_campaigns enable row level security;

-- ---------------------------------------------------------------------------
-- 2. Policies
-- ---------------------------------------------------------------------------

-- READ. Active campaigns are public — guests browse Home too, so this must not
-- require auth.uid(). Everything else (pending requests, rejections) is visible
-- only to the business behind it and to platform admins.
drop policy if exists ad_campaigns_read on ad_campaigns;
create policy ad_campaigns_read on ad_campaigns for select
  using (
    status = 'active'
    or is_business_member(business_id, auth.uid())
    or is_super_admin()
  );

-- INSERT. Only a member of the business being advertised, and only as a
-- request: `status = 'pending'` in the WITH CHECK is what stops a business
-- inserting itself a live campaign and taking the inventory for free.
drop policy if exists ad_campaigns_insert on ad_campaigns;
create policy ad_campaigns_insert on ad_campaigns for insert
  with check (is_business_member(business_id, auth.uid()) and status = 'pending');

-- UPDATE (business). One power only: pull your own ad. Any other target status
-- fails the WITH CHECK, so a member cannot approve, un-reject, or mark paid.
drop policy if exists ad_campaigns_update_member on ad_campaigns;
create policy ad_campaigns_update_member on ad_campaigns for update
  using (is_business_member(business_id, auth.uid()))
  with check (is_business_member(business_id, auth.uid()) and status = 'stopped');

-- UPDATE (platform admin). Approve, reject, stop, mark paid.
drop policy if exists ad_campaigns_update_admin on ad_campaigns;
create policy ad_campaigns_update_admin on ad_campaigns for update
  using (is_super_admin()) with check (is_super_admin());

-- DELETE. Admins only — a business stops a campaign, it doesn't erase the
-- record of what it bought.
drop policy if exists ad_campaigns_delete on ad_campaigns;
create policy ad_campaigns_delete on ad_campaigns for delete using (is_super_admin());

-- ---------------------------------------------------------------------------
-- 3. Counting views and taps
-- ---------------------------------------------------------------------------
-- The people who see an ad are the ones who cannot write its row — they're
-- strangers to that business, and the policies above are what keep it that way.
-- So counting goes through a SECURITY DEFINER function that increments those
-- two fields and nothing else, rather than by opening the row to public UPDATE
-- (which would let anyone rewrite the campaign's status and price).
--
-- Honest limitation: any client may call this, so the counters are a good-faith
-- measure of reach, not an audited billing input. They're reported to the
-- business as engagement, and money changes hands on the plan price, which is
-- fixed at purchase — so inflating them buys nothing. If ads are ever billed
-- per impression, this must move server-side with a per-viewer dedupe.
create or replace function public.ad_record_event(p_id uuid, p_kind text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  field text;
begin
  field := case p_kind when 'impression' then 'impressions'
                       when 'tap' then 'taps'
                       else null end;
  if field is null then
    return;
  end if;

  -- Only running campaigns count. A finished or pending ad isn't on screen, so
  -- an event against one is either stale or made up.
  update ad_campaigns
     set data = jsonb_set(
           data,
           array[field],
           to_jsonb(coalesce((data ->> field)::bigint, 0) + 1)
         )
   where id = p_id
     and status = 'active';
end;
$$;

comment on function public.ad_record_event(uuid, text) is
  'Increment an ad campaign''s impression or tap counter. Callable by any viewer; counts engagement only, never billing.';

grant execute on function public.ad_record_event(uuid, text) to anon, authenticated;

-- AFTER RUNNING: PostgREST caches the schema, so a brand-new table can 404 from
-- the app for a few seconds. If it persists, force a reload with:
--     notify pgrst, 'reload schema';

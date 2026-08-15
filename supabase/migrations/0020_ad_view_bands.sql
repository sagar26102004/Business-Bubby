-- Localo ads — count a view by HOW FAR AWAY the viewer was.
--
-- WHY
-- Ad plans used to sell a radius: "your card reaches 6 km". That capped how
-- many people could ever see an ad, which is against the platform's own
-- interest (every extra view is free inventory), and it charged the same for an
-- audience one street away as for one across the district. Plans now sell VIEWS
-- inside a band instead — "at least 200 views from people within 5 km" — because
-- distance is really a measure of intent: someone 1 km from a shop might walk
-- in, someone 100 km away won't. See src/domain/ads.ts.
--
-- So a view has to be counted with the viewer's distance attached. That can't
-- be recovered later, and the viewer is a stranger to the business who cannot
-- write its row, so it goes on the same SECURITY DEFINER function migration
-- 0014 introduced — now taking `p_distance_km` and maintaining two more fields
-- inside `data`:
--
--   data.viewsNear    — views from inside `data.withinKm`, the ones the campaign
--                       actually bought. The run keeps going past `endsAt`
--                       until this reaches `data.targetViews` (capped at twice
--                       the days bought; the rule lives in domain/ads.ts and is
--                       evaluated on read, like every other run-window rule).
--   data.viewsByBand  — every view bucketed by distance ('1','2','5','10','25',
--                       '50','100','far'), which is what the business's report
--                       is drawn from.
--
-- `data.impressions` and `data.taps` keep their old meaning: everything, at any
-- distance.
--
-- The old two-argument function is DROPPED rather than left alongside: with a
-- defaulted third argument, keeping both would make a two-argument call
-- ambiguous ("function is not unique") and break counting outright.
--
-- HONEST LIMITATION (inherited from 0014, and now slightly sharper). Any client
-- may call this, so the counters are a good-faith measure, not an audited
-- ledger. Money still changes hands on the plan price, fixed at purchase, so
-- inflating views buys the advertiser nothing — but views now also decide when
-- a make-good extension stops, so someone spamming this could end a stranger's
-- extension early. The cost is bounded (the run's bought days are untouched),
-- and closing it properly means moving the count server-side with a per-viewer
-- dedupe, which is the same thing per-impression billing would need.
--
-- Legacy radius-priced campaigns are untouched. They have no `targetViews`, so
-- nothing here counts against a promise they never made, and the app keeps
-- holding them to the reach they paid for.
--
-- Idempotent: safe to run more than once.

drop function if exists public.ad_record_event(uuid, text);
drop function if exists public.ad_record_event(uuid, text, double precision);

create function public.ad_record_event(
  p_id          uuid,
  p_kind        text,
  p_distance_km double precision default null
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  current_data jsonb;
  next_data    jsonb;
  band         text;
  within_km    double precision;
begin
  if p_kind not in ('impression', 'tap') then
    return;
  end if;

  -- Only running campaigns count. A finished or pending ad isn't on screen, so
  -- an event against one is either stale or made up. (A campaign in its
  -- make-good extension is still status = 'active' — the extension is derived
  -- from the data on read, so nothing here needs to know about it.)
  select data into current_data
    from ad_campaigns
   where id = p_id and status = 'active'
     for update;
  if not found then
    return;
  end if;

  next_data := current_data;

  if p_kind = 'tap' then
    next_data := jsonb_set(
      next_data, '{taps}',
      to_jsonb(coalesce((next_data ->> 'taps')::bigint, 0) + 1)
    );
  else
    next_data := jsonb_set(
      next_data, '{impressions}',
      to_jsonb(coalesce((next_data ->> 'impressions')::bigint, 0) + 1)
    );

    -- VIEW_BANDS_KM in src/domain/ads.ts. An unknown distance counts as far
    -- away: guessing it was nearby would inflate the one number being sold.
    band := case
              when p_distance_km is null then 'far'
              when p_distance_km <= 1   then '1'
              when p_distance_km <= 2   then '2'
              when p_distance_km <= 5   then '5'
              when p_distance_km <= 10  then '10'
              when p_distance_km <= 25  then '25'
              when p_distance_km <= 50  then '50'
              when p_distance_km <= 100 then '100'
              else 'far'
            end;

    if jsonb_typeof(next_data -> 'viewsByBand') is distinct from 'object' then
      next_data := jsonb_set(next_data, '{viewsByBand}', '{}'::jsonb);
    end if;
    next_data := jsonb_set(
      next_data, array['viewsByBand', band],
      to_jsonb(coalesce((next_data -> 'viewsByBand' ->> band)::bigint, 0) + 1)
    );

    within_km := nullif(next_data ->> 'withinKm', '')::double precision;
    if within_km is not null and p_distance_km is not null and p_distance_km <= within_km then
      next_data := jsonb_set(
        next_data, '{viewsNear}',
        to_jsonb(coalesce((next_data ->> 'viewsNear')::bigint, 0) + 1)
      );
    end if;
  end if;

  update ad_campaigns set data = next_data where id = p_id;
end;
$$;

comment on function public.ad_record_event(uuid, text, double precision) is
  'Count an ad view (with the viewer''s distance, bucketed into bands) or a tap. Callable by any viewer; engagement only, never a billing input.';

grant execute on function public.ad_record_event(uuid, text, double precision) to anon, authenticated;

-- AFTER RUNNING: PostgREST caches the schema, so a changed function signature
-- can 404 from the app for a few seconds. If it persists, force a reload with:
--     notify pgrst, 'reload schema';

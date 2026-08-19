# Backend sync queue (Path B ← Supabase)

Pending data-behaviour changes made in the **Supabase** backend (`src/data/supabase/`) that
still need to be replicated into the **Node/Express + Prisma** backend (`backend/`) and its
frontend HTTP client (`src/data/api/`).

**Workflow (see CLAUDE.md → "STANDING RULE"):**
- When a data-behaviour change is made, it is applied to Supabase ONLY, and an entry is
  appended here describing exactly what to do in Path B.
- Running `/update-backend` applies these entries to `backend/` + `src/data/api/`, one at a
  time, and **deletes each entry from this file as soon as it is done and verified**.
- Entries are kept SMALL and self-contained so an interrupted `/update-backend` can resume
  from the next unchecked entry without redoing finished work.

## How to write an entry

Each entry is a `## [SYNC-NNN] <short title>` block. Use the next free number (they only ever
go up; deleting done entries does not recycle numbers). Include everything Path B needs so no
re-derivation from the Supabase diff is required:

```
## [SYNC-001] Add `foo` field to Business

- **Area:** BusinessRepository / businesses
- **Supabase change:** <what was done in src/data/supabase/… + any migration>
- **Domain/interface:** <changes already in src/domain/types.ts or src/data/repositories.ts — shared, usually already done>
- **Path B — backend/:** <exact files + logic: prisma model note, service method, router/controller, authz>
- **Path B — src/data/api/:** <exact client method(s) + endpoint path/shape>
- **DB/migration:** <new SQL migration file, if any — shared DB, apply once>
- **Verify:** <what to check: backend typecheck/build, api client tsc>
```

---

## [SYNC-035] Unnamed (anonymous) customers read as "Guest"

- **Area:** CustomerRepository / customers aggregation
- **Supabase change:** `src/data/supabase/customers.ts` — the chat-row name fallback was
  `names.get(pid) ?? pid`; it is now `names.get(pid) || 'Guest'`. Anonymous identities
  (guest chat, and now guest orders/bookings — see the context below) get a `profiles` row
  with an EMPTY `name`, and `??` does not catch `''`, so those customers rendered as a
  blank row; the old `?? pid` branch showed a raw uuid, which was never useful either.
- **Context (frontend, already shared — no Path B work):** the cart, order/new, party and
  book screens now call `signInGuest()` before writing when nobody is signed in, so a
  logged-out customer acts as a real anonymous auth user instead of the synthetic `'guest'`
  id. That was required for Supabase RLS (`orders_insert`/`bookings_insert` check
  `customer_id = auth.uid()`). Path B authorises server-side and accepts either shape, so
  nothing to change there — but its customer list will now see the same unnamed accounts.
- **Domain/interface:** none.
- **Path B — backend/:** in the customers service (`backend/src/services/customers.ts`),
  apply the same fallback wherever a customer's display name is resolved from a profile:
  an empty/missing profile name must become `'Guest'`, not `''` and not the raw id.
- **Path B — src/data/api/:** none.
- **DB/migration:** none.
- **Verify:** `npm run typecheck` in `backend/`; a business with a guest chat or a guest
  order shows a customer row labelled "Guest".

## [SYNC-036] Work showcase: `Business.showcaseLinks` + upload-only portfolio

- **Area:** BusinessRepository / businesses (document field only — no new endpoint)
- **Supabase change:** none in `src/data/supabase/` — `businesses.update()` already merges the
  whole domain document (`{ ...current, ...patch }` → `data jsonb`), so the new field persists
  with no code change. The frontend showcase editor (`src/app/showcase/[businessId].tsx`) was
  rewritten: media is now UPLOADED through `lib/upload.ts` (Supabase Storage, unchanged on
  every backend) instead of pasted as a URL, capped at 3 photos + 1 video (≤60s) per listing,
  and titles/descriptions are no longer written. Businesses with a bigger showcase add
  uncapped `showcaseLinks` (Drive/Instagram/YouTube/…) instead, rendered as chips on the
  business page.
- **Domain/interface:** `src/domain/types.ts` — new `ShowcaseLinkKind` + `ShowcaseLink`
  (`{ id, kind, url, createdAt }`) and `Business.showcaseLinks?: ShowcaseLink[]`;
  `PortfolioItem.title`/`.description` marked LEGACY (still read, never written). New
  `src/domain/showcase.ts` holds the caps (`MAX_SHOWCASE_PHOTOS = 3`,
  `MAX_SHOWCASE_VIDEOS = 1`, `MAX_SHOWCASE_VIDEO_SECONDS = 60`), URL→kind detection and
  `isPlayableVideo` — all client-side, no backend twin needed.
- **Path B — backend/:** copy the `ShowcaseLinkKind` + `ShowcaseLink` types and the
  `Business.showcaseLinks?` field into `backend/src/domain/types.ts` (the file is a
  hand-kept copy of the frontend domain). No service change: `businesses.update()` in
  `backend/src/services/businesses.ts` does `Object.assign(business, safePatch)` over the
  whole document, so the field round-trips already — this is typing parity only. If the
  Swagger/zod body schema for `PATCH /businesses/:id` enumerates business fields, add
  `showcaseLinks` there so a patch carrying it isn't stripped.
- **Path B — src/data/api/:** none — the showcase writes through the existing
  `businesses.update` client method, and uploads talk to Supabase Storage directly on every
  backend.
- **DB/migration:** none (document model — the field lives inside `businesses.data`).
- **Verify:** `npm run typecheck` in `backend/`; with `EXPO_PUBLIC_BACKEND=api`, add a link in
  Work showcase, reload, and confirm the chip is still on the business page.

<!-- No pending entries. Append new [SYNC-NNN] blocks above this line. -->


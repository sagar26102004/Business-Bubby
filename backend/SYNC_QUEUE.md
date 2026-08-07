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

## [SYNC-009] Memberships: `add` carries `enrolleeName`, payer may have no account

- **Area:** MembershipRepository / memberships (workspace Members ＋ Add)
- **Supabase change:** `src/data/supabase/memberships.ts` → `add()` now sets
  `enrolleeName: input.enrolleeName?.trim() || undefined` on the created `Membership`
  (same line the existing `request()` already has). Nothing else changed — `add()` already
  writes the `customer_id` scoping column through `uuidOrNull()`, so a payer with no Localo
  account (`customerId` = `walkin:<lowercased name>`) stores `null` there and simply never
  appears in anyone's Subscriptions, while still grouping and billing normally in the
  workspace. The mock (`src/data/mock/mockRepositories.ts` → `MockMembershipRepository.add`)
  got the same one-line change.
- **Domain/interface:** DONE (shared) — `NewMembershipInput` in `src/data/repositories.ts`
  gained `enrolleeName?: string`, and its `customerId` doc now states it may be a
  `walkin:<lowercased name>` key rather than a user id.
- **Path B — backend/:** `backend/src/services/memberships.ts` → in `add()` (the
  `const membership: Membership = {…}` literal around line 172), add
  `enrolleeName: input.enrolleeName?.trim() || undefined,` after `customerName`. Verify the
  input type used by `add()` mirrors the shared `NewMembershipInput` (add the optional
  `enrolleeName` field to it and to the request-body validation in
  `backend/src/routers/memberships.ts` → `POST /memberships`, accepting an optional string).
  **Do NOT add a uuid guard on `customerId`** — it must keep accepting `walkin:…` /
  `standalone:…` keys; `uuidOrNull(membership.customerId)` at the Prisma write already
  handles the scoping column. Check the POST /memberships authz guard is business-member-only
  (it must not try to resolve `customerId` to a real user).
- **Path B — src/data/api/:** no change needed — `add` already posts the whole
  `NewMembershipInput` to `POST /memberships`.
- **DB/migration:** none (document model — `enrolleeName` lives inside `data` jsonb).
- **Swagger:** add optional `enrolleeName` to the `NewMembershipInput` schema in
  `backend/src/swagger.ts` and note `customerId` accepts a `walkin:<name>` key.
- **Verify:** `npm run typecheck` + `npm run build` in `backend/`; `npx tsc --noEmit` at the
  repo root. Smoke: POST a membership with `customerId: "walkin:ramesh kumar"` +
  `enrolleeName: "Aarav"` and confirm it lists under the business's members.

<!-- No pending entries. Append new [SYNC-NNN] blocks above this line. -->

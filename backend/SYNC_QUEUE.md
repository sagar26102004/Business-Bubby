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

## [SYNC-019] Call push must carry title/body again (buttons on a closed app)

- **Area:** CallRepository / calls — the push that rings a closed app
- **Supabase change:** `supabase/functions/call-ring/index.ts` — the Expo push message
  went back to carrying `title` / `body` / `sound` alongside the existing `data`,
  `categoryId: 'incoming_call'`, `channelId: 'calls_v2'`, `ttl: 30`, `priority: 'high'`,
  `_contentAvailable: true`. It was briefly data-only so that Android would draw nothing and
  leave the field to the app's native CallStyle popup; when that popup didn't appear on a
  closed app there was nothing to fall back to, and the phone rang showing an empty
  notification with no way to answer. With a title present, Android renders its own
  notification and `categoryId` puts Accept/Decline on it. The native service
  (`modules/call-notification`) consumes the message before expo-notifications sees it
  whenever it runs, so there is no double notification.
- **Domain/interface:** none.
- **Path B — backend/:** `backend/src/services/calls.ts` → `ringDevices()`. Add to each
  message object, keeping everything else as-is:
  ```ts
  title: `📞 ${call.customerName}`,
  body: `Incoming call for ${call.businessName}`,
  sound: 'default',
  ```
  Replace the "DATA-ONLY on purpose" paragraph in the `ringDevices` doc comment — it now
  states the opposite of what the code does. Say instead that the title/body are the fallback
  Android renders when the app's own notification service doesn't handle the message, and that
  `categoryId` is what gives that fallback its buttons.
- **Path B — src/data/api/:** none.
- **DB/migration:** none.
- **Verify:** `cd backend && npm run typecheck && npm run build`.

<!-- No pending entries. Append new [SYNC-NNN] blocks above this line. -->

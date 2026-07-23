# Localo API — Node/Express + Prisma backend (Path B)

A standalone HTTP API implementing the **same repository contracts** as the app's
mock and Supabase backends. The frontend selects it with
`EXPO_PUBLIC_BACKEND=api` (+ `EXPO_PUBLIC_API_URL`) — see the repo root
`.env.example`.

- **Stack:** Node + Express + Prisma, TypeScript. `routers → services` (thin
  handlers, logic in services). Swagger UI at **`/docs`**.
- **Database:** the **same Supabase Postgres** as Path A (document model — every
  table is `data jsonb` + scoping columns; the SQL in `../supabase/migrations`
  stays the schema source of truth). Prisma connects with a **direct/privileged**
  connection that **bypasses RLS** — the API enforces access itself
  (`src/authz.ts` reimplements `0002_policies.sql`).
- **Auth:** identity comes from **Supabase Auth**. The app signs in via Supabase,
  gets a JWT, and sends `Authorization: Bearer <jwt>`; the API verifies it with
  the project's JWT secret (`src/auth/verify.ts`) and resolves the user id.

## Layout

```
prisma/schema.prisma     Document-model tables (mirrors ../supabase/migrations).
src/
  config.ts              Env config.
  db.ts                  Prisma client (privileged connection).
  auth/verify.ts         Supabase JWT verification.
  authz.ts               RLS rules as checks (isBusinessMember, …).
  http/                  errors, async route wrapper, auth middleware.
  lib/                   money, geo, roles, vehicles, ids, data (row↔domain).
  domain/                types.ts + contracts.ts (mirror the app's).
  services/              One per repository — the ported mock logic (the spec).
  routers/               One per repository — REST routes + authz guards.
  swagger.ts             OpenAPI 3 doc (every route).
  app.ts / index.ts      Express app + entrypoint.
```

Endpoints map 1:1 to the repository interface methods in
`../src/data/repositories.ts` and return the SAME domain objects
(`../src/domain/types.ts`), so the frontend client in `../src/data/api` passes
results straight through. Behaviour is kept identical to
`../src/data/mock/mockRepositories.ts` (the behavioural spec).

> `places` is **not** an API resource — device GPS + saved places stay
> client-side, exactly as Path A leaves them.

## One-time setup

1. `cd backend && npm install` (runs `prisma generate`).
2. Copy `.env.example` → `.env` and fill in **your own** Supabase project's:
   - `DATABASE_URL` — Project Settings → Database → Connection string (URI).
     Prisma bypasses RLS with this, so use the direct/privileged connection.
   - `SUPABASE_JWT_SECRET` — Project Settings → API → JWT Settings → JWT Secret.
   - `PORT` (default 4000), `CORS_ORIGIN` (the Expo web origin, or `*` in dev).
3. The schema already lives in `../supabase/migrations` (apply those in the
   Supabase SQL editor if you haven't — Path A shares the same DB). Prisma reads
   the tables via the hand-written `schema.prisma`; to re-introspect instead:
   `npx prisma db pull`. **Never run `prisma migrate` against this DB** — the SQL
   migrations own the DDL, RLS, and triggers.

## Run

- Dev (watch, path aliases via tsx): `npm run dev`
- Type-check: `npm run typecheck`
- Build + run: `npm run build && npm start`  (build rewrites `@/` aliases to
  relative paths with `tsc-alias` so `node dist/index.js` runs).
- Docs: `http://localhost:4000/docs` · health: `/health` · spec: `/openapi.json`

## Point the app at it

In the repo root `.env`:

```
EXPO_PUBLIC_BACKEND=api
EXPO_PUBLIC_API_URL=http://localhost:4000
EXPO_PUBLIC_SUPABASE_URL=...        # still needed — the app signs in via Supabase
EXPO_PUBLIC_SUPABASE_ANON_KEY=...
```

Restart `npx expo start --web`. Sign-in flows through Supabase; every other read
and write goes to this API.

## Deploy (e.g. Render)

Deploys independently. Co-locate its region with the Supabase DB. Build command
`npm install && npm run build`, start command `npm start`, and set the same env
vars. Free tiers cold-start.

## STANDING RULE

Any change to data behaviour (a new repository method, changed logic, a new
field) must be made in **both** real backends and kept behaviour-identical to the
interface + mock: here (Path B, `src/services` + `src/routers` + the frontend
client `../src/data/api`) **and** the Supabase repos (Path A, `../src/data/supabase`).

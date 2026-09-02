<div align="center">
  <img src="assets/icon.png" alt="One Place" width="96" height="96" />

  <h1>One Place</h1>

  <p><strong>The shops, stalls and services around you — in one app.</strong></p>

  <p>
    Browse what's actually near you, order from it, call the owner without swapping phone
    numbers — and list your own business in a few minutes.
  </p>

  <p>
    <img alt="Expo SDK 57" src="https://img.shields.io/badge/Expo-SDK%2057-000?logo=expo&logoColor=white" />
    <img alt="React Native 0.86" src="https://img.shields.io/badge/React%20Native-0.86-61dafb?logo=react&logoColor=black" />
    <img alt="TypeScript" src="https://img.shields.io/badge/TypeScript-strict-3178c6?logo=typescript&logoColor=white" />
    <img alt="Supabase" src="https://img.shields.io/badge/Supabase-Postgres%20%2B%20RLS-3ecf8e?logo=supabase&logoColor=white" />
    <img alt="Platforms" src="https://img.shields.io/badge/Android%20%C2%B7%20iOS%20%C2%B7%20Web-one%20codebase-444" />
  </p>
</div>

---

## What it is

Most local-business apps are a phone book with a map. **One Place** is the whole loop: discover a
business, see what it sells with real prices, place the order, get a bill, talk to the owner, and
rate them afterwards — while the business gets a small workspace to run all of that from their
phone.

A listing can be any of four shapes, and the app adapts to each:

| | | |
|---|---|---|
| 🛠️ **Service** | a provider — electrician, transport, tailor | requests, plans, bookings |
| 🏪 **Shop** | a cafe, bakery, kirana store | a menu or a product catalog, dine-in tabs |
| 🧺 **Stall** | a *person's* own stall — one per user, everything they're selling lives in it | public price threads on each item |
| 🔑 **Rental** | a flat, a car, a hall, equipment | per-day / per-month pricing |

Discovery doesn't run on rigid categories — it runs on **tags**. A tyre dealer is *Tyres* +
*Wheel alignment* + *Vehicle service* and shows up under all three. Customers browse by **intent**
("Food", "Home Services", "Rentals") rather than by whatever box the owner ticked at signup.

## Features

**For customers**
- 📍 Real GPS distance sorting, saved places (Current / Home / Work), and a live street map
- 🔎 Tag + intent browse, search, deals carousel, stalls grid
- 🛒 Cart-style orders across menus, products, services, rentals and plans — one model, five doors
  (*Order · Buy · Request · Rent · Enroll*)
- 🧾 Bills delivered in-app, QR scan-to-pay/collect
- 💬 Chat threads per business, ⭐ reviews, 🔔 notifications on every order event
- 📞 **Real in-app voice calls** (LiveKit) — no phone numbers exchanged, with a full-screen
  lock-screen incoming-call UI on Android
- 🚚 Live tracking: watch the vehicle your parcel or your kid is riding on

**For businesses**
- ✍️ A step-by-step register wizard; catalogs are filled from **prebuilt libraries** walked as
  folders (food ▸ goods ▸ services ▸ plans ▸ rentals) — or **pasted in one go** with a tolerant
  JSON-ish importer that turns nesting into folders
- 👥 Team hierarchy (owner → managers → staff) with rank-based least-privilege access
- 📊 A modular workspace: orders, dine-in tabs, billing, customers, memberships, bookings, fleet,
  B2B chat, ads
- 🖼️ A work showcase (photos + a ≤60s video, uploaded for real), plus uncapped external links
  for businesses whose portfolio *is* the business

## Architecture

The whole app is built around one rule:

> **Screens depend on repository _interfaces_, never on a concrete backend.**

```
src/
  app/         routes only (Expo Router, 94 screens, typed routes)
  domain/      entities + the catalogs they're built from (tags, intents, offerings…)
  data/        repository interfaces + three interchangeable implementations
  features/    composed feature UI (orders, calls, chat, fleet, billing…)
  components/  reusable primitives
  theme/       every design token — nothing is hardcoded
  lib/         small helpers (money, geo, upload, share, cache)
```

All data access goes through `useRepositories()` / `useAuth()` from `src/data/DataProvider.tsx`,
against **21 repository interfaces** in `src/data/repositories.ts`. Swapping the backend is
one env var:

```bash
EXPO_PUBLIC_BACKEND=supabase   # app talks straight to Postgres + RLS
EXPO_PUBLIC_BACKEND=api        # app talks to the Node/Express + Prisma server in ./backend
EXPO_PUBLIC_BACKEND=mock       # in-memory, offline, resets on reload
```

### Three implementations of the same contract

| | Where | What it is |
|---|---|---|
| **mock** | `src/data/mock/` | In-memory + seeded. It is also the **behavioural spec** — every rule (order proposals, dine-in tabs, billing-cycle math, the call state machine) lives here first, and both real backends must match it method-for-method. |
| **supabase** *(Path A)* | `src/data/supabase/` + `supabase/migrations/` | The app talks straight to Supabase — Postgres, Auth, and **Row-Level Security** doing the authorization. Document model: every table is `data jsonb` (the full domain object) plus the scoping columns RLS keys on. 21 migrations. |
| **api** *(Path B)* | `backend/` + `src/data/api/` | A standalone **Node + Express + Prisma** server over the same Postgres, `routers → services`, with RLS reimplemented as explicit authz checks. Swagger UI at `/docs`, 90 routes. |

Path A is the backend currently used for testing; Path B exists so the app is never married to a
vendor. Frontend code is **identical** for all three.

## Running it

```bash
git clone https://github.com/sagar26102004/Business-Bubby.git
cd Business-Bubby
npm install --legacy-peer-deps      # a peer conflict blocks plain `expo install`

cp .env.example .env                # optional: fill in your own Supabase project
npx expo start --web                # browser preview at http://localhost:8081
npx expo start                      # or scan the QR with Expo Go
```

With no `.env`, the app boots on the **mock** backend with seeded data — nothing to configure.

Verify a change:

```bash
npx tsc --noEmit
npx expo export --platform web
```

### What needs a real build

Expo Go covers almost everything. These need a dev/preview build (native modules):
**voice-call audio** (WebRTC), **QR scanning** (camera barcodes), and the Android
**lock-screen call UI** (`modules/call-notification/`, a local Expo module).

## Tech

**Expo SDK 57** · React Native 0.86 · React 19 · Expo Router (typed routes) · TypeScript ·
Supabase (Postgres, Auth, Storage, RLS, Edge Functions) · Node + Express + Prisma ·
LiveKit (voice) · Leaflet + OpenStreetMap (maps) · EAS Build & Updates

Design language is a "neighborhood" look — green on warm paper, drawn icons, no gradients —
and the web build is genuinely responsive: `useResponsive()` gives desktop a full-width
multi-column layout rather than a stretched phone screen.

## Docs

| | |
|---|---|
| `CLAUDE.md` | the full project guide — read this first |
| `docs/direction.md` | where the product is going (customer marketplace + modular business workspace) |
| `docs/play-store/RELEASE-STATUS.md` | running status of the Google Play submission |
| `supabase/README.md` · `backend/README.md` | the two backends, in detail |
| `backend/SYNC_QUEUE.md` | Supabase-first workflow: changes land on Path A, then get applied to Path B |

## Status

In active development, preparing its **first Google Play release** — Google Play only; an App
Store submission is not being prepared. Both backends are built and type-clean, and the app runs
on Android and the web from one codebase.

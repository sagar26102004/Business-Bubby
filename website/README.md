# One Place — website

The public website for the One Place app (this repo's Expo app). Two jobs:

1. **Every business gets a free website** — `/<business-name>`, indexed by Google, shareable on
   WhatsApp/Instagram/visiting cards, with a proper preview card (name, photo, rating).
2. **Anyone can view a business without installing the app** — menu/catalog, photos, reviews,
   hours, map. Every *action* (order, chat, call, review) hands off to the app.

It is a self-contained **Next.js** project. It lives in this folder only and **never imports from
`../src`** — the few app types and helpers it needs are copied into `lib/` with a header naming the
source file, so if the app renames a field, update the copy.

## How it works

| Piece | Where |
|---|---|
| Live data | `lib/data.ts` — Supabase REST with the public anon key. `businesses` and `reviews` are world-readable by RLS; nothing private is reachable. Cached 10 min (ISR). |
| Slugs | Derived, not stored: name → name-city → name-idprefix, oldest listing keeps the plain name, so links never change. `/b/<business-id>` 308-redirects to the slug (that's what the app's future "Share my website" button will build). |
| What's public | Stalls (type `item`) are hidden (on hold, as in the app). Demo listings are shown but `noindex` and left out of the sitemap. |
| Privacy | `isHome` / `hidePreciseLocation` businesses show the city only — no address, map or directions. Owner phone numbers are never shown; calls stay in the app. |
| Catalog | `lib/catalog.ts` — the app's five buckets (menu, plans, services, rentals, products), sections › folders › items. |
| Photos | Plain `<img>` on Cloudinary's own resizing (`lib/media.ts`), using the app's three widths only. |
| Offers | `lib/offers.ts` — liveness copied from the app's `src/domain/offers.ts` (switched on, not past `endsAt`). |
| Open now | Computed in the visitor's browser (`components/OpenNow.tsx`) so a cached page is never stale. |
| Legal | Links to the GitHub Pages copies — Play requires the privacy URL to match `src/lib/legal.ts` byte-for-byte. |
| "Open in app" | `intent://business/<id>` (scheme `localo`, package `in.oneplace.app`) — opens the app on Android, falls back to Play. |

## Pages

| Route | What |
|---|---|
| `/` | Landing: search, categories of the biggest city, newest listings, owner pitch |
| `/explore` | Every city with enough listings (`MIN_CITY_LISTINGS`) + every category |
| `/in/<city>` | One city, a preview row per category |
| `/in/<city>/<category>` | e.g. "Food in Indore", filter chips from the category's tags (`?tag=Cafe`) |
| `/search?q=…&category=…` | Name/tag/profession/city search; `noindex` |
| `/deals` | Every live offer (`lib/deals.ts`) — the web twin of the app's Deals feed. Filters are links: `?city=`, `?category=`, `?video=1` (reels), `?sort=ending`; each chip shows only when it would match something. Home and city pages carry a 🔥 Deals strip (one deal per business). Demo listings' deals ARE shown, as in the app, but the page is `noindex` and out of the sitemap until a real business has a deal. Reels play muted, only while on screen (`components/DealVideo.tsx`), and are never transformed. |
| `/<slug>` | The business page — breadcrumbs, offers, catalog, photos, reviews, hours, map |
| `/<slug>/menu` | The whole catalog flat, made to print or save as PDF |
| `/b/<id>` | 308 → `/<slug>` (what the app's "Share my website" button links to) |
| `/list-your-business` | Owner pitch |

Categories are copied from the app's `src/domain/intents.ts` into `lib/intents.ts`; site routes
(`explore`, `search`, `in`, …) are reserved in `lib/data.ts` so no business slug can take them.

## Run

```bash
cd website
cp .env.example .env.local   # fill SUPABASE_ANON_KEY
npm install
npm run dev                  # http://localhost:3000 (pass -p if 3000 is taken)
npm run build                # must pass before deploying
```

## Deploy (Vercel, Sagar's account via the CLI)

The Vercel project (`oneplace-website`) is connected to GitHub (`sagar26102004/Business-Bubby`,
branch `main`) with **Root Directory `website`** — set 2026-10-11; before that it was blank and
every push failed with "No Next.js version detected". Env vars on Vercel: `SUPABASE_URL`,
`SUPABASE_ANON_KEY`, and — once a domain exists — `NEXT_PUBLIC_SITE_URL`.

**A push to `main` that touches `website/` deploys it to production by itself.** Pushes that don't
touch `website/` are skipped (the project's "Ignored Build Step" is `git diff HEAD^ HEAD --quiet -- .`).

To redeploy without a push (e.g. after changing an env var), rebuild the latest deployment:

```bash
cd website
npx vercel ls oneplace-website            # copy the newest Production URL
npx vercel redeploy <that-url> --target production
```

⚠️ Don't use `npx vercel deploy --prod` from `website/` any more: with Root Directory set, Vercel
looks for `website/website` and fails. And don't run it from the repo root either — that would
upload the whole repo, including the gitignored credential files there.

## Next (Phase 2)

- A real domain → set `NEXT_PUBLIC_SITE_URL`, add it in Vercel.
- "Share my website" button in the app's Workspace → `https://<domain>/b/<businessId>`.
- Android App Links: `public/.well-known/assetlinks.json` (needs the Play signing SHA-256) + an
  `intentFilters` entry in the app's `app.json`.

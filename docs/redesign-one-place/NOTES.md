# One Place redesign — notes (branch `redesign/one-place`, Oct 2026)

The mockups in this folder (`*.png`, with their Stitch `*.html` and the shared
`DESIGN.md`) are the **target**, not a spec. They were generated, so they show
things the app has no data for; those were left out rather than faked.

| Screen | Mockup | Code |
|---|---|---|
| Explore | `explore.png` | `src/app/(tabs)/index.tsx`, `features/businesses/BusinessCard.tsx`, `features/ads/AdCarousel.tsx` |
| Business page | `business.html` (screenshot failed to export) | `src/app/business/[id].tsx`, `features/businesses/BusinessHero.tsx`, `OfferingsSection.tsx`, `OffersSection.tsx` |
| Register 1–4 | `register-1/2/3a/3b/4.png` | `src/app/register.tsx` (4 phases) |
| Workspace | `workspace.png` | `features/workspace/WorkspaceHub.tsx` (Workspace tab + `/workspace/[id]`) |

Everything else follows the same patterns through the shared primitives in
`src/components/ui/` (`IconTile`, `SegmentedControl`, `SectionHeader`,
`ToggleCard`, `StepHeader`, `BottomActionBar`, plus restyled `Button`, `Tag`,
`Input`, `Card`, `Text`).

## Design system

- Tokens: `src/theme/theme.ts` → the `forest` scheme (switch back with `DESIGN`).
- Type: Plus Jakarta Sans, one family per weight (`src/theme/fonts.ts`; `Text`
  maps `weight` / `fontWeight` to the family). The first paint waits up to 3 s
  for it, then falls back to the system font.
- CTA terracotta is `#A24936`, not DESIGN.md's `#E06D53`: white text on
  `#E06D53` is about 3:1 and fails AA. `#A24936` is the mockups' own darker
  `secondary`.

## Put on hold (code kept, nothing links to it)

`src/lib/onHold.ts` holds the flags. `grep -rn "ON HOLD" src` lists every spot.

- **Stalls**: the Stalls feed, stall console, product threads, and "Selling my
  own stuff" in register. Their routes redirect home, and stall listings are
  filtered out of Home, Browse, Search, Map and B2B.
- **Business QR**: the storefront QR screen, the header QR button, and the
  scan-a-business entry. `/scan` stays for order-ticket handover (Billing,
  Fulfil, and the workspace's "Scan order QR").

## Navigation

The bottom bar is **Explore · Subscriptions · 🔥 Deals · Chats · Workspace**
(mockup: stitch (11)).

- **Deals** is a raised terracotta button in the middle, not a tab: it opens
  the full-screen deals feed, the same place as "View all" on Explore.
- **Account** has no bottom button any more — it's the avatar left of
  "One Place" on Explore's top bar (still a tab route, so the bar shows on it).
- **Alerts** left the Chats tab: the bell on Explore's top bar (beside Map)
  opens `/alerts`, with a dot while anything is unread. Chats is conversations
  only, and its badge counts only unread messages. The mockup's Orders tab
  was NOT adopted — Subscriptions stays.

- **My orders** moved to the top of Account. Its route is still a tab route,
  so the bar stays visible on it.
- The **Workspace** tab opens straight onto the hub of the last business used
  (remembered per device), with a switcher in its header.

## Left out of the mockups, on purpose

| Mockup shows | Why it isn't here |
|---|---|
| "Verified" badges, "Zero hidden fees", "100% free listing" guarantee | No verification process or policy exists to back the claim |
| Coupon codes (NEIGHBOR20), "Claim" codes | Offers have no codes; "Claim offer" starts an order for the bundle |
| SKU numbers, stock units, low-stock / OOS alerts | No inventory data (the IT-services layer is deferred) |
| "Scan menu card" (OCR) | Not built; "Paste the whole list" is the import path |
| Bank & settlement, UPI soundbox, auto payout | No payment gateway |
| Reel view counts ("1.4k views") | Only ad campaigns count views |
| "Open & accepting orders" switch | No such field; the hub shows the open state from opening hours |
| Private-calls toggle in register | `NewBusinessInput` has no calls flag; calls are always on, and the step says so |
| Custom packages & events block | No such offering bucket (party packages remain where they were) |
| Share / bookmark in the business header | No saved-businesses model |

The **"Today's pulse"** numbers are all computed from data the workspace
already loads:

- **Revenue**: bills created today, compared with yesterday.
- **Live queue / open tabs**: unbilled orders.
- **Dues**: unpaid bills, or unpaid member cycles.

## Behaviour changes worth knowing

- **Register**: the business model card (service / shop / rentals) only
  pre-ticks building blocks. The listing type is still *derived* from what's
  listed.
- **Register**: choosing "Mobile service, or from home" sets
  `location.isHome` and `hidePreciseLocation`, so the exact address is hidden
  on the page and there is no Route tile.
- **Register**: drafts saved by the old ~11-step wizard are discarded
  (`DRAFT_VERSION = 2`).
- **Business page**: rows can be added to the cart in place. It is the same
  cart as the full catalog screen, with a sticky "Place order" bar.

No domain types, repositories or SQL changed, so there is nothing in
`backend/SYNC_QUEUE.md`.

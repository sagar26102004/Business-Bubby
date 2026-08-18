# Phone screenshots

Captured from the running web app by `scripts/play-screenshots.mjs`. All are
**1080 × 1920 PNG**, the size `../store-listing.md` recommends, and all are well
inside Play's 8 MB-per-file limit.

Regenerate the whole set with one command (dev server must be running):

```bash
npx expo start --web          # in one terminal
node scripts/play-screenshots.mjs
```

Captured as a **guest**, which is what a Play reviewer sees on first launch. The
ten seeded test accounts were deleted in the production cleanup, so there is no
default login any more; `OP_USER`/`OP_PASS` still work if you have an account
whose Orders/Chat tabs are worth shooting.

| # | File | Screen | Upload? |
|---|---|---|---|
| 1 | `01-home.png` | Home — category strip, live deal, nearby listings with real distances | ⚠️ see below |
| 2 | `02-business.png` | Cafe Corner — tagline, hours, distance, ₹99 combo offer, 53-dish menu | ✅ |
| 3 | `03-menu.png` | The full menu — priced dishes with veg/non-veg marks | ✅ |
| 4 | `04-order.png` | An itemised order — quantities, dine-in/takeaway, ₹1,060 total | ✅ |
| 5 | `05-map.png` | Real Indore streets with businesses plotted and distance rings | ✅ |
| 6 | `06-stalls.png` | Stalls — the picture-first grid of what people are selling | ❌ **do not upload yet** |

**Upload 02, 03, 04, 05 in that order.** That is four, comfortably past Play's
minimum of two, and every one of them is clean. The first two appear in search
results, so `02-business` leading is deliberate — it is the single best frame in
the app.

## How `04-order` is captured without writing anything

It is the "proof that transactions happen" shot the previous version of this
file said was missing. It is built by tapping ADD on real dishes and stopping at
the review screen. `CartContext` is a plain `useState` map with **no repository
call in it**, so nothing reaches the database, no order row is created and no
business is notified. The README rule against placing test orders for a
screenshot still stands — this simply never places one.

⚠️ The ADD button reads `ADD ＋` with a **fullwidth plus** (U+FF0B). An exact
match on `"ADD +"` finds nothing and the step silently no-ops, leaving you with
a screenshot of an empty order.

## ⚠️ What is still blocked on data, not on tooling

The screenshots show **whatever is in the live database at capture time**, and
four of the eight live listings are unpresentable. This is the only thing
standing between the current set and a full six:

| Listing | Problem |
|---|---|
| `Vehicles Stall #633` | Generated name, and its address is **"Riverton, CA"** — a US city in an Indore directory |
| `Fth` | Junk name, appears on Home and in the Food category |
| `Abc's Stall` | Junk name, sits **643 km** away so it breaks the "near you" premise |
| `Ananya Iyer's Stall` | Its one product is `Bottel` (typo), ₹100, no photo |

`06-stalls` is unusable for exactly this reason: it is two test products
(`Bottel`, and `iPhone 90` at ₹5 marked SOLD) against a mostly empty grid.

`01-home` is borderline — it is fine down to the fold, but `Vehicles Stall #633`
enters the frame at the bottom edge, and the hero deal card has **no photo**, so
it renders as a grey block.

Fix the names and add a cover photo or two, then re-run the script; nothing
about the listing copy has to change. Per decision 4 in `../RELEASE-STATUS.md`
this is tolerable for a **testing track** but is a **production-promotion
blocker**.

## Not captured — needs an account that has transacted

- **A chat thread** — came out as "No chats yet" on a guest and on the accounts
  that existed at capture time.
- **The in-app voice call**, which nothing else in this category has. It cannot
  be screenshotted without placing a real call to a real business.

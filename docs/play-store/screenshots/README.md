# Phone screenshots

Captured from the running web app by `scripts/play-screenshots.mjs`. All are
**1080 × 1920 PNG**, the size `../store-listing.md` recommends, and all are well
inside Play's 8 MB-per-file limit.

Regenerate the whole set with one command (dev server must be running):

```bash
npx expo start --web          # in one terminal
node scripts/play-screenshots.mjs
```

| # | File | Screen |
|---|---|---|
| 1 | `01-home.png` | Home — category strip, live deal, nearby listings with real distances |
| 2 | `02-business.png` | A business page — hours, distance, offer, menu with prices |
| 3 | `03-menu.png` | The full menu — priced dishes with veg/non-veg marks |
| 4 | `04-stalls.png` | Stalls — the picture-first grid of what people are selling |
| 5 | `05-map.png` | The real street map with businesses plotted around you |

Five clears Play's minimum of two. Upload them in this order — the first two are
what appear in search results.

---

## ⚠️ Recapture these before you upload

The screenshots show **whatever is in the live database at capture time**, and
right now that includes generated test rows (`Vehicles Stall #633`, `Abc's
Stall`, an item called `Bottel`). A reviewer reads that as an unfinished app.

So: do the data cleanup in `../production-setup.md` §2.3–2.4 first, then re-run
the script. Nothing else about the listing has to change.

## Not captured yet — three worth adding later

`../store-listing.md` asks for 6–8, and names two screens this set is missing.
Both were attempted and both came out as **empty states**, which is worse than
having fewer screenshots:

- **An order or a bill** — proof that transactions really happen in the app.
  The account used for capture had no orders, so the screen read "No orders
  yet".
- **A chat thread** — same problem: "No chats yet".

Neither is a scripting gap. They need an account that has actually transacted.
Once one exists, set `OP_USER` / `OP_PASS` to it and add two steps to the script
(tap the Orders tab, tap the Chat tab). A third candidate is the in-app voice
call, which nothing else in this category has — but it cannot be screenshotted
without placing a real call to a real business.

Do **not** solve this by placing test orders against live listings just for the
screenshot; that writes rows and fires notifications at real businesses.

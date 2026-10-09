# Bulk listing plan: Zomato / Google Maps → Localo

How real Indore businesses get onto Localo in bulk, one business type at a time (cafés first), without the register wizard. Everything here runs as the platform **super-admin** (`sagar`), who owns each listing until the real owner claims it (Reassign owner panel).

**Food places come from Zomato, not Google Maps (Sagar's decision, 8 Oct 2026).** By October 2026 Google served our automated browser a reduced place page (Overview and Reviews only, no menu), and the first real run lost almost 2 hours to it. Every Zomato restaurant page carries the whole listing as data: name, exact pin, address, phone, the week's hours, the featured photo and the full menu with prices, veg marks and dish photos. So the menu needs no Claude at all. **Dish photos are off for now** (Sagar, 8 Oct 2026): 40,000 of them would be ~3 GB of Cloudinary plus a resize per photo per size viewed. `MAX_DISH_PHOTOS` in `zomato-bot.ts` turns them back on; the publisher already uploads them. `maps-bot.ts` stays for business types Zomato doesn't cover (gyms, salons…).

## The pieces (all in `scripts/`, run with `npx tsx` from the repo root)

| Script | Job | Touches the live app? |
|---|---|---|
| `zomato-bot.ts` | **Food places.** Walks a Zomato list page and makes one folder per new place, menu and dish photos included | No |
| `maps-bot.ts` | Other business types. Searches Google Maps and makes one folder per new place | No |
| `menu-from-photos.ts` | Gets each place a `menu.json` from the best source that has one (the menu rule, below) | No |
| `zomato.ts` | Finds the place's Zomato page in our own browser for the menu rule | No |
| `add-menus.ts` | Gives **live** food listings that have no menu one (Zomato, then the web), as the super-admin | **Yes** |
| `list-business.ts` | Signs in as super-admin and publishes each ready folder | **Yes** |
| `listing-loop.ts` | The unattended schedule: collect → publish, every 30 min | Yes, through the publisher |
| `start-listing.ps1` | Launcher: own window, keeps Windows awake | — |
| `listing-lib.ts` | Shared helpers: env, duplicate key, key file | — |
| `listing-plan.json` | The schedule and the list of searches | — |

Secrets live in `scripts/.listing.env` (gitignored): `LISTING_LOGIN`, `LISTING_PASSWORD`. Menus are read by Claude Code itself (the `claude` CLI, signed in as you); there's no separate AI key. Gemini was tried and dropped on 2026-10-07: it was overloaded for hours, and when it did answer it read 123 dishes from a menu where Claude read about 200.

## A collected place: `E:\listing\<type>\<Place name>\`

| File | What it is |
|---|---|
| `listing.json` | name, type, tags, phone, address, `location.point` (pin), hours (`"mon": "09:00-23:30"`), source URL |
| `cover.jpg` | the place's featured photo (Zomato) or main photo (Google), full size |
| `dishes\N.jpg` | dish photos (OFF for now; `MAX_DISH_PHOTOS`). `menu.json` points at them (`"photo": "dishes/3.jpg"`) and the publisher uploads them to Cloudinary; nothing links to Zomato |
| `menu 1.jpg` … | printed-menu photos, full size: only when there is no typed menu |
| `menu.json` | the menu, in the register wizard's paste format (see CLAUDE.md, "Pasting a whole catalog"); `review.txt` says which source it came from |
| `menu.online.json` | Google's typed menu (delivery-app prices) |
| `zomato.txt` | the Zomato page text, when the menu came from Zomato |
| `review.txt` | anything a person should look at |

Folders made by hand work too. Put a `<lat>, <lng>.png` map screenshot (its file name is the pin), `cover.jpg`, `1.jpg…` (showcase) and `menu.json` in the folder; Claude writes the `listing.json` from the screenshot.

## The menu rule: any menu beats no menu

Sagar's rule (8 Oct 2026): get the menu **from wherever it can be found**.

**A Zomato-collected place** usually has it already: `zomato-bot` writes `menu.json` straight from the order menu's data, with no Claude involved. A place that takes no online orders gets its printed-menu photos saved instead, and those go through the ladder below.

**For everything else,** `ensureMenu` in `menu-from-photos.ts` tries these in order and keeps the first that works:

1. **Menu photos** from Google, read by Claude. These are the in-café prices, so they come first.
2. **Google's typed menu** (delivery-app prices). Used when there are no photos, or when Claude can't read them.
3. **Zomato.** Our own browser searches Zomato for the place and opens its order page (`zomato.ts`). It tries the full name, then the name cut at " - " / "(", then the name without trailing address words ("Nothing Before Coffee Sapna Sangeeta" → "Nothing Before Coffee"), and opens every matching suggestion (a chain lists each branch under the same name). The page is **accepted only when its phone number matches the one Google gave us**, or the exact name plus two address words, or a close name (one inside the other) plus three address words. Claude then turns the page text into the menu, using the original (not discounted) price. Swiggy is not used, because it shows bots an error page.
4. **The wider web:** Claude searches the place's own site, Magicpin and similar, again accepting only a page that is clearly this place. It rarely finds anything, because Claude's own web tools can't open Zomato or Swiggy.
5. **Nothing found:** the place is listed without a menu.

Claude runs headless (`claude -p`, Sonnet, on your Claude plan) with only the tools each step needs, and every reply is checked by the publisher's parser before it's saved. A place is **held** only when it has menu photos that Claude couldn't read *and* no other source worked. It's retried in the next cycle.

## Never listing the same business twice

- **The key is the normalised name plus the location.** "Amigos Café & Restaurant" becomes `amigoscafeandrestaurant`, and two listings count as the same when their pins are within **150 m**. Another branch of a chain, further away, still gets listed. A *similar* name within 50 m only raises a warning.
- **Every new place is checked against all live listings (any owner), `E:\listing\published-keys.json` and every local folder.** This happens before it's collected and again right before it's published.
- **Zomato and Google spell names differently** ("Habit - Coffee Lounge" on Google can be "Habit" on Zomato). The exact key misses that, but the similar-name check (one name inside the other, within 50 m) catches it and **holds** the place for a person instead of listing it twice.
- **`E:\listing\zomato-seen.json`** records every Zomato page already opened, so a page is never opened twice, even when it turned out to be a duplicate.
- **Publishing writes the key to `published-keys.json` and then deletes the folder** (`--keep` keeps it). The file is the permanent record of everything listed.

## `/start-listing` and `/start-listing-zomato`: the unattended run

Two commands, one loop; they differ only in where places come from:

| Command | Source | Lists in `listing-plan.json` |
|---|---|---|
| `/start-listing-zomato` | **Zomato only** (`zomato-bot.ts`): menus as data, no Google traffic | `zomatoQueries` |
| `/start-listing` | Google Maps (`maps-bot.ts`), menus from the ladder | `queries` |

Both take the same arguments: `/start-listing-zomato 4` for 4 hours, or `/start-listing-zomato 10 dry` to collect without publishing.

**Cities (Zomato only, 9 Oct 2026).** Add city names: `/start-listing-zomato 8 bhopal delhi` (any order, spaces or commas). With none, the run uses `cities` in `listing-plan.json` (Indore). Cities run **in the order given**: the first city walks every `zomatoQueries` list, then the run moves on to the next. Each city remembers its own position in `loop-state.json` → `zomatoCities`, so a city that's used up (Indore, after the 8 Oct run) is skipped at once. Delhi, New Delhi, Noida, Gurgaon and Ghaziabad are all Zomato's **`ncr`** (`zomatoCity` in `zomato-bot.ts`), so they count as one city. `zomato-seen.json` stores places outside Indore as `city/slug`. Underneath, this is `start-listing.ps1 -Cities "bhopal,delhi"` → `listing-loop.ts --cities bhopal,delhi`. Claude runs pre-flight checks and opens a PowerShell window titled **"Localo listing run - zomato"** (or `- maps`), which runs `listing-loop.ts --source zomato|maps` through `start-listing.ps1 -Source`. Never run both at once: they share `E:\listing\cafe`.

Every **30 minutes** (one *slot*) the loop runs one cycle:
1. If `E:\listing\STOP` exists, stop.
2. Retry menu photos that couldn't be read last time.
3. Collect up to **20** new places from the run's source (`zomato`: the `zomatoQueries` list pages, e.g. `restaurants/cafes`; `maps`: the Google `queries`). It walks the list in order and moves on when one has nothing new left. Each source's position is saved in `E:\listing\loop-state.json` (`zomatoCities.<city>` / `queryIndex`; an old `zomatoQueryIndex` is moved to `zomatoCities.indore` on load), so the next run continues from there.
4. Publish everything that's safe without a person (`list-business --auto`). Anything else is **held**: left in its folder for later.

| Outcome | When |
|---|---|
| **Published** | menu from any source (or none exists anywhere), full hours, no duplicate, no similar name nearby |
| **Held** | menu photos Claude couldn't read yet *and* no other menu source worked, opening hours incomplete, similar name within 50 m, or the page didn't load at all (no address or pin) |
| **Dropped** | exact duplicate; recorded in the key file, folder deleted |

10 hours = 20 slots = **up to 400 places**.

### Safety and back-off

- **Pace, Google:** 3–8 s between places, 20 places per 30 minutes.
- **Pace, Zomato** (set to look like one person browsing, Sagar 8 Oct 2026):
  - one tab, one page at a time, never in parallel;
  - 8–20 s between places, and a 1–2 minute break every 8–12 places (about 25 s a place in testing, so 20 places is ~15 minutes of a 30-minute slot);
  - a persistent browser profile (`E:\listing\.zomato-profile`), so Zomato sees a returning visitor with its own cookies;
  - the user agent is the installed Edge's real version;
  - `zomato-seen.json`: no page is ever opened twice;
  - a block page (403/429/503, "Access Denied", a captcha) **stops at once**; the loop rests **2 slots (1 h)**, and a second block in a row ends the run.
- **A slowdown** is 3 pages in a row that come back without the basics (Zomato: no page data; Google: no address or pin), or a block/captcha page. The loop then rests (Google 1 slot, Zomato 2). Two slowdowns in a row **end the run**, so try again the next day.
- **A reduced Google page is NOT a slowdown.** Google now shows automated browsers Overview and Reviews only, with every fact we list but no menu. Until 8 Oct 2026 that counted as a slowdown, which held complete cafés and rested the loop for 1.5 hours; the first real run lost almost 2 hours to it.
- **What's at risk:** the bot isn't signed into Google or Zomato, so no account is at risk. The worst case is your internet connection getting captchas for a few hours.
- **Both sites' terms forbid scraping, and photos belong to their uploaders.** Plan to replace covers and dish photos when owners claim their listings.

### Realistic expectations

- **A night gives 200–400**, depending on slowdowns and how many new places the lists still have. Zomato's café list alone has about 180 places in Indore, and the coffee list over 300 (the two overlap).
- **Zomato menus are free:** they're read as data, so there's no Claude usage and no extra storage (dish photos are off). If they're turned back on: ~70 KB each, about 3 GB for 40,000, and the real cost is Cloudinary resizes (watch Transformations on the dashboard).
- **Only printed-menu photos cost Claude usage** (Sonnet, `menuModel` in `listing-plan.json`, about 1 minute per café). If a usage limit is hit, Claude's steps pause for an hour and those cafés are held.
- **After the run, ask Claude to "check the listing run".** It reports the totals, reads any pending menu photos, and shows you anything that needs a decision.
- **Leave the laptop plugged in with the lid open.** The launcher blocks sleep, but closing the lid can still put it to sleep depending on your Windows settings.

### Stopping

- **Gracefully:** create an empty file `E:\listing\STOP`. The loop finishes the cycle it's in and exits.
- **At once:** close the "Localo listing run" window.

### Logs

`E:\listing\logs\run-<date>-<time>.log`: one line per place, cycle totals, and the end reason.

## Running pieces by hand

```
npx tsx scripts/zomato-bot.ts --query "restaurants/cafes" --type cafe --limit 20 [--headful] [--list-only]
npx tsx scripts/maps-bot.ts --query "cafes in Indore" --type cafe --limit 20 [--headful]
npx tsx scripts/menu-from-photos.ts "E:\listing\cafe"
npx tsx scripts/list-business.ts "E:\listing\cafe" --summary      # what's waiting + warnings
npx tsx scripts/list-business.ts "E:\listing\cafe" --dry-run      # what would happen
npx tsx scripts/list-business.ts "E:\listing\cafe" [--auto] [--keep]
npx tsx scripts/add-menus.ts [--dry-run]                          # live listings without a menu
npx tsx scripts/listing-loop.ts --hours 0.2 --interval 2 --per-cycle 2 --dry-publish --root <scratch>   # quick test
```

## Moving to the next business type

Copy `listing-plan.json` and change `type` and the lists. Restaurants stay on Zomato (`"type": "restaurant"`, list pages like `restaurants/north-indian`; check `ZOMATO_TAGS` in `zomato-bot.ts`). Every collected place gets the type's own tag, so don't put bakery or dessert lists in a café run. Anything Zomato doesn't cover uses `"source": "maps"` with Google searches (e.g. "gyms in Vijay Nagar Indore"); check that `maps-bot.ts`'s `CATEGORY_TAGS` maps Google's categories onto that type's tags. Only food places get a menu. Other types will need their own offerings step (products / services), which isn't built yet.

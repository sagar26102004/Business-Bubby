# Bulk listing plan: Zomato, Google Maps & more → Localo

How real Indore businesses get onto Localo in bulk, one business type at a time (cafés first), without the register wizard. Everything here runs as the platform **super-admin** (`sagar`), but **every listing is handed to its own account** right after it's published (since 13 Oct 2026): username = the business name squashed to a handle (`Amigos Café & Restaurant` → `amigoscafeandrestaur`, a number added for a second branch), one shared password (`OWNER_PASSWORD` in `scripts/.listing.env`, gitignored, never written here). The handles are recorded in `E:\listing\shared\owner-accounts.json` and printed on the outreach sheet, so the owner can sign in straight away. The listing shows **"Listing inactive"** until someone signs in to that account; the sign-in trigger (migration 0028) then flips it to active. `scripts/owner-accounts.ts` does the same for anything still under the super-admin (`--dry-run` first to see the handles).

**Food places come from Zomato, not Google Maps (Sagar's decision, 8 Oct 2026).** By October 2026 Google served our automated browser a reduced place page (Overview and Reviews only, no menu), and the first real run lost almost 2 hours to it. Every Zomato restaurant page carries the whole listing as data: name, exact pin, address, phone, the week's hours, the featured photo and the full menu with prices, veg marks and dish photos. So the menu needs no Claude at all. **Dish photos are off for now** (Sagar, 8 Oct 2026): 40,000 of them would be ~3 GB of Cloudinary plus a resize per photo per size viewed. `MAX_DISH_PHOTOS` in `zomato-bot.ts` turns them back on; the publisher already uploads them. `maps-bot.ts` stays for business types Zomato doesn't cover (gyms, salons…).

## Many bots → merge → publish: every other kind of business (since 13 Oct 2026)

Sagar's goal (13 Oct 2026): **as many Indore businesses on board as possible, of every type.** Food stays on the Zomato pipeline below. Everything else goes through three separate stages. Bots only **collect**, a merge builds **one final file**, and the publisher lists from it.

```
E:\listing\
  food data\     the Zomato / café pipeline below (cafe\, _menus\, demo\, logs\, loop-state.json, zomato-seen.json, .zomato-profile\)
  shared\        published-keys.json, owner-accounts.json, outreach-sent.json — used by every bot and the publisher
  google-maps\   records.jsonl · state.json · logs\          ← one folder per collector bot
  osm\           records.jsonl · raw\<city>-<date>.json · logs\
  magicpin\      records.jsonl · state.json · logs\
  practo\        records.jsonl · state.json · logs\
  merged\        businesses.json (THE final file) · review.json · decisions.json · merge-report.txt
  ready\<tag>\<Place>\   listing.json + cover.jpg, made from merged\ for list-business.ts
```

Paths come from `LISTING_ROOT` / `SHARED_DIR` / `FOOD_ROOT` in `scripts/listing-lib.ts`, never typed by hand.

### 1. Collect: `scripts/collect/<bot>.ts`

Every bot writes the same `RawRecord` (`scripts/collect/record.ts`), one JSON line per place, into its own `records.jsonl`. It **keeps everything the site gives**, even what the app doesn't use yet: all phones, emails, website, socials, full address, pin, plus code, the week's hours, rating, categories, amenities, payment methods, services, photos, and anything else under `extra`. A bot never publishes and never reads another bot's folder. Each one remembers where it stopped (`state.json`), stops by itself at the first block or captcha, and obeys `E:\listing\STOP` (all bots) or `E:\listing\<bot>\STOP` (one bot).

| Bot | Source | How | Gives | Speed |
|---|---|---|---|---|
| `google-maps.ts` | Google Maps search | Edge, one tab; **never opens a place**. It reads the result data Google sends while the list scrolls (`/search?tbm=map`), which already has phone, all 7 days of hours, website, every category, address, pin, place id, rating, photos, claimed or not, the Hindi name and About attributes | the main source, most complete | **~100 places per search in ~25 s** (old maps-bot: ~20 an hour) |
| `osm.ts` | OpenStreetMap (Overpass API) | one request for the whole bbox; ODbL, credit "© OpenStreetMap contributors" | names, pins, categories; phone on ~60%, hours on ~20%, some emails/websites. Strong on health | the whole city in seconds (3,577 businesses on 13 Oct) |
| `magicpin.ts` | magicpin.in | plain requests, no browser: list pages (schema.org ItemList) → store pages (`merchantData`) | salons, spas, fashion, electronics, grocery, pharmacy, fitness, hotels: phone, hours, address | ~2–3 s a store |
| `practo.ts` | practo.com | plain requests: speciality list pages (one schema.org block per doctor) | **clinics with their doctors**, specialities, fees, clinic photos, exact pins. No phone (Practo routes calls) | ~2–3 s a page of 10 |

**What Google searches for** lives in `scripts/collect/plan.json`: groups (`health`, `shops`, `beauty-fitness`, `services`, `education`, `stay`, plus `food`, off by default) of everyday category words. Each category is searched city-wide first. Google stops a search at ~100–120 results, so a category that hits that cap is **dense** and is searched again tile by tile over a grid of map views covering the bbox (`tileStep` 0.03° ≈ 3 km, zoom 15). Places are deduplicated by Google place id across every search.

**Sites tried and dropped (13 Oct 2026), so nobody re-tries them blind:**
- **JustDial:** blocks automated browsers at the connection (headless: HTTP/2 error; visible window: endless redirect).
- **Sulekha:** hides every phone behind a "get quotes" lead form.
- **IndiaMART:** its numbers are IndiaMART's own call-forwarding numbers (+91-80…), not the seller's, and listings have no pins.

**Data traps already handled:** magicpin drops stores it can't place on the city centre, and files some out-of-state stores under Indore. The bot skips out-of-state addresses, and the merge ignores any exact pin that more than 3 records of one site share.

### 2. Merge: `scripts/merge-listings.ts` → `merged\businesses.json`

Reads every bot folder's `records.jsonl` (any folder except `food data`, `shared`, `merged`, `ready`). **Same business** when any strong key matches:
- the **same phone**, and the two are within 1 km (or 5 km with the identical name). A number on more than 3 records of one site is a call centre and never a key. Within ONE site a shared number also needs similar names (a doctor and the lab in the same building share a number, and the site already lists them as two);
- the **same website host or Instagram handle**, same rule (generic hosts like business.site and justdial.com never count);
- the **same name, or one inside the other, within 150 m**, across sites only, so a chain's branches in one site stay apart.

Names "similar" ignores the words that say what kind of place it is (clinic, store, gym, medical, Dr…). Pairs that are only *maybe* the same (similar name within 50 m, no strong key) go to **`review.json`**, and both are held until `decisions.json` says `"<keyA>|<keyB>": "same"` or `"different"`.

**Fields:** lists (phones, emails, categories, photos, amenities, services) are unioned. A single value comes from the most trusted site that has one: **google-maps > practo > zomato > justdial > indiamart > magicpin > sulekha > osm** (`SOURCE_PRIORITY`). Hours only come from a site that has all 7 days. `fieldSources` records where each value came from, and pins that disagree by more than 300 m are listed in the report.

**Tags:** `scripts/collect/category-tags.ts` maps every site's category words (Google "Hardware store", OSM "shop=hardware") onto `TAG_CATALOG` names, plus `shop`/`service`. The report lists the **unmatched categories with counts**: add a rule, re-run. No tag means not publishable.

**Already listed:** every merged business is checked against the live listings (same name within 150 m, or the same phone within 1 km) and `shared\published-keys.json`. Matches stay in the file as `alreadyListed` (useful later to fill in a live listing's missing email or website) and are never re-published. Food is held unless `--include-food`. **Publishable** = has a tag, a pin, a phone or an address, isn't already listed, isn't food, and isn't waiting in review.

**Every listing gets one real photo (Sagar, 13 Oct 2026: "only one real photo makes the listing look authentic").** A business with no photo is held (`NO_PHOTO`). Stock pictures don't count: the merge drops any photo URL that more than 3 records of one site share (magicpin puts one stock image on every store without a photo). The **photo fill** (`google-maps.ts --fill-photos`, run automatically by `collect-all` after the first merge) then looks up every business held only for a photo on Google, by its own name at its own pin (~4 s each). It accepts a result within 150 m with a matching name, or the same phone within 1 km. It saves Google's FULL record, so the photo comes with phone, hours and website, and the merge runs again. In a test, 5 of 8 found a photo. Most OSM places will already have been found by the category searches, so the fill only handles the leftovers.

### 3. Publish: `scripts/build-ready.ts` → `list-business.ts`

`build-ready.ts [--tags "Gym,Salon"] [--limit N]` turns publishable merged businesses into `ready\<first tag>\<name>\listing.json` + `cover.jpg` (the most trusted source's photo, 1000 px wide for Google photos, so about a third of the bytes of the 1600 px original; the next photo is tried if one won't download). The proven publisher then runs unchanged: `list-business.ts "E:\listing\ready\Gym" --summary`, then `--dry-run`, then the real run. Its own duplicate check, owner account and "Listing inactive" all still apply. `listing.json` now also carries `email`, `website` and `socials`; the publisher writes them as `Business.email`, `Business.website` and `showcaseLinks`. The other phones, emails and categories ride along under `source` (not shown in the app). Non-food listings go live with **no products/services list** (Sagar, 13 Oct). Owners add those when they claim the listing.

### Running it

```
npx tsx scripts/collect-all.ts [--bots google-maps,osm] [--group health] [--no-merge] [--no-photo-fill]   # all bots at once, merge, photo fill, merge
npx tsx scripts/collect/google-maps.ts [--group health | --categories "gym,salon"] [--no-tiles] [--max-searches N] [--headful]
npx tsx scripts/collect/google-maps.ts --fill-photos [--max N]                     # a Google photo for every merged business that has none
npx tsx scripts/collect/osm.ts [--refresh]
npx tsx scripts/collect/magicpin.ts [--categories "Salon,Fitness"] [--max-pages N] [--max-stores N]
npx tsx scripts/collect/practo.ts [--specialities "dentist"] [--max-pages N]
npx tsx scripts/merge-listings.ts [--include-food] [--offline]
npx tsx scripts/build-ready.ts --tags "Gym" --limit 20
npx tsx scripts/list-business.ts "E:\listing\ready\Gym" --summary
```

`/collect-businesses` launches `collect-all` in its own window (`scripts/collect-all.ps1`, keeps Windows awake). The bots run **at the same time**, since each talks to a different site and writes only its own folder. A full Google pass is a few thousand searches (hours). It resumes where it stopped, so run it over several nights. After a run, ask Claude to "check the collect run".

## The pieces (all in `scripts/`, run with `npx tsx` from the repo root)

| Script | Job | Touches the live app? |
|---|---|---|
| `zomato-bot.ts` | **Food places.** Walks a Zomato list page and makes one folder per new place, menu and dish photos included | No |
| `maps-bot.ts` | Other business types. Searches Google Maps and makes one folder per new place | No |
| `menu-from-photos.ts` | Gets each place a `menu.json` from the best source that has one (the menu rule, below) | No |
| `zomato.ts` | Finds the place's Zomato page in our own browser for the menu rule | No |
| `add-menus.ts` | Gives **live** food listings that have no menu one (Zomato, then the web), as the super-admin | **Yes** |
| `list-business.ts` | Signs in as super-admin, publishes each ready folder, then gives it its own owner account | **Yes** |
| `owner-accounts.ts` | Gives every listing still under the super-admin its own account (`--dry-run`, `--limit N`) | **Yes** |
| `export-contacts.ts` | Outreach list of every published food place (super-admin's listings): `E:\listing\food data\food-contacts.xlsx` (+ `.csv`), business name + contact number, one sheet per city, one row per number. With `--link` each row gets a WhatsApp **Send** link carrying `outreach-message.txt` (sending stays manual). Re-run after each run; Sent?/Notes and the link are kept, new places marked | No (reads only) |
| `outreach-sender.ts` | Local page that walks the outreach sheet: opens each chat in WhatsApp with the message typed, **you** press send, it records it in `E:\listing\shared\outreach-sent.json` (copied into Sent? on the next export). No daily limit unless `--daily N`; `--city` starts on one city. Never sends by itself: automating WhatsApp gets the number banned | No |
| `listing-loop.ts` | The unattended schedule: collect → publish, every 30 min | Yes, through the publisher |
| `start-listing.ps1` | Launcher: own window, keeps Windows awake | — |
| `listing-lib.ts` | Shared helpers: env, duplicate key, key file | — |
| `listing-plan.json` | The schedule and the list of searches | — |

Secrets live in `scripts/.listing.env` (gitignored): `LISTING_LOGIN`, `LISTING_PASSWORD`, `OWNER_PASSWORD`. Menus are read by Claude Code itself (the `claude` CLI, signed in as you); there's no separate AI key. Gemini was tried and dropped on 2026-10-07: it was overloaded for hours, and when it did answer it read 123 dishes from a menu where Claude read about 200.

## A collected place: `E:\listing\food data\<type>\<Place name>\`

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
- **Every new place is checked against all live listings (any owner), `E:\listing\shared\published-keys.json` and every local folder.** This happens before it's collected and again right before it's published.
- **Zomato and Google spell names differently** ("Habit - Coffee Lounge" on Google can be "Habit" on Zomato). The exact key misses that, but the similar-name check (one name inside the other, within 50 m) catches it and **holds** the place for a person instead of listing it twice.
- **`E:\listing\food data\zomato-seen.json`** records every Zomato page already opened, so a page is never opened twice, even when it turned out to be a duplicate.
- **Publishing writes the key to `published-keys.json` and then deletes the folder** (`--keep` keeps it). The file is the permanent record of everything listed.

## `/start-listing` and `/start-listing-zomato`: the unattended run

Two commands, one loop; they differ only in where places come from:

| Command | Source | Lists in `listing-plan.json` |
|---|---|---|
| `/start-listing-zomato` | **Zomato only** (`zomato-bot.ts`): menus as data, no Google traffic | `zomatoQueries` |
| `/start-listing` | Google Maps (`maps-bot.ts`), menus from the ladder | `queries` |

Both take the same arguments: `/start-listing-zomato 4` for 4 hours, or `/start-listing-zomato 10 dry` to collect without publishing.

**Cities (Zomato only, 9 Oct 2026).** Add city names: `/start-listing-zomato 8 bhopal delhi` (any order, spaces or commas). With none, the run uses `cities` in `listing-plan.json` (Indore). Cities run **in the order given**: the first city walks every `zomatoQueries` list, then the run moves on to the next. Each city remembers its own position in `loop-state.json` → `zomatoCities`, so a city that's used up (Indore, after the 8 Oct run) is skipped at once. Delhi, New Delhi, Noida, Gurgaon and Ghaziabad are all Zomato's **`ncr`** (`zomatoCity` in `zomato-bot.ts`), so they count as one city. `zomato-seen.json` stores places outside Indore as `city/slug`. Underneath, this is `start-listing.ps1 -Cities "bhopal,delhi"` → `listing-loop.ts --cities bhopal,delhi`. Claude runs pre-flight checks and opens a PowerShell window titled **"Localo listing run - zomato"** (or `- maps`), which runs `listing-loop.ts --source zomato|maps` through `start-listing.ps1 -Source`. Never run both at once: they share `E:\listing\food data\cafe`.

Every **30 minutes** (one *slot*) the loop runs one cycle:
1. If `E:\listing\food data\STOP` exists, stop.
2. Retry menu photos that couldn't be read last time.
3. Collect up to **20** new places from the run's source (`zomato`: the `zomatoQueries` list pages, e.g. `restaurants/cafes`; `maps`: the Google `queries`). It walks the list in order and moves on when one has nothing new left. Each source's position is saved in `E:\listing\food data\loop-state.json` (`zomatoCities.<city>` / `queryIndex`; an old `zomatoQueryIndex` is moved to `zomatoCities.indore` on load), so the next run continues from there.
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
  - a persistent browser profile (`E:\listing\food data\.zomato-profile`), so Zomato sees a returning visitor with its own cookies;
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

- **Gracefully:** create an empty file `E:\listing\food data\STOP`. The loop finishes the cycle it's in and exits.
- **At once:** close the "Localo listing run" window.

### Logs

`E:\listing\food data\logs\run-<date>-<time>.log`: one line per place, cycle totals, and the end reason.

## Running pieces by hand

```
npx tsx scripts/zomato-bot.ts --query "restaurants/cafes" --type cafe --limit 20 [--headful] [--list-only]
npx tsx scripts/maps-bot.ts --query "cafes in Indore" --type cafe --limit 20 [--headful]
npx tsx scripts/menu-from-photos.ts "E:\listing\food data\cafe"
npx tsx scripts/list-business.ts "E:\listing\food data\cafe" --summary      # what's waiting + warnings
npx tsx scripts/list-business.ts "E:\listing\food data\cafe" --dry-run      # what would happen
npx tsx scripts/list-business.ts "E:\listing\food data\cafe" [--auto] [--keep]
npx tsx scripts/add-menus.ts [--dry-run]                          # live listings without a menu
npx tsx scripts/export-contacts.ts [--link <download url>] [--out <file.xlsx>] [--all-types]   # owner outreach list
npx tsx scripts/outreach-sender.ts [--city Indore] [--daily N] # http://localhost:8790: open each chat, YOU press send
npx tsx scripts/listing-loop.ts --hours 0.2 --interval 2 --per-cycle 2 --dry-publish --root <scratch>   # quick test
```

## Moving to the next business type

Copy `listing-plan.json` and change `type` and the lists. Restaurants stay on Zomato (`"type": "restaurant"`, list pages like `restaurants/north-indian`; check `ZOMATO_TAGS` in `zomato-bot.ts`). Every collected place gets the type's own tag, so don't put bakery or dessert lists in a café run. **Non-food types no longer go through this loop.** They use the collector bots and the merge ("Many bots → merge → publish" above): add the category words to `scripts/collect/plan.json` and any missing tag rule to `scripts/collect/category-tags.ts`. Only food places get a menu; non-food listings go live without products or services until the owner adds them.

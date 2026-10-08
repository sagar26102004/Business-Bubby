# Bulk listing plan: Google Maps → Localo

How real Indore businesses get onto Localo in bulk, one business type at a time (cafés first), without the register wizard. Everything here runs as the platform **super-admin** (`sagar`), who owns each listing until the real owner claims it (Reassign owner panel).

## The pieces (all in `scripts/`, run with `npx tsx` from the repo root)

| Script | Job | Touches the live app? |
|---|---|---|
| `maps-bot.ts` | Searches Google Maps and makes one folder per new place | No |
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
| `cover.jpg` | the place's main Google photo, full size |
| `menu 1.jpg` … | the printed-menu photos, full size (`=w2000`) |
| `menu.json` | the menu, in the register wizard's paste format (see CLAUDE.md, "Pasting a whole catalog"); `review.txt` says which source it came from |
| `menu.online.json` | Google's typed menu (delivery-app prices) |
| `zomato.txt` | the Zomato page text, when the menu came from Zomato |
| `review.txt` | anything a person should look at |

Folders made by hand work too. Put a `<lat>, <lng>.png` map screenshot (its file name is the pin), `cover.jpg`, `1.jpg…` (showcase) and `menu.json` in the folder; Claude writes the `listing.json` from the screenshot.

## The menu rule: any menu beats no menu

Sagar's rule (8 Oct 2026): get the menu **from wherever it can be found**. `ensureMenu` in `menu-from-photos.ts` tries these in order and keeps the first that works:

1. **Menu photos** from Google, read by Claude. These are the in-café prices, so they come first.
2. **Google's typed menu** (delivery-app prices). Used when there are no photos, or when Claude can't read them.
3. **Zomato.** Our own browser searches Zomato for the place and opens its order page (`zomato.ts`). The page is **accepted only when its phone number matches the one Google gave us**, or the exact name plus two address words, or a close name (one inside the other) plus three address words. Claude then turns the page text into the menu, using the original (not discounted) price. Swiggy is not used, because it shows bots an error page.
4. **The wider web:** Claude searches the place's own site, Magicpin and similar, again accepting only a page that is clearly this place. It rarely finds anything, because Claude's own web tools can't open Zomato or Swiggy.
5. **Nothing found:** the place is listed without a menu.

Claude runs headless (`claude -p`, Sonnet, on your Claude plan) with only the tools each step needs, and every reply is checked by the publisher's parser before it's saved. A place is **held** only when it has menu photos that Claude couldn't read *and* no other source worked. It's retried in the next cycle.

## Never listing the same business twice

- **The key is the normalised name plus the location.** "Amigos Café & Restaurant" becomes `amigoscafeandrestaurant`, and two listings count as the same when their pins are within **150 m**. Another branch of a chain, further away, still gets listed. A *similar* name within 50 m only raises a warning.
- **Every new place is checked against all live listings (any owner), `E:\listing\published-keys.json` and every local folder.** This happens before it's collected and again right before it's published.
- **Publishing writes the key to `published-keys.json` and then deletes the folder** (`--keep` keeps it). The file is the permanent record of everything listed.

## `/start-listing`: the unattended run

Type `/start-listing` (optionally `/start-listing 4` for 4 hours, or `/start-listing 10 dry` to collect without publishing). Claude runs pre-flight checks and opens a PowerShell window titled **"Localo listing run"**, which runs `listing-loop.ts`.

Every **30 minutes** (one *slot*) the loop runs one cycle:
1. If `E:\listing\STOP` exists, stop.
2. Retry menu photos that couldn't be read last time.
3. Collect up to **20** new places. It walks the searches in `listing-plan.json` in order and moves on when one has nothing new left. The position is saved in `E:\listing\loop-state.json`, so the next run continues from there.
4. Publish everything that's safe without a person (`list-business --auto`). Anything else is **held**: left in its folder for later.

| Outcome | When |
|---|---|
| **Published** | menu from any source (or none exists anywhere), full hours, no duplicate, no similar name nearby |
| **Held** | menu photos Claude couldn't read yet *and* no other menu source worked, opening hours incomplete, similar name within 50 m, or the Maps page loaded only partly |
| **Dropped** | exact duplicate; recorded in the key file, folder deleted |

10 hours = 20 slots = **up to 400 places**.

### Safety and back-off

- **Pace:** 3–8 s between places and 20 places per 30 minutes is the top of the safe range for Google Maps. Faster than that is what got us slowed down while testing.
- **If Google slows the collector down** (3 places in a row fail to load, or a captcha page), the loop **rests for 3 slots (1.5 h)**. Two slowdowns in a row **end the run**, so try again the next day.
- **What's at risk:** the bot isn't signed into Google, so no Google account is at risk. The worst case is your internet connection getting captchas from Google for a few hours.
- **Google's terms forbid scraping, and cover photos belong to their uploaders.** Plan to replace covers when owners claim their listings.

### Realistic expectations

- **A night gives 200–400**, depending on Google slowdowns and how many places each search really has.
- **Menus cost time and Claude usage.** Each café takes about 1 minute (photos or Zomato) on Sonnet (`menuModel` in `listing-plan.json`), and that counts against your Claude plan's usage. If a usage limit is hit, Claude's steps pause for an hour. Cafés still get Google's typed menu where there is one; only cafés with unread photos and no other source are held.
- **After the run, ask Claude to "check the listing run".** It reports the totals, reads any pending menu photos, and shows you anything that needs a decision.
- **Leave the laptop plugged in with the lid open.** The launcher blocks sleep, but closing the lid can still put it to sleep depending on your Windows settings.

### Stopping

- **Gracefully:** create an empty file `E:\listing\STOP`. The loop finishes the cycle it's in and exits.
- **At once:** close the "Localo listing run" window.

### Logs

`E:\listing\logs\run-<date>-<time>.log`: one line per place, cycle totals, and the end reason.

## Running pieces by hand

```
npx tsx scripts/maps-bot.ts --query "cafes in Indore" --type cafe --limit 20 [--headful]
npx tsx scripts/menu-from-photos.ts "E:\listing\cafe"
npx tsx scripts/list-business.ts "E:\listing\cafe" --summary      # what's waiting + warnings
npx tsx scripts/list-business.ts "E:\listing\cafe" --dry-run      # what would happen
npx tsx scripts/list-business.ts "E:\listing\cafe" [--auto] [--keep]
npx tsx scripts/add-menus.ts [--dry-run]                          # live listings without a menu
npx tsx scripts/listing-loop.ts --hours 0.2 --interval 2 --per-cycle 2 --dry-publish --root <scratch>   # quick test
```

## Moving to the next business type

Copy `listing-plan.json`, change `type` and the searches (e.g. "gyms in Vijay Nagar Indore"), and check that `maps-bot.ts`'s `CATEGORY_TAGS` maps Google's categories onto that type's tags. Only food places get a menu. Other types will need their own offerings step (products / services), which isn't built yet.

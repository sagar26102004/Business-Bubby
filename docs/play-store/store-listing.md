# Store listing — copy and assets

Everything for Play Console → **Grow → Store presence → Main store listing**. The copy below is
final text, not placeholder: paste it as-is, or edit it, but do not ship lorem.

Character limits are hard — the console rejects anything over.

---

## App name  *(30 characters max)*

```
One Place
```
*9 characters.* Matches `app.json` → `expo.name`, which is what shows under the launcher icon.

If you want the extra searchability, this also fits and is legal (no keyword stuffing, no
competitor names, no "best"/"#1"):

```
One Place: Local Businesses
```
*27 characters.*

---

## Short description  *(80 characters max)*

**Recommended:**
```
Find shops, services and stalls near you — order, book, chat and call.
```
*70 characters.*

Alternatives, all within limit:

```
Your neighbourhood in one app: local shops, services, rentals and stalls.
```
*72 characters.*

```
Discover local businesses near you. Order, book appointments, sell your stuff.
```
*77 characters.*

This line appears under the title in search results and does more work than anything else in the
listing. Lead with what someone gets, not what the app is.

---

## Full description  *(4000 characters max)*

Roughly 2,900 characters — room to add if you want.

```
One Place is the local directory for everything around you — the shops, the services, the people
renting things out, and the neighbours selling what they no longer need.

Open it and you see what is actually near you, sorted by distance. No feed, no algorithm deciding
what deserves your attention. Just your neighbourhood.


FIND WHAT IS AROUND YOU

• Browse by what you need — food, health, home services, rentals, electronics and more
• Search shops, dishes, services and items by name
• See real distances and opening hours before you go
• Open a real street map and see everything plotted around you
• Scan a shop's QR code to open its page instantly


DEAL WITH BUSINESSES DIRECTLY

• Order products or a meal, and see the bill before you pay
• Book an appointment for a service
• Message a business and get an answer from a real person
• Call a business inside the app — no phone number is exchanged, in either direction
• Keep every order and bill in one place instead of scattered across chats


A STALL FOR YOUR OWN THINGS

Selling a phone, a bicycle, furniture you no longer need? Put it up in minutes with a photo and a
price. Everything you sell lives in one stall under your name.

Buyers ask questions and make offers on a public thread under each item, so the next person to
wonder the same thing finds it already answered.


RUN YOUR BUSINESS FROM YOUR PHONE

Listing a business is free and takes a few minutes.

• Publish your menu, services, products or rentals with prices
• Take orders and issue bills from your phone
• Answer customer chats and calls, or hand that to your team
• Add managers and staff, and control what each of them can see
• Run monthly plans — a gym membership, a tuition batch, a bus seat
• Show your work in a photo and video showcase
• Get honest ratings from customers who actually bought something


LIVE VEHICLE TRACKING

If you run vehicles — a school bus, a delivery van, a goods truck — your drivers can share their
live position for a shift. The business sees the whole fleet. A parent sees only the bus their
child is on. Drivers switch it on and off themselves, and it is off by default.


BUILT HONESTLY

• Only verified customers can leave a rating, so scores mean something
• Your phone number is never shown to a business unless you become their customer
• No advertising trackers, and no selling your data to anyone
• Browse the whole directory without an account
• Delete your account from inside the app, whenever you want

Made in India, for Indian neighbourhoods.
```

**Formatting notes:** Play supports very little markup — plain text, line breaks, and a few HTML
tags. Use capitals for headings as above rather than markdown `#`, which renders literally. Bullets
with `•` are safe. Do not use emoji in the full description; they render inconsistently across
Android versions.

---

## Assets — exact requirements

### App icon — required
| | |
|---|---|
| Size | **512 × 512 px** |
| Format | 32-bit PNG **with** alpha |
| Max file size | 1 MB |
| **Ready to upload** | **`docs/play-store/play-icon-512.png`** — already generated for you (512×512 RGBA, 79 KB) |

`assets/icon.png` is **1024×1024**, which Play rejects for the store icon — it wants exactly
512×512. The file above is that same icon resized with Lanczos resampling. Regenerate it if you
ever change the app icon:

```bash
python -c "from PIL import Image; Image.open('assets/icon.png').convert('RGBA').resize((512,512), Image.LANCZOS).save('docs/play-store/play-icon-512.png', optimize=True)"
```

Keep the important content away from the outer ~10%: Play and launchers mask icons into circles,
squircles and rounded squares. The in-app adaptive icon is separate and already configured
(`app.json` → `android.adaptiveIcon`).

### Feature graphic — required
| | |
|---|---|
| Size | **1024 × 500 px** |
| Format | PNG or JPEG, **no alpha** |
| Max file size | 15 MB |
| **Ready to upload** | **`docs/play-store/play-feature-graphic-1024x500.png`** — already generated (1024×500 RGB, no alpha, 31 KB) |

This is the banner at the top of your store page. Two rules that matter more than the design:
**no screenshots of the app inside it**, and **keep text away from the edges** — it gets cropped on
some surfaces. A clean background, the icon, the name, and one short line ("Your neighbourhood, in
one app") is enough.

The generated file is exactly that: the app mark, the name, and the tagline on the same black the
icon and splash use. Regenerate it after any icon change — it composes from `assets/icon.png`, so
the banner cannot drift from the launcher mark:

```bash
python scripts/make-feature-graphic.py
```

### Phone screenshots — required
| | |
|---|---|
| Count | Minimum **2**, maximum **8**. Provide **6–8** — listings with more convert better |
| Size | Each side between 320 px and 3840 px; longest side no more than twice the shortest |
| Recommended | **1080 × 1920 px** portrait |
| Format | PNG or JPEG |
| Max file size | 8 MB each |
| **Ready to upload** | **`docs/play-store/screenshots/`** — five captured at 1080×1920. Read that folder's `README.md`: they must be **re-captured after the data cleanup**, and two more are still owed. |

Capture them with `node scripts/play-screenshots.mjs` against a running `npx expo start --web`
rather than by hand, so the whole set can be redone in one command whenever the data changes.

**Shoot these six, in this order** — the first two are what people actually see in search results,
so lead with the strongest:

1. **Home** — the category strip and nearby businesses, showing real distances
2. **A business page** — hero, menu or services with prices, and the rating
3. **The Stalls grid** — the picture-first grid of items people are selling
4. **An order or a bill** — proof that transactions genuinely happen in the app
5. **The map** — real street map with businesses plotted around you
6. **An in-app voice call or chat** — the feature nothing else in this category has

Optional but effective: add a short caption band above each screenshot ("See what's actually near
you", "Order and get a bill", "Call a shop without sharing your number"). Plain screenshots convert
noticeably worse than captioned ones.

⚠️ **Every screenshot must come from a build with real-looking content.** A screenshot showing
"Demo Cafe" or an empty state reads as an unfinished app. Take them after the production data
cleanup, with a few genuine listings visible.

### Tablet screenshots — optional
Skip them unless you want tablet placement. If you do add them: 7-inch and 10-inch, same rules,
minimum 2 each. Play will show a "not optimised for tablets" note without them, which is harmless.

### Promo video — optional
A YouTube URL. Skip it for v1. *(There is no background-location demo video in 1.0 — that feature
is deferred to v1.1. When it returns, that video is **not** this field and must never be attached
here; it goes only in the permission declaration form.)*

---

## The rest of the listing form

| Field | Answer |
|---|---|
| App category | **Shopping** — best fit. *Business* is defensible if you emphasise the workspace, but the customer directory is what most people open it for. |
| Tags | Choose from Play's fixed list — "Shopping", "Local", "Marketplace" as available |
| Contact email | `rathoresagar26@gmail.com` (shown publicly on the listing) |
| Contact website | The hosted `support.html` URL |
| Contact phone | Optional — leave blank; it is published publicly |
| Privacy policy | The hosted `privacy-policy.html` URL — must be **byte-identical** to `PRIVACY_POLICY_URL` in `src/lib/legal.ts` |
| Default language | English (India) — `en-IN` |
| Countries | India for launch. Add others later; you cannot easily un-launch a country. |
| Content rating | Complete the questionnaire honestly. Expect **PEGI 3 / Everyone**. Answer **yes** to "user-generated content" and "user-to-user communication" — the app has chat, calls and reviews. Getting this wrong is a policy violation. |
| Ads | **No** — the app contains no third-party ad SDK. Promoted listings are first-party. See `data-safety.md` §8. |
| In-app purchases | **No** — no payment gateway; money settles off-app. |
| Target audience | **18 and over** |

---

## Before you paste

- [ ] Title ≤ 30 chars, short description ≤ 80, full description ≤ 4000
- [ ] No "#1", "best", "top" or competitor names anywhere — Play rejects superlative claims
- [ ] No mention of features that are not in the shipped build
- [ ] Screenshots taken from a production build with real listings, after the data cleanup
- [ ] Privacy policy URL identical to `src/lib/legal.ts`
- [ ] Contact email is one you actually read — deletion and privacy requests arrive here

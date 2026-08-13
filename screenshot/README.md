# Play Store screenshots — capture these six

**This folder is empty on purpose.** No usable screenshots could be generated automatically — see
"Why not automated" at the bottom. Capture them on a real phone and drop the PNGs in here.

---

## Requirements (Play, phone screenshots)

| | |
|---|---|
| Count | Minimum **2**, maximum **8**. Supply **6** |
| Recommended size | **1080 × 1920 px**, portrait |
| Allowed | Each side 320–3840 px; longest side ≤ 2 × shortest |
| Format | PNG or JPEG, max 8 MB each |

A phone screenshot from any modern Android device is already 1080×2400 or similar, which is
within spec. **Do not crop or resize** — upload what the phone produces.

---

## Capture them from a real device

1. Install the preview build:
   ```bash
   eas build --platform android --profile preview
   ```
   Then install the APK on your phone.

2. Make sure the app has **real content** on screen — take these *after* the production data
   cleanup in `docs/play-store/production-setup.md`, with a few genuine listings visible. A
   screenshot showing "Demo Cafe" or an empty list reads as an unfinished app and is the most
   common reason a good listing converts badly.

3. Take each shot with the phone's own screenshot gesture, then pull them across:
   ```bash
   adb devices                                   # confirm the phone is connected
   adb pull /sdcard/Pictures/Screenshots ./screenshot
   ```
   Or capture directly, one at a time, with the screen already on the right page:
   ```bash
   adb exec-out screencap -p > screenshot/01-home.png
   ```

---

## The six shots, in upload order

Play shows the first two in search results, so the order matters more than the count.

| # | File name | Screen | What must be visible |
|---|---|---|---|
| 1 | `01-home.png` | Home | Category strip, "Deals near you", nearby businesses with real distances |
| 2 | `02-business.png` | A business page | Hero image, menu or services **with prices**, star rating |
| 3 | `03-stalls.png` | Stalls | The picture-first grid of items people are selling |
| 4 | `04-order.png` | An order or bill | Line items and a total — proof real transactions happen here |
| 5 | `05-map.png` | Map | Real street map with businesses plotted and the distance rings |
| 6 | `06-call-or-chat.png` | Voice call or chat | The feature no other directory app has |

Optional but worth it: add a caption band above each image ("See what's actually near you",
"Order and get a bill", "Call a shop without sharing your number"). Captioned screenshots convert
noticeably better than bare ones.

**Do not include:** the Expo dev-client banner, any debug overlay, the Dev Tools screen, or a
status bar showing a low battery / no signal.

---

## Why not automated

The dev server renders the app at desktop width in a browser, and this project's web layout is
deliberately responsive — `useResponsive()` switches desktop to a full-width multi-column layout
that is **not what a phone user sees**. Browser window resizing did not change the captured
viewport, so every automated capture came out 1568 × 709 landscape in the desktop layout: wrong
aspect ratio, wrong layout, and rejected by Play regardless.

Screenshots of the actual phone build are the only ones worth uploading.

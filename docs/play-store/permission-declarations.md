# Permission declarations — justification text for the Play Console

Some permissions require a written justification in **Play Console → App content → Sensitive app
permissions**, and Google reads them. The text below is written to be pasted as-is: it names the
feature, says why the permission is the only way to build it, and says what happens when it is
denied. That last part matters — a permission the app cannot survive without reads as a red flag.

Verified against the codebase on **13 August 2026**.

**Permissions the app declares** (`app.json` → `android.permissions`, plus config plugins and
`modules/call-notification/android/src/main/AndroidManifest.xml`):

| Permission | Declared where | Needs a form? |
|---|---|---|
| `ACCESS_BACKGROUND_LOCATION` | `app.json` + expo-location plugin | **Yes — with a demo video** |
| `ACCESS_FINE_LOCATION` / `ACCESS_COARSE_LOCATION` | `app.json` | No |
| `USE_FULL_SCREEN_INTENT` | call-notification module manifest:11 | **Yes** |
| `SYSTEM_ALERT_WINDOW` | `@config-plugins/react-native-webrtc` | Only if challenged |
| `RECORD_AUDIO` | `app.json` + WebRTC plugin | No, but be ready |
| `CAMERA` | `app.json` + expo-camera/image-picker plugins | No, but be ready |
| `FOREGROUND_SERVICE` / `FOREGROUND_SERVICE_LOCATION` | `app.json` | Type must be declared |
| `WAKE_LOCK`, `BLUETOOTH`, `MODIFY_AUDIO_SETTINGS`, `INTERNET`, `ACCESS_NETWORK_STATE`, `VIBRATE` | various | No |

---

## 1. ACCESS_BACKGROUND_LOCATION — the hard one

This is the permission that causes multi-week review loops. Google requires the justification
below **and** a demo video (see `demo-video-script.md`) **and** a prominent in-app disclosure shown
before the OS prompt. All three exist; the disclosure is
`src/features/fleet/BackgroundLocationDisclosure.tsx`, called from `startBackgroundShare()` in
`src/lib/backgroundLocation.ts:114`, *before* `requestBackgroundPermissionsAsync()` on line 116.

**Paste this:**

> One Place is a local business directory where businesses can also run a vehicle fleet — school
> buses, delivery vans, goods trucks.
>
> A business assigns a driver to a vehicle. At the start of a shift, that driver opens the app and
> switches on "Share my live location". While it is on, the vehicle's position appears on a live
> map to two audiences only: the business that owns the vehicle, and customers who have something
> riding on it — a parent tracking the school bus their child is on, or a customer tracking a
> parcel in transit. The driver switches it off at the end of the shift and the vehicle disappears
> from the map.
>
> Background access is required because a driver's phone is in their pocket or mounted on a
> dashboard with the screen off for the entire journey. Foreground-only location stops updating
> the moment the app is backgrounded, which is the whole of a bus route — the map would freeze at
> the depot and the feature would not exist. This is a vehicle-tracking feature; there is no
> version of it that works only while someone is looking at the screen.
>
> Location is collected only while the driver has explicitly switched sharing on, per business.
> It is off by default, it is never enabled for customers browsing the directory, and it is never
> enabled automatically. Before the system permission dialog appears, the app shows a full-screen
> disclosure stating that One Place collects location data to enable live vehicle tracking for the
> business owner and tracking customers, and that collection continues even when the app is closed
> or not in use. The driver must accept that disclosure before the permission is requested.
>
> Only the latest position is stored — one record per driver per business, overwritten on each
> update — so no location history or movement trail is retained. Switching sharing off stops
> collection and removes the vehicle from every map immediately.
>
> If the permission is denied, One Place continues to work fully. Live sharing falls back to
> foreground-only: the vehicle updates while the driver has the app open, and simply stops
> updating when it is backgrounded. Nothing else in the app is affected — browsing, ordering,
> messaging and calling all work without any location permission at all.

**Supporting facts if a reviewer asks for detail:**
- Sampling: `Accuracy.Balanced`, every 15 seconds or 25 metres
  (`src/lib/backgroundLocation.ts:124–127`).
- A persistent foreground-service notification reads "Sharing your live location — Your vehicle is
  visible to the owner and tracking customers" (`:130–131`), so the driver can never be unaware.
- `showsBackgroundLocationIndicator: true` (`:128`).
- Storage: `location_shares`, primary key `(business_id, user_id)` — one row, replaced in place
  (`supabase/migrations/0001_schema.sql:223`).
- Declining is a first-class outcome, not an error: `{ ok: true, background: false, reason:
  'declined' }` (`:115`).

---

## 2. USE_FULL_SCREEN_INTENT

Declared at `modules/call-notification/android/src/main/AndroidManifest.xml:11`. On Android 14+
this is granted at install **only** to apps whose core function is calling or alarms; everyone
else must ask the user by hand.

**Paste this:**

> One Place includes in-app voice calling: a customer can call a business over the internet from
> inside the app, without either side revealing a phone number.
>
> When a call arrives, the recipient's phone must ring and show an answerable incoming-call screen,
> exactly as a phone call does — including when the device is locked. USE_FULL_SCREEN_INTENT is
> the Android mechanism for that: it lets the incoming-call notification take over the screen so
> the call can be answered in one tap, instead of appearing as a silent notification the user
> discovers after the caller has given up.
>
> The permission is used exclusively for incoming voice calls. It is not used for promotions,
> reminders, or any other notification. A call rings for 30 seconds and then stops.
>
> If it is denied, the app falls back to an ordinary high-priority notification carrying Answer and
> Decline actions, so calls can still be answered — but not from a locked screen without unlocking
> first.

**Cite:** the ring is posted on the `calls_v2` channel by
`modules/call-notification/.../CallNotifications.kt`; the full-screen activity is
`IncomingCallActivity`, declared with `showWhenLocked` and `turnScreenOn`. Call signalling is
`CallRepository`; the wake-up push is `supabase/functions/call-ring/index.ts`, with `ttl: 30`.

---

## 3. SYSTEM_ALERT_WINDOW

**Not declared in `app.json`.** It comes from `@config-plugins/react-native-webrtc`
(`node_modules/@config-plugins/react-native-webrtc/build/withWebRTC.js:20`), which adds it for
every app using WebRTC. The duplicate entry that used to sit in `app.json` was removed on
13 August 2026 — the manifest is unchanged, it was simply declared twice.

You do not normally need to justify this one, but have the answer ready:

> This permission is added by the WebRTC library that powers One Place's in-app voice calls. The
> app uses it as part of showing an incoming-call screen over the lock screen when a call arrives.
> It is not used to draw over other applications during ordinary use, and the app displays no
> overlay outside of an active or incoming call.

If you would rather not ship it at all, it can be stripped with a small config plugin — but doing
so risks the incoming-call screen on some OEM Android builds (Xiaomi, Oppo, Vivo in particular),
which is a worse trade than answering one question.

---

## 4. RECORD_AUDIO

No separate form, but it appears in the store listing's permission list and users see the runtime
prompt.

> One Place lets customers and businesses talk over an in-app voice call, so neither side has to
> share a phone number. The microphone is used only while such a call is connected, and audio is
> streamed live to the other participant — it is never recorded, stored or uploaded anywhere.
>
> The permission is requested at the moment the first call is placed or answered, never at startup.
> If denied, every other part of the app works normally; only voice calling is unavailable, and
> the user can still message the business in chat.

**Runtime prompt text** (`app.json` → WebRTC plugin `microphonePermission`): *"One Place uses your
microphone for in-app voice calls with businesses."*

---

## 5. CAMERA

> The camera is used for two things, both started by the user:
>
> 1. **Scanning a business's QR code.** Every listing has a printable QR code; scanning one opens
>    that business's page in the app.
> 2. **Photographing an item to sell.** When someone lists something for sale or sets a picture for
>    their business, they can take a photo instead of choosing one from their gallery.
>
> The camera is never opened in the background and never used for anything else. If denied, QR
> codes can still be opened by link, and photos can still be chosen from the gallery.

**Runtime prompt texts** (`app.json` plugins): expo-camera — *"One Place uses the camera to scan
business QR codes."*; expo-image-picker — *"One Place uses the camera so you can photograph what
you're selling."* and *"One Place uses your photos so you can add pictures of what you're
selling."*

---

## 6. FOREGROUND_SERVICE_LOCATION

Not a written justification, but Play requires the **foreground service type** to be declared and
matched to a use case. Declare it as **location**, tied to the same driver live-sharing feature as
§1. The service runs only while a driver has sharing switched on, and its notification is visible
for the entire time (`src/lib/backgroundLocation.ts:129–132`).

---

## Filling the form — practical notes

1. **Answer §1 first and get it right.** Background location is the item that decides your
   timeline. A rejection here costs one to three weeks per round.
2. **The video, the disclosure and this text must agree.** A reviewer checks that the wording you
   promised is the wording the app shows. The in-app text lives in
   `src/features/fleet/BackgroundLocationDisclosure.tsx` and is reproduced in
   `background-location-disclosure.md` — read them before you write anything different here.
3. **Do not claim a permission is essential when it is not.** Every justification above ends with
   what still works when the permission is denied, because that is true and because Google looks
   for it.
4. **If you later remove a feature, remove its permission.** An undeclared, unused sensitive
   permission is a common rejection, and the fleet feature is the one most likely to be cut.

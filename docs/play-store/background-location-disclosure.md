# Background location — prominent in-app disclosure

> 🔁 **DEFERRED TO v1.1 — NOT NEEDED FOR THE 1.0 SUBMISSION.**
>
> Background location is switched off for the first Play release.
> `BACKGROUND_LOCATION_ENABLED = false` in `src/lib/backgroundLocation.ts`, and
> `ACCESS_BACKGROUND_LOCATION` is in `app.json` → `android.blockedPermissions`,
> so the permission is **not in the shipped manifest** and no Location
> Permissions declaration is owed. Drivers share foreground-only in 1.0.
>
> **Everything below stays accurate and stays valid** — the disclosure component
> is still in the app, still wired, still required at the type level. Nothing
> here needs rewriting when the feature returns; follow the four re-enable steps
> in the comment above `BACKGROUND_LOCATION_ENABLED`, then work this file as
> written.

**What this file is for.** Google Play requires a *prominent in-app disclosure*
shown **before** the system background-location permission dialog, and requires
that the same wording appears in the Play Console permission declaration form
and in the demo video. This file holds the exact text the app shows, so the
three copies can be kept identical.

> ⚠️ **If you change the wording in the app, change it here too — and re-submit
> the declaration.** A disclosure that does not match what was declared is
> treated by review as no disclosure at all.

- **Where the app shows it:** `src/features/fleet/BackgroundLocationDisclosure.tsx`
- **Where it is triggered:** `startBackgroundShare()` in `src/lib/backgroundLocation.ts`,
  awaited after foreground permission is granted and immediately before
  `Location.requestBackgroundPermissionsAsync()`.
- **Reached from:** the driver's "📡 Share my live location" switch, in
  `src/app/workspace/[businessId].tsx` and `src/app/workspace/[businessId]/fleet.tsx`.
- **Android permission:** `ACCESS_BACKGROUND_LOCATION` (declared in `app.json`).

---

## The exact text shown in the app

> ### 📡 Share your location in the background?
>
> One Place collects location data to show your vehicle moving on the live map
> — to the owner of the business you drive for, and to the customers whose
> children or goods are aboard.
>
> **This collects location data even when the app is closed or not in use, so
> your vehicle keeps moving on their map while you drive with your phone locked
> or in your pocket.**
>
> It only happens while you have "Share my live location" switched on for this
> business, and it stops the moment you switch it off or finish your shift.
>
> If you say no, nothing else changes: you can still share your live location
> while One Place is open on screen, and you can turn this on later from the
> same switch.
>
> **[ Allow background location ]**
> **[ No — only while the app is open ]**

*(The app is published as **One Place**; "Localo" is the internal project name
and appears nowhere in the user-facing copy.)*

---

## How this satisfies each Play requirement

| Play requires | Where it is met |
| --- | --- |
| Disclosure appears **before** the OS permission dialog | `startBackgroundShare()` awaits the dialog's promise, then calls `requestBackgroundPermissionsAsync()` only on acceptance. The disclosure is a required argument to that function, so a new call site cannot skip it — it will not compile. |
| Names the data collected | "collects location data", stated twice. |
| Names the feature it enables | The live vehicle map, for the business owner and for tracking customers. |
| States collection continues in the background | "even when the app is closed or not in use" — verbatim, and visually emphasised. |
| Offers a genuine accept **and** decline | Two buttons. Declining returns `{ ok: true, background: false, reason: 'declined' }` and **never calls the OS permission API**. |
| Declining is not punished or nagged | Foreground-only sharing keeps working exactly as before, and both screens suppress the "set it to Allow all the time in Settings" follow-up when the reason is `declined`. |
| Not shown for unrelated location use | Foreground GPS (nearby search, distance sorting) never triggers it. It is skipped entirely on web and in Expo Go, and skipped when background permission was already granted on a previous shift — in all of those cases there is no upcoming OS prompt to disclose. |

---

## What to paste into the Play Console

**Permission:** `ACCESS_BACKGROUND_LOCATION`

**Which feature uses it:** Live vehicle tracking. A business that runs vehicles
(a school bus, a delivery van, a goods truck) assigns a driver to each vehicle.
The driver turns on "Share my live location" for the duration of their shift.
The vehicle's position is then shown on a live map to the business owner and to
the specific customers whose child or goods are aboard that vehicle.

**Why background access is required:** The driver is driving. The phone is
locked, in a pocket or in a mount, and the app is not on screen — which is
exactly when the people waiting need the vehicle's position. Foreground-only
access would freeze the vehicle on the map the moment the driver's screen turns
off, which is the entire duration of the use case.

**User control:** Off by default. Turned on per business by an explicit switch
that only appears for a user assigned as a driver of a vehicle, and turned off
by the same switch. While it is on, Android shows the ongoing foreground-service
notification "Sharing your live location".

**Disclosure wording shown before the request:** *(paste the block above)*

---

## Demo video

Google requires a video showing the disclosure, the permission prompt and the
feature working. The shot-by-shot script is a separate deliverable — see
`demo-video-script.md` (produced by P11).

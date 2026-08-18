# Background location demo video — shot-by-shot script

> 🔁 **DEFERRED TO v1.1 — DO NOT RECORD THIS FOR THE 1.0 SUBMISSION.**
>
> `ACCESS_BACKGROUND_LOCATION` is not in the 1.0 manifest (see
> `background-location-disclosure.md` for the switch), so there is no Location
> Permissions form to attach a video to. Recording it now would cost a day and
> demonstrate a permission the uploaded AAB does not request — which invites
> questions rather than answering them.
>
> The script below is unchanged and stays correct for 1.1. Re-read the
> "What to prepare" section when you get there: it needs a **production or
> preview build** with the flag flipped back on, since a 1.0 build physically
> cannot show the OS dialog.

Google requires a video for `ACCESS_BACKGROUND_LOCATION`. Its job is to prove three things, in
this order, on screen:

1. The **prominent disclosure** appears **before** the system permission dialog.
2. The disclosure contains the phrase about collection continuing when the app is **closed or not
   in use**.
3. The feature **actually works** and is what you said it was.

A video that shows the feature but not the disclosure gets rejected. So does one where the
disclosure is unreadable.

---

## Format requirements

| | |
|---|---|
| Length | **2–4 minutes.** Under 90 seconds looks rushed; over 5 loses the reviewer. |
| Hosting | Upload **unlisted** to YouTube and paste the link. Do not use Drive — link permissions break and the review stalls. |
| Recording | Real Android device, screen recording. **Not** an emulator — the reviewer is verifying background behaviour a device actually performs. |
| Orientation | Portrait, native resolution. Do not crop. |
| Audio | Optional. **On-screen captions are better** — reviewers often watch muted. If you narrate, do it in clear English. |
| Editing | Cuts are fine. **Never cut between the disclosure and the permission dialog** — that ordering is the whole point, and a cut there looks like concealment. |
| Build | Use the **production or preview** build, not the dev client. An Expo dev-menu banner in frame undermines the whole video. |

---

## What to prepare before recording

- A build installed on a real phone (`eas build --profile preview` is fine).
- Two accounts: a **business owner** and a **driver employee** linked to that business.
- A vehicle registered on that business with the driver assigned to it
  (Workspace → Fleet & tracking).
- Optionally a **customer** account with a tracked item on that vehicle — it makes shot 7 far more
  convincing.
- **The permission not yet granted.** If you have already allowed it, clear it first:
  Settings → Apps → One Place → Permissions → Location → **Deny**, or reinstall. If the OS dialog
  does not appear because the permission is already held, the video proves nothing.
- Somewhere to walk or drive for two minutes.

---

## The script

### Shot 1 — Identify the app (0:00–0:10)
Home screen of the phone, tap the One Place icon, app opens.

> **Caption:** "One Place — a local business directory. Package name com.oneplace.app."

*Why: ties the recording to the exact app under review.*

---

### Shot 2 — Establish the feature's context (0:10–0:35)
Sign in as the **business owner**. Go to the business's Workspace → **Fleet & tracking**. Show the
registered vehicle, and that a driver is assigned to it.

> **Caption:** "This business runs a school bus. The driver is a member of its team."

*Why: shows this is a fleet feature belonging to a business, not location harvesting.*

---

### Shot 3 — Become the driver (0:35–0:50)
Sign out, sign in as the **driver**. Open the Workspace for that business. Show the
**"Share my live location"** switch in its **off** state. Do not tap it yet — hold on it for a
beat.

> **Caption:** "The driver's own screen. Live sharing is OFF by default. Nothing is collected
> until the driver turns it on."

*Why: "off by default, driver-initiated" is the single most important claim you are making.*

---

### Shot 4 — THE DISCLOSURE (0:50–1:20) ⚠️ the shot the review turns on
Tap the switch. The disclosure appears. **Hold completely still for at least 8 seconds** so every
line is readable. Do not scroll, do not tap.

The reviewer must be able to read this on screen:

> **📡 Share your location in the background?**
>
> One Place collects location data to show your vehicle moving on the live map — to the owner of
> the business you drive for, and to the customers whose children or goods are aboard.
>
> **This collects location data even when the app is closed or not in use, so your vehicle keeps
> moving on their map while you drive with your phone locked or in your pocket.**
>
> It only happens while you have "Share my live location" switched on for this business, and it
> stops the moment you switch it off or finish your shift.
>
> If you say no, nothing else changes: you can still share your live location while One Place is
> open on screen, and you can turn this on later from the same switch.
>
> [ Allow background location ] [ No — only while the app is open ]

> **Caption:** "The in-app disclosure, shown BEFORE any system permission request."

If your recording resolution makes the highlighted sentence hard to read, add a zoom or a caption
repeating it verbatim. **Do not paraphrase it** — the wording must match the app and
`permission-declarations.md`.

*Source of truth: `src/features/fleet/BackgroundLocationDisclosure.tsx`. If you change that text,
re-record this shot.*

---

### Shot 5 — Show that declining is real (1:20–1:35)
Tap **"No — only while the app is open"**. Show that no system dialog appears, and that the app
continues normally with foreground-only sharing.

> **Caption:** "Declining is honoured. No permission is requested, and the app keeps working."

*Why: this shot is optional to Google and enormously persuasive. It proves the disclosure is a
real choice, not a formality. It costs 15 seconds.*

Then tap the switch again to bring the disclosure back for the next shot.

---

### Shot 6 — Accept, then the OS dialog (1:35–1:55)
Tap **"Allow background location"**. The **Android system permission dialog** now appears. Let it
sit for a moment so the reviewer sees it is the OS dialog and that it came *after* the disclosure.
Choose **"Allow all the time"**.

> **Caption:** "Only after the user accepts does Android's own permission dialog appear."

⚠️ **No cut between shots 4/5 and 6.** The ordering is the claim.

On Android 11+ the OS may route you to Settings for "Allow all the time" — film that too, it is
normal and shows you are not scripting around it.

---

### Shot 7 — The feature working (1:55–3:00)
1. Show the **persistent notification**: "Sharing your live location — Your vehicle is visible to
   the owner and tracking customers." Pull down the shade so it is unmistakable.
2. **Lock the phone or switch to another app.** Say so in a caption. Walk or drive for a minute.
3. On a **second device** (or by signing back in as the owner or a tracking customer), open the
   live tracking map and show the vehicle **in a different position from where it started**.

> **Caption:** "With the driver's phone locked, the vehicle keeps moving on the business's live
> map. This is what background location is for."

*Why: this is the "the feature actually works" proof. Movement between two positions is the part
that cannot be faked with a still screen.*

---

### Shot 8 — Turning it off (3:00–3:20)
Back on the driver's phone, switch **"Share my live location"** off. Show the notification
disappearing, and the vehicle vanishing from the tracking map on the other device.

> **Caption:** "The driver switches it off at the end of a shift. Collection stops and the vehicle
> leaves every map."

*Why: closes the loop on "the user is in control", which is Google's actual concern.*

---

## Checklist before uploading

- [ ] Disclosure is on screen, still and legible, for **≥ 8 seconds**
- [ ] "even when the app is closed or not in use" is readable in the frame
- [ ] The disclosure comes **before** the system dialog, with **no cut** between them
- [ ] The system permission dialog itself is visible
- [ ] The phone is locked or the app backgrounded, on camera, before movement is shown
- [ ] The vehicle visibly moves between two positions
- [ ] Switching off is shown
- [ ] No dev-client banner, no Expo menu, no debug overlay
- [ ] Uploaded unlisted to YouTube; link opens in a private browsing window

## Where the link goes

Play Console → **App content → Sensitive app permissions → Location permissions** — paste the
YouTube link into the video field alongside the §1 justification text from
`permission-declarations.md`.

Use the **same wording** in the form as the app shows in the video. A reviewer comparing the two
and finding them different is the most common cause of a second rejection round.

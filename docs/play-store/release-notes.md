# Release notes — the "What's new" field

Play Console → **Production → Create new release → Release notes**.

**Hard limit: 500 characters per language.** The console silently truncates
nothing — it refuses to save. Counts below are for `en-IN`, the default
language.

---

## v1.0 — first release

```
The first release of One Place.

Find the shops, services, rentals and stalls actually near you, sorted by distance. Order from a menu and get a bill, book an appointment, message a business, or call it inside the app without sharing your phone number.

Listing your own business is free. Publish your menu or services, take orders, issue bills, and add your team.

Selling something? Put it up in minutes with a photo and a price.
```

*431 characters.*

Shorter alternative if you want room to add a line:

```
The first release of One Place — your neighbourhood in one app.

Browse shops, services, rentals and stalls near you. Order, book, chat and call a business without sharing your phone number. List your own business free, or sell something from your own stall in minutes.
```

*269 characters.*

---

## Writing the next one

For every later release, replace the whole field — Play shows only the current
version's notes, so it is not a changelog you append to.

Rules that matter:

- **No feature that is not in the build you are uploading.** This is the same
  trap as the store description, and it is a Guideline 2.3-equivalent rejection
  on Play.
- **Say what changed for the user**, not what changed in the code. "Calls now
  ring when the app is closed" beats "upgraded notification handling".
- **Do not thank people for reviews or ask for ratings** in this field.
- If a release is purely internal, "Bug fixes and performance improvements" is
  honest and fine. Do not use it to cover a release that visibly changes things.

### v1.1 — pre-written, for when background location returns

Background location is deferred (`RELEASE-STATUS.md` decision 2). When it ships,
this field must describe it, because the permission prompt will be new to
existing users:

```
Drivers can now share their live location for a shift even when the app is in the background, so the business and tracking customers can follow a vehicle without keeping the app open. It stays off by default and you switch it off from the same screen.

Plus fixes and speed improvements.
```

*287 characters.*

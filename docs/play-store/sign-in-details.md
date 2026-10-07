# Sign in details — what to paste into the Play Console

**Why this file exists:** the 1.0 submission was **rejected** (Play Console Requirements →
"Login credentials are missing") because the **Sign in details** declaration — the form formerly
called *App access* — was left empty while the answer to "Is any part of your app restricted?"
was **Yes**. **The fields were not blank — they held placeholder text** ("the demo account's
username (you need to create it first — no test accounts exist right now)" and "whatever you set"),
which is the same thing to a reviewer: no account to sign in with. Nothing in the app had to change.

Everything below was **verified against the live Supabase project** on 1 Oct 2026, not copied out
of `docs/testing/TEST-DATA.md`:

- both accounts sign in — checked with a real `grant_type=password` call against `/auth/v1/token`
- `jaikiranaown` genuinely owns **Jai Kirana Store**: `type: shop`, **162 products**, modules
  `orders, billing, customers`, an Indore location, opening hours, one linked employee
- `custaarav` exists and owns no listing, so it lands in the customer-side app

⚠️ **Do NOT hand Google the super-admin account** (`8827548423` / `Sagar@2004`). It can register
listings for other people and reassign owners. Reviewers need a business owner, not the platform.

---

## The form's real field limits

Read off the live Console form on 1 Oct 2026 — they are tighter than the old guidance said, and the
instructions field is the one that bites:

| Console field | Limit | What goes in it |
|---|---|---|
| **Name** | 60 | `Business owner account` |
| **Username, email address, or phone number** | 100 | `jaikiranaown` |
| **Password** | 100 | `test1234` |
| **Any other information required to access your app** | **500** | the block below — 496 characters |

## Credential set 1 — the business owner

| Field | Value |
|---|---|
| Name | `Business owner account` |
| Username | `jaikiranaown` |
| Password | `test1234` |

**Any other information** (496 / 500):

```
Sign in from the Account tab with the username and password above. No OTP, 2-step verification or QR code is needed; the password never expires and works in any country.

To reach the restricted part, tap the My Business tab, then Jai Kirana Store, to open the business workspace - orders, billing, customers, the 162-item product catalogue, offers, team, chat and in-app voice calls.

Browsing, business pages, chat and calls also work without signing in. All demo listings are in Indore, India.
```

## Credential set 2 — the customer

Only if the Console offers a second set. If it takes one set, the owner above is the one to give.

| Field | Value |
|---|---|
| Name | `Customer account` |
| Username | `custaarav` |
| Password | `test1234` |

**Any other information** (492 / 500):

```
Same app, customer side. Sign in from the Account tab with the username and password above. No OTP, 2-step verification or QR code is needed.

This account owns no business, so it shows the buyer side: browse and search, open a listing, tap All products, tap ADD, then Place order. You can also book an appointment, chat with a business, make a voice call and leave a review.

Please use this on a second device - only one device can be signed in at a time. All listings are in Indore, India.
```

⚠️ **Tick the attestation at the bottom** — *"Sign in details in this declaration provide full
access to all the features and content within this app, including premium or paid content."* It is
true: these accounts reach everything, and there is no paid content in 1.0.

⚠️ **Say the right words for the catalogue.** Jai Kirana Store is a **shop with products**, not a
food shop, so the app shows **Products → "All products" → "ADD" → "Place order"**
(`BUCKET_META` in `src/domain/offerings.ts:124`). "Full menu" is the *menu* bucket's label and
appears only on food shops — no test-owned listing has a menu, so never write it in this form.

## Two settings on this form that matter

**1. Leave "Get feedback on your app's experience by allowing Google to use these sign-in details
for testing on Google and trusted partner devices" UNTICKED.**

This is not caution for its own sake — it collides with a real rule in the app. **One account can
be signed in on exactly one device** (`src/data/supabase/deviceLock.ts`, migration
`0022_single_device_session.sql`): every sign-in claims the account in `active_devices` *and* calls
`signOut({ scope: 'others' })`, and `SingleDeviceGate` polls once a minute so the displaced device
signs itself out with an explanation. Opting a single credential set into testing across a fleet of
devices means those devices evict each other continuously, and the symptom a reviewer sees is
"the credentials stop working" — the exact rejection we are answering.

**2. Give BOTH credential sets, not one.** Two sets let an owner-side and a customer-side reviewer
work at the same time without displacing each other. The one-device rule is worth stating in the
instructions too, which is why set 2's text says so.

Sign-in itself is never *refused* by that rule — the newest device always wins — so the credentials
stay reusable and valid, which is what the policy actually requires.

## If a password ever stops working

There is **no account recovery in 1.0**: no "Forgot password?" (a `<username>@localo.app` address
has no inbox) and `Continue with Google` is hidden behind `GOOGLE_SIGN_IN_ENABLED = false`. So the
reset is manual: re-run `supabase/scripts/create_test_accounts.sql` in the SQL editor. It is
idempotent and resets every test account's password back to `test1234` without touching its
profile, listings or history.

Also keep **Auth → Providers → Email → "Confirm email" OFF**. Credential addresses are synthetic
and have no inbox, so a project demanding confirmation refuses every sign-in — including the
reviewer's.

## After saving the form

Saving the declaration does **not** resubmit. Go to **Publishing overview** and send the changes
for review, as the rejection notice says. The declaration lives under the app, not under a bundle,
so no new build is needed for this fix.

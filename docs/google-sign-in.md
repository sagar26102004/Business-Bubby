# Continue with Google — setup

The code is done. "Continue with Google" is on the sign-in screen for both modes (sign in and
sign up — Google does not distinguish, so neither does the button), and the whole flow lives in
`signInWithGoogle` in `src/data/supabase/auth.ts`. What is left is **configuration in two
dashboards**, and until both are done the button fails with a message that says which one is
missing.

Path B (`api`) needs nothing extra: `src/data/api/auth.ts` delegates Google to the Supabase auth
repository, so the same setup covers both backends. The mock backend has no Google at all — it
signs in as the demo user.

---

## How the flow actually works

Worth reading before you configure anything, because it decides what goes in each box.

1. The app asks Supabase for a Google consent URL and opens it in a **secure browser session**
   (`WebBrowser.openAuthSessionAsync`), not a native SDK. The native Google SDK is faster and
   prettier but needs a custom dev build, a config plugin and per-platform client ids — so it
   cannot run in Expo Go or in the web preview, which is where this app is developed and shown.
   The browser route works identically in all three.
2. Google authenticates the user and redirects to **Supabase**:
   `https://mzxslzouzmiswnrolcaq.supabase.co/auth/v1/callback`. This is the address Google needs
   to know about — never the app's own.
3. Supabase redirects back to **the app**: `localo://auth-callback` on a device,
   `http://localhost:8081/auth-callback` on the web preview. This is the address *Supabase* needs
   to know about, via its redirect allow-list.
4. The redirect carries a one-time **code** (PKCE — never the tokens themselves, which would land
   in browser history), which the app exchanges for a session.
5. The `handle_new_user` trigger (migration 0018) writes the profile from Google's metadata: it
   supplies `name` and an already-verified `email`, so a first-time Google user needs no extra
   screen.

`src/app/auth-callback.tsx` is the landing route for step 3. It does no work — the exchange
happens in the repository — but it exists so the redirect resolves to a real screen instead of a
"not found" flash, and so an Android cold deep link to the same url lands somewhere sensible.

---

## Part 1 — Google Cloud console

<https://console.cloud.google.com/> — one project, five minutes.

1. **Create a project** (or reuse the one holding the Play service account).
2. **APIs & Services → OAuth consent screen**
   - User type: **External**.
   - App name `One Place`, your support email, your developer contact email.
   - Scopes: leave the defaults. Google always returns `email`, `profile` and `openid`; the app
     needs nothing more, and asking for more triggers a verification review you do not want.
   - While the app is in **Testing**, only the addresses you list under *Test users* can sign in.
     Add your own before you test, or you get "access blocked" and assume the code is broken.
     Publish to **In production** before release — with only those three basic scopes, publishing
     needs no Google verification review.
3. **APIs & Services → Credentials → Create credentials → OAuth client ID**
   - Application type: **Web application**. Yes, "Web", even for the Android app — Google is
     redirecting to Supabase's web callback, not to the app. This is the single most common
     mistake here; an "Android" client type has no client secret and will not work with this flow.
   - Name: `Supabase auth`.
   - **Authorised redirect URIs** → add exactly:

     ```
     https://mzxslzouzmiswnrolcaq.supabase.co/auth/v1/callback
     ```

   - Leave *Authorised JavaScript origins* empty.
4. Copy the **Client ID** and **Client secret**.

> If you ever move to a different Supabase project (see `docs/play-store/production-setup.md`),
> the redirect URI above changes with it — it is the only project-specific value in this part.

---

## Part 2 — Supabase dashboard

Project `mzxslzouzmiswnrolcaq`.

1. **Authentication → Sign In / Providers → Google**
   - Toggle **Enable Sign in with Google** on.
   - Paste the **Client ID** and **Client Secret** from Part 1.
   - Leave *Skip nonce check* off.
   - Save.
2. **Authentication → URL Configuration → Redirect URLs** — add every address the app can come
   back to. Supabase refuses any redirect that is not on this list, which is the most common
   reason a correctly configured OAuth client still bounces:

   ```
   localo://auth-callback
   localo://*
   http://localhost:8081/auth-callback
   http://localhost:8081/*
   ```

   The two device entries are the ones that matter for release; the localhost pair is only for the
   web preview and can be dropped later. If you preview on a LAN address rather than `localhost`
   (`http://192.168.x.x:8081`), add that too — `Linking.createURL` builds the redirect from
   whatever origin the dev server is serving.
3. Leave **Site URL** as it is. This flow never uses it; it only matters for email links.

---

## Testing it

| Where | What should happen |
|---|---|
| Web preview (`npx expo start --web`) | Button opens a Google popup, popup closes on consent, you land signed in. **Allow popups** for localhost or the browser blocks the window and the flow times out. |
| Expo Go on a phone | Opens the system browser, returns to the app on `localo://auth-callback`. |
| Dev/preview build | Same as Expo Go, in a Custom Tab. |

Check the account afterwards: your Google display name and photo-less profile card should exist,
with the real Gmail address stored privately (`profiles_private`), not on the public directory
card.

## When it goes wrong

The three failures you are most likely to hit already say what to do — `niceAuthError` in
`src/data/supabase/shared.ts` rewrites them:

| Symptom | Meaning |
|---|---|
| "Google sign-in is not switched on for this project" | Part 2 step 1 not done. |
| "This app's sign-in address is not allow-listed" | Part 2 step 2 — the exact url is missing. |
| "Google sign-in was cancelled" | Ordinary — they backed out, or a web popup was blocked. |
| Google's own "Access blocked: app has not completed verification" | You are still in *Testing* and the address is not a listed test user. |
| `redirect_uri_mismatch` on Google's page | Part 1 step 3 — the Supabase callback url is wrong or missing. |

---

## A Google account has no username, and that is fine

Sign-in is username + password (migration 0018), and the credential address for a normal account
is `<username>@localo.app`. A Google account instead signs in under its **real** Gmail address,
which `signIn` already handles: anything containing an `@` is used as-is. So a Google user has no
handle on their profile card, cannot change a password (there is none — `changePassword` says so
plainly and points at their Google account), and gets in only through the Google button. That is
the intended shape, not a gap: it is also the app's only account-recovery route, since a
`<username>@localo.app` address has no inbox to send a reset to.

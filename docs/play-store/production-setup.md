# Production setup — making the live backend safe to ship

**Decision on record (2026-08-13):** One Place ships against **one Supabase project**,
`mzxslzouzmiswnrolcaq`, the same one used for development. It is *not* split into separate
dev and production projects.

That is a deliberate trade, not an oversight. A second project would mean running all 18
migrations again, redeploying four edge functions, re-setting the LiveKit secrets and the Google
OAuth redirect URLs, and then keeping two databases in step forever — every future migration run
twice, by hand, by one person. At launch volume the isolation isn't worth that permanent tax.

**What that costs, stated plainly:** development and production share a database. There is no
safe place to test a destructive change, and a bad migration hits real users immediately. §6
below is how to live with that, and §7 is the exit when it stops being acceptable.

Google Play does not care how many projects you have. Nothing in this file is a Play requirement
— it is about not shipping a live directory full of fake shops and guessable accounts.

---

## 1. What is already safe (verified in code, not assumed)

You do **not** need to do anything about these. They were checked on 2026-08-13:

| Concern | Why it's already handled |
|---|---|
| Dev Tools reachable in a release | `DEV_TOOLS_ENABLED = __DEV__ && …` (`src/lib/devTools.ts:25`). Metro inlines `__DEV__` as a literal, so the whole harness folds away at build time. A stale `.env` cannot re-enable it. |
| Identity impersonation (`signInAs`) | `TEST_PASSWORD = __DEV__ ? … : ''` (`src/data/supabase/shared.ts:148`) — empty in a release build, and `assertDevTool` refuses without it. The seed password is never compiled into the APK. |
| Demo seed data reaching users | `SEED_CONTENT = false` (`src/data/mock/mockRepositories.ts:139`), and the mock is in-memory only — it has no path to the database. A production build also pins `EXPO_PUBLIC_BACKEND=supabase` from `eas.json`, so `createMockRepositories()` is never selected. |
| Super-admin privilege being forged | The grant lives in `platform_admins`, which has RLS on and **no** insert/update/delete policy — only the service role can grant it. `User.isSuperAdmin` is derived per session and stripped from every profile write by a trigger. The phone list in `src/domain/superAdmin.ts` is provisioning-only and is not a trust path. |
| Play upload key leaking | `play-service-account.json` is gitignored, with the reason written next to it. |
| Firebase admin key leaking | `*firebase-adminsdk*.json` and `serviceAccountKey.json` are gitignored. `google-services.json` is deliberately committed — it is not a secret, it ships inside the APK, and EAS cloud builds skip gitignored files. |

The project ref appears only in `eas.json`, `.github/workflows/android-apk.yml`, `CLAUDE.md`,
`prompt.txt`, `docs/voice-calls.md` and the gitignored `supabase/.temp/` — **never in application
source**. Nothing needs changing for a switch of project later beyond those files.

> ⚠️ **One thing to know before ever re-running a migration.** `0004_super_admin.sql:20` and
> `0006_platform_admins.sql:57` grant the admin role to whichever account holds phone
> `8827548423`. That is a **one-time provisioning backfill**, not a live rule — the app decides
> admin access only from the `platform_admins` table, never from a phone number. But if you re-run
> either migration on a database where someone else has since claimed that number, it would hand
> them the grant. If you split projects (§7), provision the admin with
> `supabase/scripts/create_super_admin.sql` on the new database *before* anyone else can sign up.

---

## 2. Before the first production build — do these in order

### 2.1 Rotate the super-admin password ⚠️ HIGHEST VALUE ITEM

That account can read every user's private contact details, register listings for anyone, reassign
ownership, and approve ad campaigns. Its password (`Sagar@2004`) is short, guessable, and written
down in project notes.

Supabase Dashboard → **Authentication → Users** → find the account (phone `8827548423`) →
**Reset password**, or from the SQL editor with the service role. Use a long random password from
a password manager, and do not record it in the repo.

### 2.2 Find out what is actually in the database

```sql
select 'businesses' t, count(*) from businesses
union all select 'profiles',   count(*) from profiles
union all select 'orders',     count(*) from orders
union all select 'bills',      count(*) from bills
union all select 'reviews',    count(*) from reviews
union all select 'employees',  count(*) from employees
union all select 'memberships',count(*) from memberships
union all select 'ad_campaigns', count(*) from ad_campaigns
order by 1;
```

Then look at what the listings actually are, so you delete demo data and not something real:

```sql
select b.id, b.data->>'name' as name, b.type,
       p.data->>'name' as owner, b.created_at
  from businesses b
  left join profiles p on p.id = b.owner_id
 order by b.created_at;
```

### 2.3 Remove the demo listings

Take them down through the app where you can — the app's own `remove` path is the tested one, and
it cascades correctly. For anything left, deleting the row cascades every child (`on delete
cascade` throughout `0001_schema.sql`):

```sql
-- Check first. Only then delete.
delete from businesses where id = '<the-id-you-just-listed>';
```

There is also a script for clearing listings that ended up under the admin account:
`supabase/scripts/clear_admin_listings.sql`.

### 2.4 Deal with the ten test accounts

Phones `9812340001`–`9812340010`, all on the shared password `localo123`. They are real accounts
in your live user table and anyone who guesses the pattern is inside one. Pick one:

- **Delete them** — cleanest. Dashboard → Authentication → Users → delete each. Note that with
  migration 0019 applied, deleting the auth user no longer cascades into businesses (the profile
  survives as a tombstone), so **take their listings down first** or you will leave listings owned
  by a tombstone with no one able to transfer them.
- **Or keep them for testing** and give each a strong unique password. You lose one-tap identity
  switching in Dev Tools, which relies on them sharing `EXPO_PUBLIC_SEED_PASSWORD`.

Find them:

```sql
select id, data->>'phone' as phone, data->>'email' as email
  from profiles_private
 where data->>'phone' like '98123400%';
```

### 2.5 Confirm the auth settings

Dashboard → **Authentication → Sign In / Providers**:

| Setting | Value | Why |
|---|---|---|
| Anonymous sign-ins | **ON** | Guests place voice calls with a throwaway identity. Off = guest calling breaks. |
| Confirm email | **OFF** | Not a dev shortcut — it is inherent to the design. Credential addresses are `<username>@localo.app` with no inbox, so a confirmation mail could never arrive. |
| Leaked password protection | **ON** if offered | Free, and the only password-strength control the app has. |
| Google provider | Enabled, with the OAuth client configured | "Continue with Google" is live in the app. |

**Authentication → URL Configuration** must list the app's redirect (`localo://auth-callback`)
or Google sign-in returns to nowhere on a device.

### 2.6 Verify migrations and functions are all applied

All 18 migrations must be present. `0017` does not exist — the numbering skips it, that is
expected and not a missing file:

```
0001_schema                          0011_push_tokens
0002_policies                        0012_push_tokens_handset_handover
0003_notifications_insert_permissive 0013_push_tokens_release_previous_owner
0004_super_admin                     0014_ad_campaigns
0005_catalog_entries                 0015_media_bucket
0006_platform_admins                 0016_real_identity
0007_profiles_private                0018_usernames
0008_business_ownership_lock         0019_account_deletion
0009_order_integrity
0010_server_now
```

Spot-check the ones with teeth:

```sql
select
  to_regclass('public.platform_admins')      is not null as m0006,
  to_regclass('public.profiles_private')     is not null as m0007,
  to_regclass('public.push_tokens')          is not null as m0011,
  to_regclass('public.ad_campaigns')         is not null as m0014,
  to_regprocedure('public.resolve_login_email(text,text)') is not null as m0016,
  to_regprocedure('public.anonymize_account(uuid)')        is not null as m0019,
  (select count(*) from storage.buckets where id='media')  as media_bucket;
```

Four edge functions must be ACTIVE — `npx supabase functions list --project-ref mzxslzouzmiswnrolcaq`:

| Function | Secrets it needs |
|---|---|
| `dynamic-responder` (LiveKit token) | `LIVEKIT_URL`, `LIVEKIT_API_KEY`, `LIVEKIT_API_SECRET` |
| `call-ring` | none — platform-injected only |
| `call-decline` | none — platform-injected only |
| `delete-account` | none — platform-injected only |

`SUPABASE_URL`, `SUPABASE_ANON_KEY` and `SUPABASE_SERVICE_ROLE_KEY` are injected by the platform
everywhere; you never set those by hand.

### 2.7 Run the security advisors

Dashboard → **Advisors → Security**. Fix anything reported as an RLS gap before launch. This is
the one check that catches a table someone added without a policy.

---

## 3. Host the legal pages and fill in the URLs

`src/lib/legal.ts` holds four `example.com` placeholders, all marked `TODO(sagar)`:

| Constant | Page |
|---|---|
| `PRIVACY_POLICY_URL` | `docs/legal/privacy-policy.html` |
| `TERMS_URL` | `docs/legal/terms-of-service.html` |
| `SUPPORT_URL` | `docs/legal/support.html` |
| `ACCOUNT_DELETION_URL` | `docs/legal/delete-account.html` |

Upload all four into **one folder** — they link to each other by relative filename. Then confirm
each loads **in a private browsing window**; the deletion page failing that check is the single
most common rejection on this requirement. Paste the real URLs into `legal.ts` and rebuild.

The URL in the Play Console listing must be character-for-character the same as
`PRIVACY_POLICY_URL`.

---

## 4. `eas.json` — what it does and doesn't need

No restructure, given the one-project decision. All three profiles point at the same Supabase URL
and publishable key, which is correct and intentional now.

Two things to know:

- `production` builds an **app-bundle** with `autoIncrement: true`, which is what Play wants.
  `development` and `preview` build APKs for sideloading. That split is already right.
- `submit.production.android.serviceAccountKeyPath` points at `./play-service-account.json`,
  **which does not exist yet**. You create it in the Google Cloud console for your Play developer
  account and drop it in the repo root; it is gitignored. Without it `eas submit` cannot upload.

The anon key in `eas.json` is a *publishable* key (`sb_publishable_…`). It is meant to be public
and ships in the app either way — it is not a leak.

---

## 5. Never run against this database

- **`src/data/mock/seed.ts`** — demo content for the in-memory mock. It has no database path and
  cannot reach Supabase, but do not hand-port it into SQL.
- **`supabase/scripts/backfill_usernames.sql` / `run_usernames_now.sql`** — one-time backfills for
  accounts that predate usernames. Already applied. Re-running is not destructive but is pointless.
- **`supabase/scripts/clear_admin_listings.sql`** — deletes listings under the admin account.
  Fine to use deliberately in §2.3; never as routine cleanup once real users exist.

---

## 6. Working safely on one database

This is the discipline that replaces having a separate dev project:

1. **Build features against the mock.** `EXPO_PUBLIC_BACKEND=mock` in `.env` gives a full app with
   no network and no risk. Only switch to `supabase` when the change genuinely involves the backend.
2. **Read before you write.** Every migration in `supabase/migrations/` ends with a VERIFY block —
   run the `select`s first, apply, then run them again.
3. **New migrations are additive.** Never `drop table`, never `drop column`, never `delete from`
   without a `where` you have already run as a `select count(*)`.
4. **Turn on Point-in-Time Recovery** if you upgrade past free tier. On free tier the only backup
   is the daily one, so before any migration that changes data (not just schema), export the tables
   it touches: Dashboard → Database → Backups, or `pg_dump` the specific tables.
5. **Never point a production build at anything else by accident** — the URL is baked in from
   `eas.json` at build time, so check that file before every release build.

---

## 7. When to split into two projects

Split when any of these becomes true — not before:

- You have real users whose data you would be unwilling to lose.
- You need to test a migration that deletes or rewrites data.
- Someone else starts working on the app.
- You want a staging build reviewers or testers can hammer without polluting real listings.

**What splitting involves**, so the decision is informed: create the new project; run all 18
migrations in the order listed in §2.6; create the `media` storage bucket (0015 does it); deploy
all four edge functions and set the three LiveKit secrets; add the Google OAuth client and the
redirect URLs; provision the super-admin (`supabase/scripts/create_super_admin.sql`); upload the
FCM V1 key against the same EAS project; then change the `production` block in `eas.json` to the
new URL and key while `development` and `preview` keep the old one. Budget half a day, and expect
the Google OAuth redirect and the LiveKit secrets to be the two that bite.

---

## 8. Pre-flight checklist

Run through this immediately before the first production build:

- [ ] Super-admin password rotated (§2.1)
- [ ] Demo listings removed (§2.3)
- [ ] Ten test accounts deleted or re-passworded (§2.4)
- [ ] Anonymous sign-ins ON, Confirm email OFF, Google provider configured (§2.5)
- [ ] All 18 migrations verified present (§2.6)
- [ ] Four edge functions ACTIVE, LiveKit secrets set (§2.6)
- [ ] Security advisors clean (§2.7)
- [ ] Legal pages hosted, all four URLs pasted into `src/lib/legal.ts`, each loads logged-out (§3)
- [ ] `play-service-account.json` created and in place (§4)
- [ ] FCM V1 key uploaded to EAS — confirmed working, calls ring on a real device
- [ ] `npx tsc --noEmit` and `npx expo export --platform web` both exit 0

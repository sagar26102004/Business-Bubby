# Account deletion — what Play needs, and what to declare

Google Play's **User Data policy** requires every app that lets people *create* an account to
also let them *delete* it, through **two separate routes**:

1. **In the app** — a path a signed-in person can find and use themselves.
2. **On the web** — a publicly reachable URL, usable by someone who has already uninstalled the
   app or never installed it. This URL is typed into the Play Console.

It is **both**, not either. An app with only the in-app path is rejected, and so is one that
answers the web URL with a login wall. Both exist in this repo; this document says where they are
and what to paste into the console.

---

## 1. The in-app route (built)

| | |
|---|---|
| Where | **Account tab → "Delete my account"** (`src/app/(tabs)/account.tsx`) |
| Screen | `src/app/delete-account.tsx` |
| Gate | Type your username to confirm — not a password, because a Google account has none |
| Effect | Immediate and irreversible; no grace period, no queue |

The screen states what is deleted and what is retained *before* the confirm, which is what a
reviewer looks for. It does not use a JS `alert`/`confirm`.

## 2. The web route (needs hosting — this is the part left for you)

The page is written and ready at **`docs/legal/delete-account.html`**. It is a static,
self-contained file: no server, no build step, no dependencies.

**To publish it:**

1. Host `docs/legal/` on any static host — GitHub Pages, Netlify, Cloudflare Pages, or a folder on
   a domain you own. The four pages (`privacy-policy.html`, `terms-of-service.html`,
   `support.html`, `delete-account.html`) link to each other by **relative** filename, so upload
   them into the same folder and the links resolve themselves.
2. Confirm the page loads **in a private browsing window** — proving it needs no login. This is the
   single most common failure on this requirement.
3. Paste the resulting URL into `ACCOUNT_DELETION_URL` in **`src/lib/legal.ts`** (it currently
   holds an `example.com` placeholder, marked `TODO(sagar)`), then rebuild. The delete-account
   screen links to it, and so does the privacy policy.

> ⚠️ The same edit is needed for `PRIVACY_POLICY_URL`, `TERMS_URL` and `SUPPORT_URL` in that file
> — they are all still placeholders.

## 3. What to enter in the Play Console

**Play Console → App content → Data safety → "Account deletion"**

| Field | Answer |
|---|---|
| Does your app let users create an account? | **Yes** |
| Can users request account deletion? | **Yes** |
| Account deletion URL | the hosted URL of `delete-account.html` |
| Does the URL let users request deletion of *all* data, or only some? | **All data** — see the note below |
| Do you provide an in-app deletion path? | **Yes** — Account tab → Delete my account |

**On "all data":** answer *all data*, and rely on the retention explanation. Play accepts retained
data where there is a stated, legitimate reason (another party's records, legal/accounting
obligations) — the retention must simply be *disclosed*, which `delete-account.html` and
§6–§7 of `privacy-policy.html` both do. Do **not** answer "some data" and leave it there; that
invites a policy question you would answer with the same paragraphs anyway.

## 4. The deletion semantics, in one table

This is the answer to give if a reviewer asks — and it is what the code actually does
(`supabase/migrations/0019_account_deletion.sql`).

| Data | What happens | Why |
|---|---|---|
| Sign-in (`auth.users`) | Deleted | The account itself. The username is freed. |
| Phone, email, muted preferences | Deleted | Personal contact data (`profiles_private`) |
| Public profile (`profiles`) | **Tombstone** — "Deleted user", no username, avatar or bio | Everything else still references this row; deleting it would cascade into other people's records. It holds no personal data afterwards. |
| Saved places, push tokens, location shares, own alerts | Deleted | Personal, nobody else's record |
| Tracked items (a child, a parcel) | Deleted | Carries a child's name — a minor's data with no owner has no basis to be kept |
| Customer chats | Deleted, both sides | Private correspondence with no counterparty left |
| Empty listings they own | Deleted | Their own content, nobody depends on it |
| Orders, bills, bookings, memberships | Kept, anonymised; free-text notes stripped | Also the business's financial records |
| Reviews | Kept, anonymised (rating and comment stand) | Ratings are earned from verified transactions; deletion must not rewrite a business's score |
| Public stall questions and offers | Kept, anonymised | The thread is public by design — other shoppers rely on the answers |
| Staff roster entry | Unlinked from the account; the name the business recorded stays | The business's own record |
| Uploaded photos | Deleted, unless a listing that was transferred away still uses them | Not breaking a business's page that someone was handed |
| B2B messages | Untouched | Written as a business to another business; they carry no author id to match a person against |

## 5. Listings that block deletion

A listing with **staff, orders, bills, bookings, members, reviews, customer chats, call history,
tracked items or an ad campaign** stops the deletion, and the app names it and says why. The owner
transfers it or takes it down first.

This is deliberate: cascading would delete the customers' bills and the team's employment record,
and migration 0008 makes ownership transfer owner-only — so cascading destroys the one person who
could have handed the business over. A listing nobody has used is deleted along with the account,
so an ordinary user who tried the stall flow once is never stuck.

**If a reviewer challenges this**, the answer is: deletion is never *refused*, only *sequenced* —
the app gives a one-tap route to each blocking listing, and a user with no live business (the
overwhelming majority) is never blocked at all.

## 6. Deploy the edge function before you ship

Deletion needs the service role, so it runs server-side:

```bash
supabase functions deploy delete-account
```

`SUPABASE_URL`, `SUPABASE_ANON_KEY` and `SUPABASE_SERVICE_ROLE_KEY` are injected by the platform —
there is nothing extra to configure. **Run `supabase/migrations/0019_account_deletion.sql` first**:
without it the function's RPCs do not exist and every deletion fails.

Both must be done on **each** Supabase project you ship against — including the new production
project (see `production-setup.md` when P10 lands).

## 7. Testing it before submission

1. Create a throwaway account in the app.
2. Place an order with a seeded business, leave a review, send a chat message.
3. Delete the account from the Account tab.
4. In the Supabase SQL editor, confirm:
   ```sql
   select data from profiles where id = '<uid>';          -- {"name":"Deleted user", …}
   select count(*) from profiles_private where id = '<uid>';  -- 0
   select data ->> 'customerName' from orders where customer_id = '<uid>';  -- Deleted user
   select count(*) from chat_messages where participant_id = '<uid>';       -- 0
   ```
5. Try to sign in with the deleted username — it must fail, and it must be available for a new
   sign-up.
6. Separately: register a listing, give it one order from another account, then try to delete —
   it must be **blocked**, naming that listing.

## 8. Known limits, stated honestly

- **The super-admin account cannot be deleted from the app.** `platform_admins` cascades off
  `auth.users`, so deleting it would lock the platform console out with no way back in. The
  attempt is refused with a clear message. This is not a user-facing account and does not affect
  the Play requirement.
- **Guest (anonymous) sessions** have nothing to delete; signing out is the whole of it, and the
  function says so rather than pretending to delete something.
- **Deletion is not queued or retryable in the background.** If the final auth-user deletion fails
  after the data was scrubbed, the person is told to try again and can — the account is empty but
  still signs in, which is the recoverable direction to fail in.

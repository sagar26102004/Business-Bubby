/**
 * Supabase-backed authentication.
 *
 * AN ACCOUNT IS A USERNAME AND A PASSWORD. Nothing else is required, nothing is
 * emailed, and nothing is texted — so sign-up cannot fail on an inbox, an SMS
 * provider, or a code that never arrives. Email and phone are contact details
 * the person may add; they are never credentials.
 *
 * Supabase Auth keys accounts to a single email column, so the credential
 * address is manufactured from the handle: `<username>@localo.app`. It is never
 * shown to anyone, and the trigger keeps it out of the profile.
 *
 * Three address schemes therefore exist on one domain, and they cannot collide
 * because `assertUsername` forbids a leading digit:
 *   `sagar@localo.app`       a username account (everything new)
 *   `9812340001@localo.app`  a phone-first account (the seeded ten, the
 *                            super-admin) — still signs in by phone
 *   `me@gmail.com`           a real address (Google, and accounts made during
 *                            the brief email-first period)
 *
 * The `profiles` / `profiles_private` rows are created by the `handle_new_user`
 * database trigger from the metadata passed at sign-up.
 */
import {
  assertContactDetails,
  assertPassword,
  assertUsername,
  type AccountDeletionBlocker,
  type AuthRepository,
  type DeleteAccountResult,
  type SignUpInput,
} from '@/data/repositories';
import type { User } from '@/domain/types';
import * as Linking from 'expo-linking';
import * as WebBrowser from 'expo-web-browser';
import { getSupabase } from '@/lib/supabase';
import { clearCache } from '@/lib/queryCache';
import {
  TEST_PASSWORD,
  assertDevTool,
  fallbackUser,
  fetchProfile,
  looksLikeEmail,
  niceAuthError,
  phoneToEmail,
  usernameToEmail,
  withAdminFlag,
} from './shared';

export function createSupabaseAuth(): AuthRepository {
  const sb = getSupabase();

  return {
    async getCurrentUser(): Promise<User | null> {
      const { data } = await sb.auth.getSession();
      const session = data.session;
      if (!session) return null;
      // Anonymous sessions (guest voice calls) carry `is_anonymous` — keep the
      // app treating them as a guest, but with a real uid for identity-scoped work.
      if (session.user.is_anonymous) {
        return { id: session.user.id, name: 'Guest', isProfilePublic: false, isAnonymous: true };
      }
      const profile = await fetchProfile(session.user.id);
      // `isSuperAdmin` is derived from platform_admins, never from the profile
      // document (which the user can rewrite) — see domain/superAdmin.ts.
      return withAdminFlag(
        profile ?? fallbackUser(session.user.id, session.user.user_metadata?.name),
      );
    },

    /**
     * Sign in with a USERNAME — or, for accounts that predate them, an email
     * address or a phone number.
     *
     * Everything resolves to a credential address on the device, with no
     * lookup, because each scheme derives one arithmetically:
     *
     *  - `sagar`        → `sagar@localo.app`      (the normal case)
     *  - `9812340001`   → `9812340001@localo.app` (the seeded ten, the
     *                     super-admin, any phone-first account)
     *  - `me@gmail.com` → itself                  (accounts created with a real
     *                     email, and every Google account)
     *
     * `assertUsername` forbids a leading digit, so the first two can never
     * collide. Only one case still needs the database: a phone number belonging
     * to an account whose credential address is a real email, which falls to the
     * `resolve_login_email` RPC (migration 0016) as a second attempt. A missing
     * or broken RPC therefore costs that one case and nothing else.
     */
    async signIn(usernameEmailOrPhone: string, password?: string): Promise<User> {
      const typed = usernameEmailOrPhone.trim();
      const pw = password ?? '';
      const attempt = (email: string) => sb.auth.signInWithPassword({ email, password: pw });

      // `phoneToEmail` passes an `@` straight through and otherwise strips to
      // digits, so a username needs its own derivation.
      const isDigits = !looksLikeEmail(typed) && /^\d[\d\s+()-]*$/.test(typed);
      const firstAddress = looksLikeEmail(typed)
        ? typed.toLowerCase()
        : isDigits
          ? phoneToEmail(typed)
          : usernameToEmail(typed);

      let { data, error } = await attempt(firstAddress);

      if (error && isDigits) {
        // Returns a bare text scalar, so no `.single()` — that asks PostgREST
        // for an object and would fail on a value that isn't one.
        const resolved = await sb
          .rpc('resolve_login_email', { p_phone: typed, p_password: pw })
          .then(
            (r) => (typeof r.data === 'string' && r.data ? r.data : null),
            // A project that has not run 0016 yet has no such function. That is
            // a missing second chance, not a failed sign-in — keep the first
            // attempt's error, which is the one describing what the user did.
            () => null,
          );
        if (resolved) ({ data, error } = await attempt(resolved));
      }

      if (error) throw new Error(niceAuthError(error.message));
      // Narrowing, not paranoia: `data.user` is typed nullable on the failure
      // branch of the union, and the reassignment above widens it.
      const signedIn = data.user;
      if (!signedIn) throw new Error('Sign-in did not return an account. Please try again.');
      const profile = await fetchProfile(signedIn.id);
      return withAdminFlag(profile ?? fallbackUser(signedIn.id, signedIn.user_metadata?.name));
    },

    /**
     * Create an account from a username and a password.
     *
     * The credential address is derived from the handle, which is what makes
     * the handle unique: `auth.users.email` carries a unique constraint, so a
     * taken username is refused by Postgres rather than by a check-then-insert
     * we would have to write and could lose a race on. `niceAuthError` turns
     * that rejection into "That username is taken."
     *
     * Email and phone are contact details. Nothing is sent to either, neither
     * is verified, and neither can be used to take the account over — they are
     * filed into `profiles_private` by the `handle_new_user` trigger.
     */
    async signUp(input: SignUpInput): Promise<User> {
      const username = assertUsername(input.username);
      const { email, phone } = assertContactDetails(input);
      const password = assertPassword(input.password);
      const displayName = input.name?.trim() || username;

      const { data, error } = await sb.auth.signUp({
        email: usernameToEmail(username),
        password,
        // What the PERSON gave us. The credential address is never among it —
        // `handle_new_user` (0018) files exactly these into the profile.
        options: { data: { name: displayName, username, phone, email } },
      });
      if (error) throw new Error(niceAuthError(error.message));

      // With "Confirm email" off (the dev setting), sign-up returns a session
      // immediately. If it didn't, sign in to obtain one.
      let userId = data.user?.id;
      if (!data.session) {
        const signedIn = await sb.auth.signInWithPassword({
          email: usernameToEmail(username),
          password,
        });
        if (signedIn.error) throw new Error(niceAuthError(signedIn.error.message));
        userId = signedIn.data.user.id;
      }
      if (!userId) throw new Error('Sign-up did not return an account. Please try again.');

      const profile = await fetchProfile(userId);
      return withAdminFlag(profile ?? fallbackUser(userId, displayName));
    },

    async signOut(): Promise<void> {
      await sb.auth.signOut();
      await clearCache();
    },

    async signInAs(userId: string): Promise<User> {
      // Real auth has no service-role impersonation on the client, so instead we
      // do a genuine sign-in as the target user with the shared seed password.
      // This only works for the seeded test accounts (created with TEST_PASSWORD).
      // Hard-gated: impersonation must never be reachable in a release build.
      assertDevTool('Switching identity');
      const profile = await fetchProfile(userId);
      // The handle is PUBLIC and is checked FIRST, because an account that has
      // been given one no longer answers to its phone address — the username
      // backfill (supabase/scripts/backfill_usernames.sql) moves the credential
      // address across, so deriving from the phone would silently stop matching.
      // Phone stays as the fallback for accounts that never got a handle.
      const address = profile?.username
        ? usernameToEmail(profile.username)
        : profile?.phone
          ? phoneToEmail(profile.phone)
          : null;
      if (!address) {
        // Phone lives in `profiles_private` (migration 0007) and RLS hands it
        // over only to the account itself or a platform super-admin — so this
        // is the expected answer for an ordinary account, not a broken read.
        throw new Error(
          "Can't switch to this account — it has no username, and its phone " +
            "number isn't visible to you. Identity switching needs a platform " +
            'super-admin account.',
        );
      }
      const { data, error } = await sb.auth.signInWithPassword({
        email: address,
        password: TEST_PASSWORD,
      });
      if (error) {
        // Deliberately does NOT echo the password — error text ends up in Metro
        // logs, crash reporters and screenshots.
        throw new Error(
          `Can't switch to ${profile?.name ?? 'that account'} — this only works for seeded test accounts created with the shared dev password. Sign in manually instead.`,
        );
      }
      await clearCache();
      const fresh = await fetchProfile(data.user.id);
      return withAdminFlag(fresh ?? fallbackUser(data.user.id, data.user.user_metadata?.name));
    },

    async signInGuest(): Promise<User> {
      // Reuse an existing session (real or anonymous) rather than spawning a new
      // anonymous user each time.
      const { data: sessionData } = await sb.auth.getSession();
      const existing = sessionData.session?.user;
      if (existing) {
        if (existing.is_anonymous) {
          return { id: existing.id, name: 'Guest', isProfilePublic: false, isAnonymous: true };
        }
        const profile = await fetchProfile(existing.id);
        return withAdminFlag(profile ?? fallbackUser(existing.id, existing.user_metadata?.name));
      }
      const { data, error } = await sb.auth.signInAnonymously();
      if (error || !data.user) {
        // The most common cause is the project's "Anonymous sign-ins" toggle
        // being off — surface a clear, actionable reason.
        throw new Error(
          niceAuthError(
            error?.message ??
              'Guest access is off. Enable Anonymous sign-ins in Supabase (Auth → Sign In / Providers).',
          ),
        );
      }
      return { id: data.user.id, name: 'Guest', isProfilePublic: false, isAnonymous: true };
    },

    /**
     * Sign in with Google, through the browser rather than a native SDK.
     *
     * WHY THE BROWSER ROUTE. The native Google SDK is faster and prettier, and
     * it needs a custom dev build, a config plugin and per-platform client ids
     * to exist at all — so it cannot run in Expo Go or in the web preview,
     * which is where this app is developed and demonstrated. `signInWithOAuth`
     * plus an auth session works identically in all three, with no native
     * module. Swapping in the native SDK later changes only this method.
     *
     * PKCE, not implicit: the browser hands back a short-lived `code` in the
     * redirect, which is exchanged for the session here. The tokens themselves
     * never travel in a URL, where they would land in browser history and in
     * any logging in between.
     *
     * ⚠️ DASHBOARD PREREQUISITES: the Google provider must be enabled in
     * Supabase with a Google Cloud OAuth client, and the redirect this builds
     * must be listed under Authentication → URL Configuration.
     */
    async signInWithGoogle(): Promise<User> {
      // The address the browser sends the user back to. `Linking.createURL`
      // resolves to the app scheme on a device (localo://…) and to the dev
      // server origin on web, so one line covers every environment.
      const redirectTo = Linking.createURL('/auth-callback');

      const { data, error } = await sb.auth.signInWithOAuth({
        provider: 'google',
        options: {
          redirectTo,
          // We open the browser ourselves, so the session can be closed the
          // moment Google redirects back instead of leaving a stray tab.
          skipBrowserRedirect: true,
        },
      });
      if (error) throw new Error(niceAuthError(error.message));
      if (!data?.url) throw new Error('Google sign-in is not available right now.');

      const result = await WebBrowser.openAuthSessionAsync(data.url, redirectTo);
      // Backing out is an ordinary decision, not a fault — say nothing alarming.
      if (result.type !== 'success') throw new Error('Google sign-in was cancelled.');

      const code = new URL(result.url).searchParams.get('code');
      if (!code) {
        // Google can also refuse and say why in the URL; prefer its reason.
        const denied = new URL(result.url).searchParams.get('error_description');
        throw new Error(denied ?? 'Google did not return a sign-in code. Please try again.');
      }

      const { data: exchanged, error: exchangeError } = await sb.auth.exchangeCodeForSession(code);
      if (exchangeError) throw new Error(niceAuthError(exchangeError.message));
      const user = exchanged.session?.user;
      if (!user) throw new Error('Google signed you in, but no session came back. Try again.');

      await clearCache();
      // The profile row is written by the `handle_new_user` trigger from
      // Google's metadata (it supplies `name` and a real, already-verified
      // `email`), so a first-time Google user needs nothing extra here.
      const profile = await fetchProfile(user.id);
      return withAdminFlag(
        profile ?? fallbackUser(user.id, user.user_metadata?.name ?? user.user_metadata?.full_name),
      );
    },

    /**
     * Close this account for good.
     *
     * Everything of consequence happens in the `delete-account` edge function
     * and the SQL it calls (migration 0019) — deleting an auth user needs the
     * service role, and the scrub has to be one transaction. The client's whole
     * job is to ask, read the answer, and then forget the session.
     *
     * Note there is NO user id in the request: the function takes the uid from
     * the verified JWT, so this can only ever delete the person holding it.
     */
    async deleteAccount(): Promise<DeleteAccountResult> {
      const { data, error } = await sb.functions.invoke('delete-account', { body: {} });

      if (error) {
        // A non-2xx from an edge function arrives as a FunctionsHttpError whose
        // body — the part that says WHY — is only on the raw response. Without
        // reading it, a blocked deletion would surface as the generic
        // "Edge Function returned a non-2xx status code" and the person would
        // never learn which listing is in the way.
        const body = await readErrorBody(error);
        if (body?.error === 'blocked') {
          return { deleted: false, blockers: (body.blockers ?? []) as AccountDeletionBlocker[] };
        }
        throw new Error(
          typeof body?.error === 'string' && body.error
            ? body.error
            : 'Could not delete your account right now. Please try again.',
        );
      }

      // A 200 that isn't a deletion means the function changed shape under us —
      // never report success we didn't get.
      const result = data as { deleted?: boolean; listingsRemoved?: number } | null;
      if (!result?.deleted) {
        throw new Error('Could not delete your account right now. Please try again.');
      }

      // The account is gone, so the stored session is a token for a user that no
      // longer exists. Drop it and the cached reads keyed to it, or the app
      // would keep rendering the deleted person until a reload.
      await sb.auth.signOut().catch(() => {});
      await clearCache();

      return { deleted: true, listingsRemoved: result.listingsRemoved ?? 0 };
    },

  };
}

/**
 * Pull the JSON body out of a functions-invoke error.
 *
 * supabase-js puts the status text on the error and the SERVER'S message in the
 * untouched response hanging off it, so this is the only way to see what the
 * function actually said. Fails soft: an unreadable body just means we fall back
 * to a generic message, never a crash on top of an error.
 */
async function readErrorBody(
  error: unknown,
): Promise<{ error?: string; blockers?: unknown[] } | null> {
  const response = (error as { context?: Response })?.context;
  if (!response || typeof response.json !== 'function') return null;
  return response
    .clone()
    .json()
    .catch(() => null);
}

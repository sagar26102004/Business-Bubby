/**
 * Auth for the API backend.
 *
 * Identity still comes from Supabase (sign-in/up over the synthetic phone email
 * → a real JWT session), exactly like Path A — but the PROFILE read points at
 * the Express API (GET /users/:id), so the app never diverges on where user
 * data comes from once signed in.
 */
import {
  assertContactDetails,
  assertPassword,
  assertUsername,
  type AuthRepository,
  type DeleteAccountResult,
  type SignUpInput,
} from '@/data/repositories';
import type { User } from '@/domain/types';
import { getSupabase } from '@/lib/supabase';
import { clearCache } from '@/lib/queryCache';
import {
  TEST_PASSWORD,
  assertDevTool,
  fallbackUser,
  looksLikeEmail,
  niceAuthError,
  phoneToEmail,
  usernameToEmail,
} from '@/data/supabase/shared';
import { createSupabaseAuth } from '@/data/supabase/auth';
import { http, seg } from './client';

/**
 * Read a profile via the API, falling back when the row isn't ready yet, and
 * stamp the DERIVED super-admin flag — the Path B twin of Path A's
 * `withAdminFlag`.
 *
 * `isSuperAdmin` is deliberately NOT stored on the profile any more: the
 * profile is user-writable, so a stored flag was self-granting. The server
 * answers it per session from `platform_admins` instead. Every
 * session-establishing call funnels through here, so this is the one place it
 * needs doing.
 *
 * Best-effort: an older API without the route just leaves the flag unset, i.e.
 * NOT an admin — failing closed is the only safe direction for a privilege.
 */
async function fetchProfileViaApi(id: string, name?: string): Promise<User> {
  const [user, isSuperAdmin] = await Promise.all([
    http.get<User | null>(`/users/${seg(id)}`).catch(() => null),
    http
      .get<{ isSuperAdmin?: boolean }>('/users/me/is-super-admin')
      .then((r) => r.isSuperAdmin === true)
      .catch(() => false),
  ]);
  return { ...(user ?? fallbackUser(id, name)), isSuperAdmin };
}

export function createApiAuth(): AuthRepository {
  const sb = getSupabase();
  // The OTP flows are pure GoTrue and identical across backends — borrow them
  // rather than keeping two copies of the flow-selection logic in step.
  const supabaseAuth = createSupabaseAuth();

  return {
    async getCurrentUser(): Promise<User | null> {
      const { data } = await sb.auth.getSession();
      const session = data.session;
      if (!session) return null;
      if (session.user.is_anonymous) {
        return { id: session.user.id, name: 'Guest', isProfilePublic: false, isAnonymous: true };
      }
      return fetchProfileViaApi(session.user.id, session.user.user_metadata?.name);
    },

    /**
     * Sign in with a USERNAME — or, for accounts that predate them, an email
     * address or a phone number. Identical resolution to Path A, because it is
     * the same GoTrue on the other side:
     *
     *  - `sagar`        → `sagar@localo.app`      (the normal case)
     *  - `9812340001`   → `9812340001@localo.app` (the seeded ten, any
     *                     phone-first account)
     *  - `me@gmail.com` → itself                  (real-email and Google accounts)
     *
     * `assertUsername` forbids a leading digit, so the first two can never
     * collide on the shared `@localo.app` domain. Only one case needs the
     * database: a phone number belonging to an account whose credential address
     * is a real email, which falls to the `resolve_login_email` RPC (migration
     * 0016) as a SECOND attempt — and a missing or broken RPC must degrade to
     * the first attempt's error, never to a hard failure.
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
        // Returns a bare text scalar, so no `.single()`.
        const resolved = await sb
          .rpc('resolve_login_email', { p_phone: typed, p_password: pw })
          .then(
            (r) => (typeof r.data === 'string' && r.data ? r.data : null),
            // A project that has not run 0016 has no such function: a missing
            // second chance, not a failed sign-in. Keep the first error.
            () => null,
          );
        if (resolved) ({ data, error } = await attempt(resolved));
      }

      if (error) throw new Error(niceAuthError(error.message));
      // Narrowing, not paranoia: `data.user` is nullable on the failure branch
      // of the union, and the reassignment above widens it.
      const signedIn = data.user;
      if (!signedIn) throw new Error('Sign-in did not return an account. Please try again.');
      return fetchProfileViaApi(signedIn.id, signedIn.user_metadata?.name);
    },

    /**
     * Create an account from a username and a password.
     *
     * The credential address is derived from the handle, which is what makes
     * the handle unique: `auth.users.email` carries a unique constraint, so a
     * taken username is refused by Postgres rather than by a check-then-insert
     * that could lose a race. `niceAuthError` turns that rejection into "That
     * username is taken."
     *
     * Email and phone are CONTACT DETAILS: nothing is sent to either, neither
     * is verified, and neither can be used to take the account over. The
     * `handle_new_user` trigger (migration 0018) files them into
     * `profiles_private`.
     */
    async signUp(input: SignUpInput): Promise<User> {
      const username = assertUsername(input.username);
      const { email, phone } = assertContactDetails(input);
      const password = assertPassword(input.password);
      const loginEmail = usernameToEmail(username);
      const displayName = input.name?.trim() || username;

      const { data, error } = await sb.auth.signUp({
        email: loginEmail,
        password,
        options: { data: { name: displayName, username, phone, email } },
      });
      if (error) throw new Error(niceAuthError(error.message));

      let userId = data.user?.id;
      if (!data.session) {
        const signedIn = await sb.auth.signInWithPassword({
          email: loginEmail,
          password,
        });
        if (signedIn.error) throw new Error(niceAuthError(signedIn.error.message));
        userId = signedIn.data.user.id;
      }
      if (!userId) throw new Error('Sign-up did not return an account. Please try again.');
      return fetchProfileViaApi(userId, input.name);
    },

    async signOut(): Promise<void> {
      await sb.auth.signOut();
      await clearCache();
    },

    async signInAs(userId: string): Promise<User> {
      // Real auth has no service-role impersonation on the client, so we do a
      // genuine sign-in as the target user with the shared seed password. Only
      // works for the seeded test accounts (created with TEST_PASSWORD).
      // Hard-gated: impersonation must never be reachable in a release build.
      assertDevTool('Switching identity');
      const profile = await http.get<User | null>(`/users/${seg(userId)}`);
      // Handle first, phone as the fallback — see the note in the Path A twin:
      // an account given a username no longer answers to its phone address.
      const address = profile?.username
        ? usernameToEmail(profile.username)
        : profile?.phone
          ? phoneToEmail(profile.phone)
          : null;
      if (!address) {
        // `phone` lives in `profiles_private` and the API hands it over only to
        // the account itself or a platform super-admin — so for an ordinary
        // account this is the EXPECTED answer, not a broken read. Say that,
        // rather than implying the account has no phone number.
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
      return fetchProfileViaApi(data.user.id, data.user.user_metadata?.name);
    },

    async signInGuest(): Promise<User> {
      // Identity is Supabase (same as Path A), so a guest gets an anonymous
      // Supabase session; the app keeps treating them as a guest.
      const { data: sessionData } = await sb.auth.getSession();
      const existing = sessionData.session?.user;
      if (existing) {
        if (existing.is_anonymous) {
          return { id: existing.id, name: 'Guest', isProfilePublic: false, isAnonymous: true };
        }
        return fetchProfileViaApi(existing.id, existing.user_metadata?.name);
      }
      const { data, error } = await sb.auth.signInAnonymously();
      if (error || !data.user) {
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
     * Identity is Supabase in Path B too — the Express API verifies a JWT and
     * never issues one — so the Google and password-reset flows are the SAME
     * GoTrue calls as Path A, delegated wholesale rather than reimplemented.
     * Only the profile read afterwards goes through the API. See [SYNC-027].
     */
    async signInWithGoogle(): Promise<User> {
      await supabaseAuth.signInWithGoogle();
      const { data } = await sb.auth.getSession();
      const userId = data.session?.user.id;
      if (!userId) throw new Error('Google signed you in, but no session came back. Try again.');
      return fetchProfileViaApi(userId, data.session?.user.user_metadata?.name);
    },

    /**
     * Delegated for the same reason as Google above: the account being deleted
     * is a SUPABASE auth user in Path B too — the Express API verifies JWTs and
     * never issues them — so closing it is the same edge-function call, and a
     * second implementation could only drift from it. Both backends share one
     * database, so migration 0019's scrub covers Path B's data as well.
     * See [SYNC-031].
     */
    async deleteAccount(): Promise<DeleteAccountResult> {
      return supabaseAuth.deleteAccount();
    },

    /**
     * Delegated for the third time and the same reason: passwords live in
     * GoTrue, not in the Express API, so there is no endpoint to add here and a
     * second implementation could only drift. See [SYNC-032].
     */
    async changePassword(currentPassword: string, newPassword: string): Promise<void> {
      return supabaseAuth.changePassword(currentPassword, newPassword);
    },
  };
}

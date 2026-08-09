/**
 * Auth for the API backend.
 *
 * Identity still comes from Supabase (sign-in/up over the synthetic phone email
 * → a real JWT session), exactly like Path A — but the PROFILE read points at
 * the Express API (GET /users/:id), so the app never diverges on where user
 * data comes from once signed in.
 */
import type { AuthRepository, SignUpInput } from '@/data/repositories';
import type { User } from '@/domain/types';
import { getSupabase } from '@/lib/supabase';
import { clearCache } from '@/lib/queryCache';
import {
  TEST_PASSWORD,
  assertDevTool,
  fallbackUser,
  niceAuthError,
  phoneToEmail,
} from '@/data/supabase/shared';
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

    async signIn(phoneOrEmail: string, password?: string): Promise<User> {
      const { data, error } = await sb.auth.signInWithPassword({
        email: phoneToEmail(phoneOrEmail),
        password: password ?? '',
      });
      if (error) throw new Error(niceAuthError(error.message));
      return fetchProfileViaApi(data.user.id, data.user.user_metadata?.name);
    },

    async signUp(input: SignUpInput): Promise<User> {
      if (!input.password || input.password.length < 6) {
        throw new Error('Please choose a password of at least 6 characters.');
      }
      const { data, error } = await sb.auth.signUp({
        email: phoneToEmail(input.phone),
        password: input.password,
        options: { data: { name: input.name, phone: input.phone } },
      });
      if (error) throw new Error(niceAuthError(error.message));

      let userId = data.user?.id;
      if (!data.session) {
        const signedIn = await sb.auth.signInWithPassword({
          email: phoneToEmail(input.phone),
          password: input.password,
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
      if (!profile?.phone) {
        // `phone` lives in `profiles_private` and the API hands it over only to
        // the account itself or a platform super-admin — so for an ordinary
        // account this is the EXPECTED answer, not a broken read. Say that,
        // rather than implying the account has no phone number.
        throw new Error(
          "Can't switch to this account — its phone number isn't visible to you. " +
            'Identity switching needs a platform super-admin account.',
        );
      }
      const { data, error } = await sb.auth.signInWithPassword({
        email: phoneToEmail(profile.phone),
        password: TEST_PASSWORD,
      });
      if (error) {
        // Deliberately does NOT echo the password — error text ends up in Metro
        // logs, crash reporters and screenshots.
        throw new Error(
          `Can't switch to ${profile.name} — this only works for seeded test accounts created with the shared dev password. Sign in manually instead.`,
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
  };
}

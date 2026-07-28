/**
 * Supabase-backed authentication.
 *
 * Phone-first UX over Supabase email+password: the phone becomes a synthetic
 * email (see shared.phoneToEmail), so there's no paid SMS and sessions are real
 * and persistent. The `profiles` row is created by the `handle_new_user`
 * database trigger from the name/phone we pass as sign-up metadata.
 */
import type { AuthRepository, SignUpInput } from '@/data/repositories';
import type { User } from '@/domain/types';
import { getSupabase } from '@/lib/supabase';
import { clearCache } from '@/lib/queryCache';
import {
  TEST_PASSWORD,
  fallbackUser,
  fetchProfile,
  niceAuthError,
  phoneToEmail,
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
      return profile ?? fallbackUser(session.user.id, session.user.user_metadata?.name);
    },

    async signIn(phoneOrEmail: string, password?: string): Promise<User> {
      const { data, error } = await sb.auth.signInWithPassword({
        email: phoneToEmail(phoneOrEmail),
        password: password ?? '',
      });
      if (error) throw new Error(niceAuthError(error.message));
      const profile = await fetchProfile(data.user.id);
      return profile ?? fallbackUser(data.user.id, data.user.user_metadata?.name);
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

      // With "Confirm email" off (the dev setting), sign-up returns a session
      // immediately. If it didn't, sign in to obtain one.
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

      const profile = await fetchProfile(userId);
      return profile ?? fallbackUser(userId, input.name);
    },

    async signOut(): Promise<void> {
      await sb.auth.signOut();
      await clearCache();
    },

    async signInAs(userId: string): Promise<User> {
      // Real auth has no service-role impersonation on the client, so instead we
      // do a genuine sign-in as the target user with the shared seed password.
      // This only works for the seeded test accounts (created with TEST_PASSWORD).
      const profile = await fetchProfile(userId);
      if (!profile?.phone) {
        throw new Error(
          "Can't switch to this account — it has no phone on file to sign in with.",
        );
      }
      const { data, error } = await sb.auth.signInWithPassword({
        email: phoneToEmail(profile.phone),
        password: TEST_PASSWORD,
      });
      if (error) {
        throw new Error(
          `Can't switch to ${profile.name} — this only works for seeded test accounts (password "${TEST_PASSWORD}"). Sign in manually instead.`,
        );
      }
      await clearCache();
      const fresh = await fetchProfile(data.user.id);
      return fresh ?? fallbackUser(data.user.id, data.user.user_metadata?.name);
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
        return profile ?? fallbackUser(existing.id, existing.user_metadata?.name);
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
  };
}

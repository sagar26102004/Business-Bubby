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
import { fallbackUser, fetchProfile, niceAuthError, phoneToEmail } from './shared';

export function createSupabaseAuth(): AuthRepository {
  const sb = getSupabase();

  return {
    async getCurrentUser(): Promise<User | null> {
      const { data } = await sb.auth.getSession();
      const session = data.session;
      if (!session) return null;
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

    async signInAs(): Promise<User> {
      // Real auth has no client-side impersonation (that needs the service-role
      // key). Dev Tools' "sign in as" is a mock-only feature.
      throw new Error('Switching identity is only available on the mock backend.');
    },
  };
}

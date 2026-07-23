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
import { fallbackUser, niceAuthError, phoneToEmail } from '@/data/supabase/shared';
import { http, seg } from './client';

/** Read a profile via the API, falling back when the row isn't ready yet. */
async function fetchProfileViaApi(id: string, name?: string): Promise<User> {
  try {
    const user = await http.get<User | null>(`/users/${seg(id)}`);
    return user ?? fallbackUser(id, name);
  } catch {
    return fallbackUser(id, name);
  }
}

export function createApiAuth(): AuthRepository {
  const sb = getSupabase();

  return {
    async getCurrentUser(): Promise<User | null> {
      const { data } = await sb.auth.getSession();
      const session = data.session;
      if (!session) return null;
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

    async signInAs(): Promise<User> {
      throw new Error('Switching identity is only available on the mock backend.');
    },
  };
}

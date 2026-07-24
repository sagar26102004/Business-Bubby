/**
 * Supabase-backed UserRepository over the `profiles` table (data = domain User).
 */
import type { NewUserInput, UserRepository } from '@/data/repositories';
import type { User } from '@/domain/types';
import { getSupabase } from '@/lib/supabase';
import {
  TEST_PASSWORD,
  fallbackUser,
  fetchProfile,
  niceAuthError,
  phoneToEmail,
  syntheticTestPhone,
} from './shared';

export function createSupabaseUsers(): UserRepository {
  const sb = getSupabase();

  return {
    async getById(id: string): Promise<User | null> {
      return fetchProfile(id);
    },

    async list(): Promise<User[]> {
      const { data, error } = await sb.from('profiles').select('data');
      if (error) throw error;
      return (data ?? []).map((r) => r.data as User);
    },

    async search(term: string): Promise<User[]> {
      const q = term.trim().toLowerCase();
      if (!q) return [];
      // Small directory — fetch and filter by name in JS (public profiles only).
      const { data, error } = await sb.from('profiles').select('data');
      if (error) throw error;
      return (data ?? [])
        .map((r) => r.data as User)
        .filter((u) => u.isProfilePublic && u.name.toLowerCase().includes(q));
    },

    async create(input: NewUserInput): Promise<User> {
      // Dev Tools' "Add a test account". The client can't provision an account
      // for a THIRD party (that needs the service-role key), so we sign one up
      // for real with the shared TEST_PASSWORD + a synthetic phone — which makes
      // it a first-class switchable test account (Dev Tools' identity switch
      // signs in as it with the same password). Note: signUp establishes the
      // NEW user's session, so the caller (dev.tsx) switches into it afterwards.
      const phone = syntheticTestPhone();
      const { data, error } = await sb.auth.signUp({
        email: phoneToEmail(phone),
        password: TEST_PASSWORD,
        options: { data: { name: input.name, phone } },
      });
      if (error) throw new Error(niceAuthError(error.message));
      const userId = data.user?.id;
      if (!userId) throw new Error('Account creation did not return a user. Please try again.');
      const profile = await fetchProfile(userId);
      return profile ?? fallbackUser(userId, input.name);
    },

    async update(id: string, patch: Partial<User>): Promise<User> {
      const current = (await fetchProfile(id)) ?? ({ id } as User);
      const next = { ...current, ...patch, id };
      const { error } = await sb.from('profiles').update({ data: next }).eq('id', id);
      if (error) throw error;
      return next;
    },
  };
}

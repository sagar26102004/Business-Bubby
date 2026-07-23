/**
 * Supabase-backed UserRepository over the `profiles` table (data = domain User).
 */
import type { NewUserInput, UserRepository } from '@/data/repositories';
import type { User } from '@/domain/types';
import { getSupabase } from '@/lib/supabase';
import { fetchProfile } from './shared';

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

    async create(_input: NewUserInput): Promise<User> {
      // Creating a user means creating an auth account, which the client can't
      // do for someone else (needs the service-role key). This dev-tools path
      // is unsupported against real auth.
      throw new Error('Creating accounts directly is only available on the mock backend.');
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

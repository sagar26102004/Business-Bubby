/**
 * Supabase-backed UserRepository over the `profiles` table (data = domain User).
 */
import type { NewUserInput, UserRepository } from '@/data/repositories';
import { matchesUserSearch, type User } from '@/domain/types';
import { getSupabase } from '@/lib/supabase';
import {
  PRIVATE_PROFILE_KEYS,
  TEST_PASSWORD,
  assertDevTool,
  fallbackUser,
  fetchPrivateProfiles,
  fetchProfile,
  niceAuthError,
  phoneToEmail,
  syntheticTestPhone,
} from './shared';

/**
 * Attach contact details to directory results — but only the ones RLS actually
 * hands over (your own, or everything if you're a platform super-admin).
 *
 * So the pickers behave differently by design: a super-admin choosing a
 * business owner still sees phone numbers to tell two people apart, while an
 * ordinary shop owner searching for a customer gets names only. Typing a
 * stranger's name is not a reason to be given their phone number.
 */
async function withPrivate(users: User[]): Promise<User[]> {
  const privates = await fetchPrivateProfiles(users.map((u) => u.id));
  return users.map((u) => ({ ...u, ...(privates.get(u.id) ?? {}) }));
}

export function createSupabaseUsers(): UserRepository {
  const sb = getSupabase();

  return {
    async getById(id: string): Promise<User | null> {
      return fetchProfile(id);
    },

    async list(): Promise<User[]> {
      const { data, error } = await sb.from('profiles').select('data');
      if (error) throw error;
      return withPrivate((data ?? []).map((r) => r.data as User));
    },

    async search(term: string): Promise<User[]> {
      if (!term.trim()) return [];
      // Small directory — fetch and filter in JS. Every named account is
      // findable (matching the mock): search is how a business links a
      // teammate or bills a customer, so a private profile — which only hides
      // someone's tappable employee page — must still be reachable here.
      // Anonymous guests have no name and no username, so they never match.
      const { data, error } = await sb.from('profiles').select('data');
      if (error) throw error;
      const all = (data ?? []).map((r) => r.data as User).filter((u) => !!u.name || !!u.username);
      // The public card carries the name and the username; that answers almost
      // every search without a second round trip.
      const matches = all.filter((u) => matchesUserSearch(u, term));
      if (matches.length > 0) return withPrivate(matches);
      // Nothing public matched. If what was typed looks like a phone or an
      // email, try again over the private half — which RLS hands back only for
      // yourself or a super-admin, so this finds nothing extra for anyone else.
      const looksPrivate = /[@\d]/.test(term);
      if (!looksPrivate) return [];
      const merged = await withPrivate(all);
      return merged.filter((u) => matchesUserSearch(u, term));
    },

    async create(input: NewUserInput): Promise<User> {
      // Dev Tools' "Add a test account". The client can't provision an account
      // for a THIRD party (that needs the service-role key), so we sign one up
      // for real with the shared TEST_PASSWORD + a synthetic phone — which makes
      // it a first-class switchable test account (Dev Tools' identity switch
      // signs in as it with the same password). Note: signUp establishes the
      // NEW user's session, so the caller (dev.tsx) switches into it afterwards.
      // Creates a REAL account on whichever backend is configured — dev only.
      assertDevTool('Adding a test account');
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

      // Split the write the same way the database splits the document:
      //  - `isSuperAdmin` is DERIVED from platform_admins for the session and is
      //    never stored anywhere (migration 0006).
      //  - phone / email / mutedNotifications live in `profiles_private`, out of
      //    the world-readable card (migration 0007).
      // Triggers strip these from `profiles` regardless; doing it here keeps the
      // client honest and the returned object equal to what was actually stored.
      const { isSuperAdmin: _derived, phone, email, mutedNotifications, ...publicCard } = next;

      const { error } = await sb.from('profiles').update({ data: publicCard }).eq('id', id);
      if (error) throw error;

      // Only touch the private half when the caller actually changed part of it.
      if (PRIVATE_PROFILE_KEYS.some((key) => key in patch)) {
        const privateData: Partial<User> = {};
        if (phone !== undefined) privateData.phone = phone;
        if (email !== undefined) privateData.email = email;
        if (mutedNotifications !== undefined) privateData.mutedNotifications = mutedNotifications;
        const { error: privateError } = await sb
          .from('profiles_private')
          .upsert({ id, data: privateData });
        if (privateError) throw privateError;
      }
      return next;
    },
  };
}

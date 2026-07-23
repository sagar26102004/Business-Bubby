/**
 * Small helpers shared by the Supabase repositories.
 */
import type { User } from '@/domain/types';
import { getSupabase } from '@/lib/supabase';

/**
 * Localo is phone-first, but we authenticate with Supabase email+password (no
 * paid SMS). Each phone maps to a stable synthetic email so accounts and
 * sessions are real. A value that already looks like an email is left as-is.
 */
export function phoneToEmail(phoneOrEmail: string): string {
  if (phoneOrEmail.includes('@')) return phoneOrEmail.trim().toLowerCase();
  const digits = phoneOrEmail.replace(/\D/g, '');
  return `${digits}@localo.app`;
}

/** Turn a raw Supabase/PostgREST error into a friendlier message. */
export function niceAuthError(message: string): string {
  const m = message.toLowerCase();
  if (m.includes('invalid login')) return 'Wrong phone number or password.';
  if (m.includes('already registered') || m.includes('already been registered'))
    return 'An account with this phone number already exists. Sign in instead.';
  if (m.includes('password')) return message; // e.g. "Password should be at least 6 characters"
  if (m.includes('email not confirmed'))
    return 'Email confirmation is on for this project — turn it off in Supabase (Auth → Providers → Email) for phone sign-up to work.';
  return message;
}

/** Read a profile row's domain User, or null when it doesn't exist yet. */
export async function fetchProfile(id: string): Promise<User | null> {
  const { data, error } = await getSupabase()
    .from('profiles')
    .select('data')
    .eq('id', id)
    .maybeSingle();
  if (error) throw error;
  return data ? (data.data as User) : null;
}

/** A minimal User when the profile row hasn't been created yet (trigger lag). */
export function fallbackUser(id: string, name?: string): User {
  return { id, name: name || 'You', isProfilePublic: true };
}

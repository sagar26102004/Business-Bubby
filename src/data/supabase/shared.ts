/**
 * Small helpers shared by the Supabase repositories.
 *
 * Every table follows the DOCUMENT MODEL (see supabase/migrations/0001): a real
 * `id` + scoping columns for RLS, and a `data jsonb` column holding the full
 * domain object (the same shape as src/domain/types.ts). Repositories therefore
 * map almost entirely through `row.data`; the scoping columns exist so Postgres
 * RLS can decide who sees what.
 */
import type { AppNotification, User } from '@/domain/types';
import { getSupabase } from '@/lib/supabase';
import type { SupabaseClient } from '@supabase/supabase-js';

/** The shared client. Thin accessor so repos read `sb()` like the mock reads its arrays. */
export function sb(): SupabaseClient {
  return getSupabase();
}

/** RFC-4122 v4 id. Rows are `uuid` PKs and `data.id` must equal the row id, so
 * we mint one id and use it for both — one insert, no round-trip to read it back. */
export function uuid(): string {
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    const v = c === 'x' ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}

export const nowIso = (): string => new Date().toISOString();

/**
 * Shared password for the seeded / Dev-Tools test accounts (see CLAUDE.md —
 * phones 9812340001–10). Real auth has no client-side impersonation, so Dev
 * Tools' "switch identity" signs in as the target for real using this known
 * credential. Only works for accounts created with it (the seed set + any made
 * through Dev Tools' "Add a test account").
 */
export const TEST_PASSWORD = 'localo123';

/** A unique synthetic phone for a Dev-Tools test account (11-digit, 78-prefixed
 * so it never collides with the seeded 9812340001–10 range). */
export function syntheticTestPhone(): string {
  return '78' + String(Date.now()).slice(-9);
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export const isUuid = (v?: string): boolean => !!v && UUID_RE.test(v);
/** A uuid scoping column value, or null for synthetic ids ('guest', 'walkin:…'). */
export const uuidOrNull = (v?: string): string | null => (isUuid(v) ? (v as string) : null);

/** The signed-in user's id, or null when browsing as a guest. */
export async function currentUserId(): Promise<string | null> {
  const { data } = await sb().auth.getSession();
  return data.session?.user.id ?? null;
}

/**
 * Write a notification for another user (chat replies, order/booking updates,
 * etc.). RLS lets any signed-in user INSERT notifications (they're side effects
 * for OTHER users). Recipients that aren't real accounts ('guest', standalone
 * members) have no inbox, so we simply skip them — the FK would reject them.
 */
export async function notify(
  n: Omit<AppNotification, 'id' | 'read' | 'createdAt'>,
): Promise<void> {
  if (!isUuid(n.recipientId)) return;
  const id = uuid();
  const full: AppNotification = { ...n, id, read: false, createdAt: nowIso() };
  // Best-effort: a notification is a SIDE EFFECT for another user. Its INSERT
  // must never fail the core operation (the order/bill/message that triggered
  // it). If the live DB has hardened the notifications INSERT policy to
  // recipient-only, this simply no-ops — run supabase/migrations/0003 to restore
  // cross-user notifications. Errors (RLS or network) are swallowed either way.
  try {
    await sb().from('notifications').insert({ id, recipient_id: n.recipientId, read: false, data: full });
  } catch {
    /* ignore — notifications are non-critical */
  }
}

/** Read a profile row's domain User, or null when it doesn't exist yet. */
export async function fetchProfile(id: string): Promise<User | null> {
  const { data, error } = await sb().from('profiles').select('data').eq('id', id).maybeSingle();
  if (error) throw error;
  return data ? (data.data as User) : null;
}

/** A minimal User when the profile row hasn't been created yet (trigger lag). */
export function fallbackUser(id: string, name?: string): User {
  return { id, name: name || 'You', isProfilePublic: true };
}

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
  if (m.includes('password')) return message;
  if (m.includes('email not confirmed'))
    return 'Email confirmation is on for this project — turn it off in Supabase (Auth → Providers → Email) for phone sign-up to work.';
  return message;
}

/** Map an array of `{ data }` rows to their domain objects. */
export function mapData<T>(rows: Array<{ data: T }> | null | undefined): T[] {
  return (rows ?? []).map((r) => r.data);
}

/** Newest-first by an ISO string field. */
export function byNewest<T>(pick: (x: T) => string) {
  return (a: T, b: T) => pick(b).localeCompare(pick(a));
}

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
import { getSupabase, SUPABASE_ANON_KEY, SUPABASE_URL } from '@/lib/supabase';
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
 * SERVER-ANCHORED CLOCK.
 *
 * Some logic compares a timestamp written by ONE device against the clock of
 * ANOTHER (the ring timeout is the sharp case: the caller stamps `startedAt`,
 * every business member's poll decides whether it has rung out). A device whose
 * clock is off by more than the window then makes that decision wrongly for
 * everyone — a phone running ~39s fast expired every incoming call on its first
 * poll, so the caller saw "No answer" within two seconds and the phone never
 * rang at all. Phone clocks drift, and we do not control them.
 *
 * So elapsed time is measured against the DATABASE's clock, not the device's:
 * `offsetMs` is how far this device is from the server, learned from the `Date`
 * header that every PostgREST response carries. It's cheap (one HEAD request,
 * re-checked every few minutes) and it degrades to the local clock — i.e. to
 * exactly the old behaviour — when the probe fails.
 */
let offsetMs = 0;
let lastSyncAt = 0;
let lastAttemptAt = 0;
let inFlight: Promise<void> | null = null;
const CLOCK_REFRESH_MS = 5 * 60_000;
/** Floor between attempts, so a failing probe can't ride every 2s call poll. */
const CLOCK_RETRY_MS = 15_000;

/**
 * Learn this device's offset from the server clock. Cheap and idempotent: it
 * no-ops while a recent reading stands, and concurrent callers share one probe.
 * Best-effort — a failed probe leaves the last known offset in place.
 */
export async function syncServerClock(): Promise<void> {
  if (!SUPABASE_URL || Date.now() - lastSyncAt < CLOCK_REFRESH_MS) return;
  if (Date.now() - lastAttemptAt < CLOCK_RETRY_MS) return;
  if (inFlight) return inFlight;
  lastAttemptAt = Date.now();
  inFlight = (async () => {
    const sentAt = Date.now();
    const serverMs = await readServerTime();
    if (serverMs !== null) {
      // The reading landed somewhere inside the round trip; charge half of it
      // to the response leg so a slow network doesn't read as clock drift.
      offsetMs = serverMs - (sentAt + (Date.now() - sentAt) / 2);
      lastSyncAt = Date.now();
    }
    inFlight = null;
  })();
  return inFlight;
}

/**
 * The server's current time in ms, or null if it can't be read (offline, or
 * neither source available) — in which case the caller keeps the local clock.
 *
 * Two sources, because neither alone covers both platforms:
 *  1. `server_now()` — a one-line SQL function (migration 0010). Works on web
 *     AND native, but only once that migration has been applied.
 *  2. The `Date` response header. Needs no migration, but browsers only expose
 *     CORS-safelisted headers and `Date` isn't one — so this is the native path.
 */
async function readServerTime(): Promise<number | null> {
  try {
    const { data, error } = await sb().rpc('server_now');
    if (!error && typeof data === 'string') {
      const ms = new Date(data).getTime();
      if (!Number.isNaN(ms)) return ms;
    }
  } catch {
    /* function not deployed yet — fall through to the header */
  }
  try {
    // Reads the header, not the body: an unauthorised response carries `Date`
    // just the same, so this needs no valid session.
    const res = await fetch(`${SUPABASE_URL}/rest/v1/`, {
      method: 'HEAD',
      headers: { apikey: SUPABASE_ANON_KEY },
    });
    const header = res.headers.get('date');
    if (header) {
      const ms = new Date(header).getTime();
      if (!Number.isNaN(ms)) return ms;
    }
  } catch {
    /* offline */
  }
  return null;
}

/**
 * `Date.now()` corrected onto the server's clock. Use this for any elapsed-time
 * decision made about a timestamp another device wrote. Refreshes the offset in
 * the background; the first call returns the local clock, which is why callers
 * that care (the ring sweep) await `syncServerClock()` first.
 */
export function serverNow(): number {
  void syncServerClock();
  return Date.now() + offsetMs;
}

/**
 * Shared password for the seeded / Dev-Tools test accounts (see CLAUDE.md —
 * phones 9812340001–10). Real auth has no client-side impersonation, so Dev
 * Tools' "switch identity" signs in as the target for real using this known
 * credential. Only works for accounts created with it (the seed set + any made
 * through Dev Tools' "Add a test account").
 *
 * ⚠️ NEVER hardcode the value here. This module ships in the app bundle, so a
 * literal would be readable by anyone who downloads the app — and combined with
 * the fact that every account's login email is derived from its phone
 * (`phoneToEmail`), a known shared password is account takeover for every
 * account created with it.
 *
 * It therefore comes from `EXPO_PUBLIC_SEED_PASSWORD`, which only ever lives in
 * a local, gitignored `.env` — production builds (eas.json) do not set it, so
 * there is nothing to inline. `__DEV__` is a build-time literal, so in a
 * release bundle this whole expression folds to `''` and the dev-only branch is
 * eliminated outright.
 */
export const TEST_PASSWORD = __DEV__ ? (process.env.EXPO_PUBLIC_SEED_PASSWORD ?? '') : '';

/**
 * Gate a development-only tool. Throws in a release build (where the whole
 * feature should be unreachable anyway) and explains the missing setup in dev.
 * Called by the impersonation paths so they can never run in production even if
 * a screen forgets to check `DEV_TOOLS_ENABLED`.
 */
export function assertDevTool(action: string): void {
  if (!__DEV__) {
    throw new Error(`${action} is a development-only tool and is disabled in this build.`);
  }
  if (!TEST_PASSWORD) {
    throw new Error(
      `${action} needs EXPO_PUBLIC_SEED_PASSWORD set in your local .env (see .env.example), ` +
        'then restart the dev server.',
    );
  }
}

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

/**
 * Fields that live in `profiles_private`, not the world-readable `profiles`
 * card (migration 0007). Contact details and preferences — never part of the
 * public directory.
 */
export const PRIVATE_PROFILE_KEYS = ['phone', 'email', 'mutedNotifications'] as const;

/**
 * Read the private half of a profile: contact details and preferences. RLS
 * returns a row only for the account itself or a platform super-admin, so for
 * anyone else this is simply empty — which is the point.
 *
 * Best-effort: a project that hasn't run 0007 has no such table, and that must
 * degrade to "no private fields", never break a profile read.
 */
export async function fetchPrivateProfile(id: string): Promise<Partial<User>> {
  try {
    const { data, error } = await sb()
      .from('profiles_private')
      .select('data')
      .eq('id', id)
      .maybeSingle();
    if (error || !data) return {};
    return (data.data ?? {}) as Partial<User>;
  } catch {
    return {};
  }
}

/**
 * The private halves of many profiles at once, keyed by id. RLS filters the
 * result to what the caller may actually see — their own row, plus everything
 * if they're a super-admin — so this is safe to call with any id list: an
 * ordinary user simply gets a near-empty map back.
 */
export async function fetchPrivateProfiles(
  ids: string[],
): Promise<Map<string, Partial<User>>> {
  const out = new Map<string, Partial<User>>();
  if (ids.length === 0) return out;
  try {
    const { data, error } = await sb()
      .from('profiles_private')
      .select('id, data')
      .in('id', ids);
    if (error || !data) return out;
    for (const row of data as { id: string; data: Partial<User> | null }[]) {
      out.set(row.id, row.data ?? {});
    }
  } catch {
    /* table missing (pre-0007) — no private fields, which is the safe answer */
  }
  return out;
}

/**
 * Read a profile as a domain User, or null when it doesn't exist yet.
 *
 * `profiles` holds the PUBLIC directory card (name, isProfilePublic, avatar);
 * phone/email/mutes live in `profiles_private`. Both are read and merged here,
 * so callers keep getting one `User` — but the private half comes back empty
 * unless you're that user (or a super-admin), enforced by RLS rather than by
 * anything this client does.
 */
export async function fetchProfile(id: string): Promise<User | null> {
  const [{ data, error }, privateFields] = await Promise.all([
    sb().from('profiles').select('data').eq('id', id).maybeSingle(),
    fetchPrivateProfile(id),
  ]);
  if (error) throw error;
  return data ? ({ ...(data.data as User), ...privateFields } as User) : null;
}

/**
 * Is this user a platform super-admin? The grant lives in `platform_admins`
 * (migration 0006), whose only policy is "read your own row" — so this answers
 * truthfully for the signed-in user and always false for anyone else, which is
 * exactly what we want to expose.
 *
 * Best-effort: a project that hasn't run 0006 yet has no such table, and the
 * error must not block sign-in — it just means nobody is an admin.
 */
export async function fetchIsSuperAdmin(userId: string): Promise<boolean> {
  try {
    const { data, error } = await sb()
      .from('platform_admins')
      .select('user_id')
      .eq('user_id', userId)
      .maybeSingle();
    if (error) return false;
    return !!data;
  } catch {
    return false;
  }
}

/**
 * Stamp the DERIVED super-admin flag onto a session user. `isSuperAdmin` is
 * never stored on the profile (a trigger strips it) — it is read from
 * `platform_admins` each time we establish who is signed in.
 */
export async function withAdminFlag(user: User): Promise<User> {
  return { ...user, isSuperAdmin: await fetchIsSuperAdmin(user.id) };
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
  // Guest calls and guest chat both mint an anonymous identity. When the
  // project toggle is off, Supabase just says "Anonymous sign-ins are disabled",
  // which reads like a dead end — say where to turn it on instead.
  if (m.includes('anonymous'))
    return 'Guest access is off for this project. Turn on Supabase → Authentication → Sign In / Providers → “Allow anonymous sign-ins”, or sign in to continue.';
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

/// <reference types="node" />
/**
 * Shared bits for the bulk-listing scripts (maps-bot, menu-from-photos,
 * list-business). See scripts/list-business.ts for the folder layout.
 */
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { existsSync, readFileSync, readdirSync, renameSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { GeoPoint } from '@/domain/types';
import { haversineKm } from '@/lib/geo';

export function readEnv(file: string): Record<string, string> {
  if (!existsSync(file)) return {};
  const out: Record<string, string> = {};
  for (const line of readFileSync(file, 'utf8').split(/\r?\n/)) {
    const m = /^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/.exec(line);
    if (m) out[m[1]] = m[2].replace(/^["']|["']$/g, '');
  }
  return out;
}

/** `.env` + the gitignored `scripts/.listing.env`. Run the scripts from the repo root. */
export const env: Record<string, string> = {
  ...readEnv(join(process.cwd(), '.env')),
  ...readEnv(join(process.cwd(), 'scripts', '.listing.env')),
};

export function need(key: string): string {
  const v = env[key];
  if (!v) throw new Error(`Missing ${key} (in .env or scripts/.listing.env).`);
  return v;
}

export const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * Where the bulk-listing work lives (LISTING-PLAN.md, "Folder layout"). Each
 * collector bot has its own folder under LISTING_ROOT; the food pipeline
 * (Zomato / Google cafés) lives in `food data`. The registries every bot and
 * the publisher share — published keys, owner accounts, outreach log — sit in
 * `shared`, because they are about the whole platform, not one bot.
 */
export const LISTING_ROOT = 'E:/listing';
export const SHARED_DIR = join(LISTING_ROOT, 'shared');
export const FOOD_ROOT = join(LISTING_ROOT, 'food data');

/** A business name as a Windows folder name. */
export const folderName = (name: string) =>
  name.replace(/[<>:"/\\|?*\u0000-\u001f]/g, ' ').replace(/\s+/g, ' ').trim().replace(/[. ]+$/, '');

/**
 * A menu heading ("Cold Coffee", "Chinese Cuisine") → the food library's own
 * section, so pasted menus line up with the editor (domain/foodMenu.ts). The
 * heading itself survives as the folder underneath.
 */
const SECTION_RULES: [RegExp, string][] = [
  [/coffee|tea|shake|smoothie|drink|beverage|juice|mocktail|mojito|lassi|soda|cooler|frapp|latte|brew/i, 'Beverages'],
  [/dessert|sweet|cake|brownie|ice ?cream|waffle|pastr|kulfi/i, 'Desserts'],
  [/pizza/i, 'Pizza'],
  [/burger/i, 'Burger'],
  [/sandwich|toast|sub\b|wrap|roll/i, 'Sandwich'],
  [/pasta|spaghetti|penne|mac/i, 'Pasta'],
  [/noodle|maggi|chinese|chowmein|hakka/i, 'Noodles'],
  [/soup/i, 'Soups'],
  [/salad/i, 'Salads'],
  [/rice|biryani|pulao/i, 'Rice'],
  [/bread|naan|roti|paratha|kulcha/i, 'Breads'],
  [/main|curry|thali|sabzi|dal\b|paneer/i, 'Main Course'],
  [/starter|appeti|snack|fries|nugget|bites|momo|garlic bread|chaat|pakod/i, 'Appetizers'],
];

export function sectionFor(heading: string): string {
  for (const [re, section] of SECTION_RULES) if (re.test(heading)) return section;
  return heading;
}

/* ───────────────────────── duplicate guard ──────────────────────────────── */

/**
 * The SAME business = same normalised name + pins within DUP_RADIUS_KM. Name
 * alone would merge a chain's branches; an exact pin would miss the few metres
 * between a Google pin and one dropped in the app.
 */
export const DUP_RADIUS_KM = 0.15;
/** Closer than this with one name inside the other → worth a human look. */
const NEAR_RADIUS_KM = 0.05;

/** "Amigos Café & Restaurant" → "amigoscafeandrestaurant". */
const normCache = new Map<string, string>();
/** Cached: the merge asks for the same names millions of times. */
export const normName = (name: string): string => {
  let k = normCache.get(name);
  if (k === undefined) normCache.set(name, (k = computeNormName(name)));
  return k;
};
const computeNormName = (name: string) =>
  // Hindi names are romanised first — otherwise every Devanagari name keys to ""
  // and any two of them within 150 m would count as one business.
  romanize(name)
    // NFKC: "𝐃𝐫. 𝐌𝐞𝐡𝐭𝐚" (styled Unicode letters people paste into Google) → "Dr. Mehta".
    .normalize('NFKC')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/&/g, 'and')
    .replace(/[^a-z0-9]/g, '');

export interface KnownListing {
  /** Live business id, or the local folder path. */
  ref: string;
  name: string;
  point?: GeoPoint;
}

export type DuplicateCheck =
  | { kind: 'duplicate'; of: KnownListing; metres: number }
  | { kind: 'near'; of: KnownListing; metres: number }
  | null;

export function findDuplicate(name: string, point: GeoPoint | undefined, known: KnownListing[]): DuplicateCheck {
  if (!point) return null;
  const key = normName(name);
  let near: DuplicateCheck = null;
  for (const k of known) {
    if (!k.point) continue;
    const km = haversineKm(point, k.point);
    const other = normName(k.name);
    if (other === key && km <= DUP_RADIUS_KM) return { kind: 'duplicate', of: k, metres: Math.round(km * 1000) };
    if (!near && km <= NEAR_RADIUS_KM && key && other && (other.includes(key) || key.includes(other))) {
      near = { kind: 'near', of: k, metres: Math.round(km * 1000) };
    }
  }
  return near;
}

/** Every live listing's name + pin, whoever owns it (businesses are world-readable). */
export async function loadLiveListings(sb: SupabaseClient): Promise<KnownListing[]> {
  const out: KnownListing[] = [];
  for (let from = 0; ; from += 1000) {
    const { data, error } = await sb
      .from('businesses')
      .select('id, name:data->>name, point:data->location->point')
      .range(from, from + 999);
    if (error) throw error;
    for (const r of data ?? []) out.push({ ref: r.id as string, name: (r.name as string) ?? '', point: (r.point as unknown as GeoPoint) ?? undefined });
    if (!data || data.length < 1000) return out;
  }
}

/** A read-only Supabase client — enough for loadLiveListings. */
export const anonClient = () =>
  createClient(need('EXPO_PUBLIC_SUPABASE_URL'), need('EXPO_PUBLIC_SUPABASE_ANON_KEY'), {
    auth: { persistSession: false, autoRefreshToken: false },
  });

/** Name + pin of every collected folder under `root`, whatever the folder is called. */
export function loadLocalListings(root: string): KnownListing[] {
  const out: KnownListing[] = [];
  if (!existsSync(root)) return out;
  for (const d of readdirSync(root)) {
    const file = join(root, d, 'listing.json');
    if (!existsSync(file)) continue;
    try {
      const facts = JSON.parse(readFileSync(file, 'utf8'));
      out.push({ ref: join(root, d), name: facts.name ?? d, point: facts.location?.point });
    } catch {
      /* a broken listing.json is the summary's problem, not the guard's */
    }
  }
  return out;
}

export const describeDuplicate = (d: NonNullable<DuplicateCheck>) =>
  d.kind === 'duplicate'
    ? `DUPLICATE of "${d.of.name}" (${d.of.ref}), ${d.metres} m away`
    : `possibly the same as "${d.of.name}" (${d.of.ref}), ${d.metres} m away — check`;

/* ───────────────────────── published-keys file ──────────────────────────── */

/**
 * One file remembers every business already published (or found to be a
 * duplicate), by its key — so a published folder can be deleted and the café
 * still never comes back. The live database is checked too; this file is the
 * offline record and Sagar's own list of what went up.
 */
export const KEYS_FILE = join(SHARED_DIR, 'published-keys.json');

/**
 * Who the outreach sender has messaged, keyed by listing id — written by
 * outreach-sender.ts, read back into the sheet's Sent? column by export-contacts.ts.
 */
export const OUTREACH_LOG = join(SHARED_DIR, 'outreach-sent.json');
export interface OutreachMark {
  status: 'sent' | 'skipped';
  at: string;
  number: string;
}
export function readOutreachLog(path = OUTREACH_LOG): Record<string, OutreachMark> {
  return existsSync(path) ? JSON.parse(readFileSync(path, 'utf8')) : {};
}
export function writeOutreachLog(log: Record<string, OutreachMark>, path = OUTREACH_LOG): void {
  writeFileSync(`${path}.tmp`, JSON.stringify(log, null, 2));
  renameSync(`${path}.tmp`, path);
}

export interface KeyEntry {
  key: string;
  name: string;
  type: string;
  latitude: number;
  longitude: number;
  id: string;
  status: 'published' | 'duplicate';
  duplicateOf?: string;
  publishedAt: string;
}

export function readKeyFile(path = KEYS_FILE): KeyEntry[] {
  if (!existsSync(path)) return [];
  return JSON.parse(readFileSync(path, 'utf8')) as KeyEntry[];
}

export const loadKeyFile = (path = KEYS_FILE): KnownListing[] =>
  readKeyFile(path).map((e) => ({ ref: e.id, name: e.name, point: { latitude: e.latitude, longitude: e.longitude } }));

/** Append one entry. Written to a temp file then renamed, so a crash never leaves half a file. */
export function appendKey(entry: Omit<KeyEntry, 'key' | 'publishedAt'>, path = KEYS_FILE): void {
  const all = readKeyFile(path);
  all.push({ key: normName(entry.name), ...entry, publishedAt: new Date().toISOString() });
  writeFileSync(`${path}.tmp`, JSON.stringify(all, null, 2));
  renameSync(`${path}.tmp`, path);
}

/* ───────────────────────── owner accounts ───────────────────────────────── */

/**
 * Every bulk listing gets its OWN account, so the real owner can sign in
 * straight away: username = the business name squashed to a handle, password
 * OWNER_PASSWORD. The listing stays `listingActive: false` until someone signs
 * in to it (migration 0028). This file is the record of who got which handle —
 * the outreach sheet reads it (export-contacts.ts).
 */
export const OWNER_ACCOUNTS_FILE = join(SHARED_DIR, 'owner-accounts.json');
/** Kept in the gitignored scripts/.listing.env — never commit it. */
export const OWNER_PASSWORD = need('OWNER_PASSWORD');
const USERNAME_MAX = 20;

export interface OwnerAccount {
  username: string;
  userId: string;
  name: string;
  createdAt: string;
}

export function readOwnerAccounts(path = OWNER_ACCOUNTS_FILE): Record<string, OwnerAccount> {
  return existsSync(path) ? JSON.parse(readFileSync(path, 'utf8')) : {};
}
export function writeOwnerAccounts(all: Record<string, OwnerAccount>, path = OWNER_ACCOUNTS_FILE): void {
  writeFileSync(`${path}.tmp`, JSON.stringify(all, null, 2));
  renameSync(`${path}.tmp`, path);
}

/**
 * The n-th handle to try for a business name (n = 1 is the plain one):
 * "Amigos Café & Restaurant" → "amigoscafeandrestaur", then "amigoscafeandresta2"…
 * Follows assertUsername (src/data/repositories.ts): 3–20 chars, a-z0-9,
 * starting with a LETTER — a leading digit could collide with phone logins.
 */
/**
 * A business name as it should appear in the app: styled Unicode letters made
 * plain (NFKC), wrapping quotes and decorations (।। ® ™ * ~) stripped from
 * the ends, spaces collapsed. `“Kids Therapy Center”` → `Kids Therapy Center`.
 */
export function cleanName(name: string): string {
  return name
    .normalize('NFKC')
    // Double quotes go wherever they are ("ManahMaitrii" Psychiatry Clinic); apostrophes stay (Kapoor’s).
    .replace(/[®™©"“”„]/g, '')
    // Emoji people decorate Google names with ("✅Sun Path Lab", "AGRAWAL MEDICAL STORE 🏪").
    .replace(/\p{Extended_Pictographic}|[\u{1F1E6}-\u{1F1FF}️‍⃣]/gu, ' ')
    .replace(/^[\s"'“”‘’`.,;:|*~_\-–—।॥!]+|[\s"'“”‘’`,;:|*~_\-–—।॥!]+$/gu, '')
    .replace(/\s+/g, ' ')
    .trim();
}

/** Does it read as a name at all? At least two letters (any script) — "." and "-" don't. */
export const isRealName = (name: string) => (cleanName(name).match(/\p{L}/gu) ?? []).length >= 2;

/* Devanagari → Latin, enough for a readable username ("वस्त्रम्" → "vastram"). */
const DEV_CONSONANTS: Record<string, string> = {
  क: 'k', ख: 'kh', ग: 'g', घ: 'gh', ङ: 'n', च: 'ch', छ: 'chh', ज: 'j', झ: 'jh', ञ: 'n', ट: 't', ठ: 'th', ड: 'd', ढ: 'dh', ण: 'n',
  त: 't', थ: 'th', द: 'd', ध: 'dh', न: 'n', प: 'p', फ: 'ph', ब: 'b', भ: 'bh', म: 'm', य: 'y', र: 'r', ल: 'l', व: 'v', श: 'sh',
  ष: 'sh', स: 's', ह: 'h', ळ: 'l', क़: 'q', ख़: 'kh', ग़: 'g', ज़: 'z', ड़: 'd', ढ़: 'rh', फ़: 'f',
};
const DEV_VOWELS: Record<string, string> = { अ: 'a', आ: 'aa', इ: 'i', ई: 'ee', उ: 'u', ऊ: 'oo', ऋ: 'ri', ए: 'e', ऐ: 'ai', ओ: 'o', औ: 'au' };
const DEV_SIGNS: Record<string, string> = { 'ा': 'a', 'ि': 'i', 'ी': 'ee', 'ु': 'u', 'ू': 'oo', 'ृ': 'ri', 'े': 'e', 'ै': 'ai', 'ो': 'o', 'ौ': 'au', 'ं': 'n', 'ँ': 'n', 'ः': 'h' };
export function romanize(text: string): string {
  const chars = [...text.normalize('NFC')];
  let out = '';
  for (let i = 0; i < chars.length; i++) {
    const c = chars[i];
    const next = chars[i + 1];
    if (DEV_CONSONANTS[c]) {
      out += DEV_CONSONANTS[c];
      // A consonant carries an "a" unless a vowel sign or virama follows — or it ends the word.
      const ends = !next || !/[ऀ-ॿ]/.test(next);
      // (ं ँ ः follow the "a": कंचन → kanchan.)
      const sign = DEV_SIGNS[next] && !'ंँः'.includes(next);
      if (next !== '्' && !sign && !ends) out += 'a';
    } else if (DEV_VOWELS[c]) out += DEV_VOWELS[c];
    else if (DEV_SIGNS[c]) out += DEV_SIGNS[c];
    else if (c !== '्' && c !== '़') out += c;
  }
  return out;
}

export function ownerHandle(name: string, n = 1): string {
  let base = normName(romanize(name)) || 'business';
  if (/^[0-9]/.test(base)) base = `the${base}`;
  if (base.length < 3) base = `${base}shop`;
  const suffix = n > 1 ? String(n) : '';
  return base.slice(0, USERNAME_MAX - suffix.length) + suffix;
}

const isRateLimit = (msg: string) => /rate limit|too many|429/i.test(msg);
const isTaken = (msg: string) => /already (been )?registered|already exists/i.test(msg);

/**
 * Creates the owner account for one business and returns it. Sign-UP only:
 * a handle that is already registered is skipped for the next suffix — this
 * never signs in with the shared password to an account that already exists.
 * `taken` is the handles already used this run (updated in place).
 */
export async function createOwnerAccount(
  name: string,
  taken: Set<string>,
): Promise<{ username: string; userId: string }> {
  for (let n = 1, attempt = 0; n < 100; ) {
    const username = ownerHandle(name, n);
    if (taken.has(username)) {
      n++;
      continue;
    }
    const sb = anonClient();
    const up = await sb.auth.signUp({
      email: `${username}@localo.app`,
      password: OWNER_PASSWORD,
      options: { data: { name, username } },
    });
    if (up.error) {
      if (isRateLimit(up.error.message)) {
        const s = Math.min(60 * ++attempt, 300);
        console.log(`  rate limited — waiting ${s}s`);
        await sleep(s * 1000);
        continue;
      }
      if (isTaken(up.error.message)) {
        taken.add(username);
        n++;
        continue;
      }
      throw new Error(`sign-up ${username}: ${up.error.message}`);
    }
    // With a confirmed email already on file Supabase may answer with a user
    // that has no identities instead of an error — that's "taken" too.
    if (!up.data.user || (up.data.user.identities ?? []).length === 0) {
      taken.add(username);
      n++;
      continue;
    }
    taken.add(username);
    return { username, userId: up.data.user.id };
  }
  throw new Error(`No free username for "${name}".`);
}

/**
 * Hands a listing to its new owner account, as the super-admin (RLS 0004 +
 * the ownership lock in 0008 allow it only for them). Same two-field write as
 * `reassignOwner` in src/data/supabase/businesses.ts, and the listing stays
 * inactive until the owner signs in.
 */
export async function transferListing(admin: SupabaseClient, businessId: string, userId: string): Promise<void> {
  const { data: row, error } = await admin.from('businesses').select('data').eq('id', businessId).maybeSingle();
  if (error) throw error;
  if (!row) throw new Error(`Business ${businessId} not found`);
  const data = { ...(row.data as Record<string, unknown>), ownerId: userId, listingActive: false };
  const { error: uErr } = await admin.from('businesses').update({ owner_id: userId, data }).eq('id', businessId);
  if (uErr) throw uErr;
}

/** Signs in as the listing super-admin (LISTING_LOGIN / LISTING_PASSWORD) and returns its user id.
 * Mirrors src/data/supabase/auth.ts: `<login>@localo.app`, then the phone lookup RPC. */
export async function signIn(sb: SupabaseClient): Promise<string> {
  const login = need('LISTING_LOGIN').trim().toLowerCase();
  const password = need('LISTING_PASSWORD');
  let res = await sb.auth.signInWithPassword({ email: `${login}@localo.app`, password });
  if (res.error && /^\d+$/.test(login)) {
    const { data: email } = await sb.rpc('resolve_login_email', { p_phone: login, p_password: password });
    if (typeof email === 'string' && email) res = await sb.auth.signInWithPassword({ email, password });
  }
  if (res.error || !res.data.user) throw new Error(`Sign-in failed: ${res.error?.message ?? 'no user'}`);
  return res.data.user.id;
}

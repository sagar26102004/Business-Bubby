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
export const normName = (name: string) =>
  name
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
export const KEYS_FILE = 'E:/listing/published-keys.json';

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

/// <reference types="node" />
/**
 * The one record shape every collector bot writes (LISTING-PLAN.md, "Many
 * bots → merge → publish"). A bot only COLLECTS: it appends one RawRecord per
 * place to `E:\listing\<bot>\records.jsonl` and never touches the app.
 * `scripts/merge-listings.ts` later reads every bot's file, finds the same
 * business across sources and merges them field by field.
 *
 * Fill whatever the site gives — the app doesn't use every field yet, but the
 * merge keeps all of it (Sagar, 13 Oct 2026: "try to get as much information
 * as possible, we might need them").
 */
import { appendFileSync, existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { LISTING_ROOT, sleep } from '../listing-lib';

export type DayKey = 'mon' | 'tue' | 'wed' | 'thu' | 'fri' | 'sat' | 'sun';
export const DAY_KEYS: DayKey[] = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'];

export interface RawRecord {
  /** The bot that wrote it — also its folder name under E:\listing. */
  source: string;
  /** The site's own id for the place (Google place id, OSM node/123, …): unique within a source. */
  sourceId: string;
  sourceUrl?: string;
  collectedAt: string;
  /** What the bot was doing when it found the place ("hardware store in Vijay Nagar Indore"). */
  foundBy?: string;

  name: string;
  /** Other spellings: a Hindi name, an "also known as"… */
  altNames?: string[];
  /** The site's own category words, kept raw ("Hardware store", "shop=hardware"). */
  categories: string[];
  description?: string;

  /** Indian numbers as +91XXXXXXXXXX (normPhone); anything else kept as written. */
  phones?: string[];
  whatsapp?: string;
  emails?: string[];
  website?: string;
  socials?: Partial<Record<'instagram' | 'facebook' | 'youtube' | 'twitter' | 'linkedin', string>>;

  /** The full address as the site printed it. */
  address?: string;
  addressLine?: string;
  locality?: string;
  city?: string;
  region?: string;
  pinCode?: string;
  point?: { latitude: number; longitude: number };
  plusCode?: string;

  /** Only when all 7 days are known, in the publisher's format ("09:00-21:00", "closed", two shifts comma-separated). */
  hours?: Record<DayKey, string>;
  /** Whatever the site said about hours, when it couldn't be turned into `hours`. */
  hoursRaw?: string;

  rating?: number;
  reviewCount?: number;
  priceLevel?: string;
  /** The site says the owner has claimed / verified the listing. */
  claimed?: boolean;
  verified?: boolean;
  yearEstablished?: number;
  ownerName?: string;
  gstin?: string;

  services?: string[];
  products?: string[];
  amenities?: string[];
  paymentMethods?: string[];
  /** Remote photo URLs (largest size the site offers). Downloaded only at publish time. */
  photos?: string[];
  /** Anything else the site gave, verbatim. */
  extra?: Record<string, unknown>;
}

export const botDir = (bot: string, root = LISTING_ROOT) => join(root, bot);
export const recordsFile = (bot: string, root = LISTING_ROOT) => join(botDir(bot, root), 'records.jsonl');

/** Every record a bot has written so far (later lines win for the same sourceId). */
export function readRecords(bot: string, root = LISTING_ROOT): RawRecord[] {
  const file = recordsFile(bot, root);
  if (!existsSync(file)) return [];
  const byId = new Map<string, RawRecord>();
  for (const line of readFileSync(file, 'utf8').split(/\r?\n/)) {
    if (!line.trim()) continue;
    try {
      const r = JSON.parse(line) as RawRecord;
      byId.set(r.sourceId, r);
    } catch {
      // A half-written last line from a crash — skip it.
    }
  }
  return [...byId.values()];
}

/** Append records — one line each, so a crash never loses what was already written. */
export function appendRecords(bot: string, records: RawRecord[], root = LISTING_ROOT): void {
  if (!records.length) return;
  mkdirSync(botDir(bot, root), { recursive: true });
  appendFileSync(recordsFile(bot, root), records.map((r) => `${JSON.stringify(stripEmpty(r))}\n`).join(''));
}

/** Drop undefined / empty-array / empty-string fields so the file stays readable. */
export function stripEmpty<T extends object>(r: T): T {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(r)) {
    if (v === undefined || v === null || v === '') continue;
    if (Array.isArray(v) && !v.length) continue;
    if (typeof v === 'object' && !Array.isArray(v) && !Object.keys(v as object).length) continue;
    out[k] = v;
  }
  return out as T;
}

/* ───────────────────────────── bot state ───────────────────────────────── */

export function readState<T extends object>(bot: string, fallback: T, root = LISTING_ROOT): T {
  const file = join(botDir(bot, root), 'state.json');
  return existsSync(file) ? { ...fallback, ...(JSON.parse(readFileSync(file, 'utf8')) as Partial<T>) } : fallback;
}

export function writeState(bot: string, state: object, root = LISTING_ROOT): void {
  mkdirSync(botDir(bot, root), { recursive: true });
  const file = join(botDir(bot, root), 'state.json');
  writeFileSync(`${file}.tmp`, JSON.stringify(state, null, 2));
  renameSync(`${file}.tmp`, file);
}

/** `E:\listing\<bot>\STOP` (or the shared `E:\listing\STOP`) asks a bot to finish what it's doing and exit. */
export const stopRequested = (bot: string, root = LISTING_ROOT) =>
  existsSync(join(botDir(bot, root), 'STOP')) || existsSync(join(root, 'STOP'));

/** A bot's log line goes to the console and `E:\listing\<bot>\logs\<date>.log`. */
export function botLogger(bot: string, root = LISTING_ROOT): (line: string) => void {
  const dir = join(botDir(bot, root), 'logs');
  mkdirSync(dir, { recursive: true });
  const file = join(dir, `${new Date().toISOString().slice(0, 10)}.log`);
  return (line: string) => {
    console.log(line);
    appendFileSync(file, `${new Date().toISOString().slice(11, 19)} ${line}\n`);
  };
}

/* ───────────────────────────── normalising ─────────────────────────────── */

/**
 * An Indian phone number → +91XXXXXXXXXX. Mobiles and landlines with STD code
 * are both 10 digits once the 0 / 91 prefix is gone. Anything else (toll-free
 * 1800…, short codes) is returned as its digits.
 */
export function normPhone(raw: string): string | undefined {
  let d = raw.replace(/\D/g, '');
  if (!d) return undefined;
  if (d.length === 12 && d.startsWith('91')) d = d.slice(2);
  else if (d.length === 11 && d.startsWith('0')) d = d.slice(1);
  else if (d.length === 13 && d.startsWith('091')) d = d.slice(3);
  if (d.length === 10 && !d.startsWith('1800')) return `+91${d}`;
  return d.length >= 6 ? d : undefined;
}

/** A website as its bare host ("https://www.Foo.com/x" → "foo.com") — the merge key. */
export function normHost(url: string | undefined): string | undefined {
  if (!url) return undefined;
  try {
    const u = new URL(/^https?:\/\//i.test(url) ? url : `https://${url}`);
    return u.hostname.toLowerCase().replace(/^www\./, '') || undefined;
  } catch {
    return undefined;
  }
}

/** Social sites that are a page of the business, not the business's own website. */
export function socialKind(url: string): keyof NonNullable<RawRecord['socials']> | undefined {
  const host = normHost(url) ?? '';
  if (/(^|\.)instagram\.com$/.test(host)) return 'instagram';
  if (/(^|\.)(facebook|fb)\.com$/.test(host)) return 'facebook';
  if (/(^|\.)(youtube\.com|youtu\.be)$/.test(host)) return 'youtube';
  if (/(^|\.)(twitter|x)\.com$/.test(host)) return 'twitter';
  if (/(^|\.)linkedin\.com$/.test(host)) return 'linkedin';
  return undefined;
}

/** "Indore, Madhya Pradesh 452010" → its pieces. */
export function splitCityLine(line: string): { city?: string; region?: string; pinCode?: string } {
  const pinCode = /\b(\d{6})\b/.exec(line)?.[1];
  const [city, region] = line.replace(/\b\d{6}\b/, '').split(',').map((s) => s.trim()).filter(Boolean);
  return { city, region, pinCode };
}

/** "09:00" from hours and minutes. */
export const hhmm = (h: number, m = 0) => `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;

/* ───────────────────────────── internet ────────────────────────────────── */

/** Is the internet up? (Google's own tiny "no content" page answers in milliseconds.) */
export async function online(): Promise<boolean> {
  try {
    const r = await fetch('https://www.google.com/generate_204', { signal: AbortSignal.timeout(8000) });
    return r.status === 204 || r.ok;
  } catch {
    return false;
  }
}

/**
 * If the internet is down, wait for it — checking every minute, for up to
 * `maxHours` — instead of letting a bot read "no answer" as a block. On 13 Oct
 * a 4-hour outage ended the Google bot and the final merge. Returns false only
 * if it never came back.
 */
export async function waitForInternet(log: (l: string) => void, maxHours = 12): Promise<boolean> {
  if (await online()) return true;
  log('internet is down — waiting for it to come back (checking every minute)…');
  const t0 = Date.now();
  while (Date.now() - t0 < maxHours * 3_600_000) {
    await sleep(60_000);
    if (await online()) {
      log(`internet is back after ${Math.round((Date.now() - t0) / 60_000)} min — carrying on`);
      return true;
    }
  }
  log(`internet still down after ${maxHours} h — giving up`);
  return false;
}

/* ───────────────────────────── plain requests ──────────────────────────── */

/** The installed Edge's kind of user agent — for sites that serve their pages ready-made (magicpin, Practo). */
export const BROWSER_UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36 Edg/141.0.0.0';

/** One page's HTML; throws BLOCKED on a block/captcha answer. A network hiccup is retried once. */
export async function fetchHtml(url: string): Promise<string> {
  for (let attempt = 1; ; attempt++) {
    try {
      const res = await fetch(url, { headers: { 'user-agent': BROWSER_UA, accept: 'text/html', 'accept-language': 'en-US,en;q=0.9' } });
      if ([403, 429, 503].includes(res.status)) throw new Error('BLOCKED');
      const html = await res.text();
      const title = /<title>([^<]*)/i.exec(html)?.[1]?.toLowerCase() ?? '';
      if (/access denied|attention required|captcha|just a moment/.test(title)) throw new Error('BLOCKED');
      return html;
    } catch (e) {
      if (e instanceof Error && e.message === 'BLOCKED') throw e;
      // No internet isn't the site's fault: wait for it, then ask again.
      if (!(await online())) {
        if (!(await waitForInternet(console.log))) throw e;
        attempt = 0;
        continue;
      }
      if (attempt >= 2) throw e;
      await sleep(10_000);
    }
  }
}

/** Every schema.org JSON-LD block on a page, parsed (bad ones skipped). */
export function jsonLd(html: string): any[] {
  const out: any[] = [];
  for (const m of html.matchAll(/<script[^>]*type="application\/ld\+json"[^>]*>([\s\S]*?)<\/script>/g)) {
    try {
      out.push(JSON.parse(m[1]));
    } catch {
      // a broken block — skip it
    }
  }
  return out;
}

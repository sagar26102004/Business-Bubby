/// <reference types="node" />
/**
 * GOOGLE MAPS COLLECTOR — the main source for every non-food Indore business.
 *
 *   npx tsx scripts/collect/google-maps.ts                       every default group (plan.json)
 *   npx tsx scripts/collect/google-maps.ts --group health        one group
 *   npx tsx scripts/collect/google-maps.ts --categories "gym,salon" [--no-tiles]
 *   npx tsx scripts/collect/google-maps.ts --max-searches 5 --headful   a quick look
 *   npx tsx scripts/collect/google-maps.ts --fill-photos [--max 50]   find a photo for merged businesses that have none
 *
 * Writes E:\listing\google-maps\records.jsonl (RawRecord, scripts/collect/record.ts)
 * and never publishes — scripts/merge-listings.ts takes it from there.
 *
 * WHY IT'S FAST: maps-bot opened every place (one click, ~10 s each). This
 * bot never opens a place. A Maps search fetches its results 20 at a time as
 * the list scrolls (`/search?tbm=map`), and each result in that data already
 * carries everything the place page shows: phone, the full week's hours,
 * website, every category, the full address, pin, place id, rating, photos,
 * whether the owner has claimed it. So one search ≈ 100 places in ~20 s.
 *
 * COVERAGE: Google stops a search at ~100–120 results. Every category is
 * first searched city-wide ("hardware store in Indore"); one that hits the
 * cap is "dense" and is searched again over a grid of map tiles covering the
 * bbox in plan.json, so a city with 2,000 kirana stores gets them all. Places
 * are deduplicated by Google place id across every search, and finished
 * searches are remembered in state.json, so a re-run continues where it ended.
 *
 * SAFETY: one tab, 4–10 s between searches, stop at the first consent/captcha
 * page, stop after 3 searches in a row that load nothing (Google's quiet
 * throttle). E:\listing\google-maps\STOP ends it after the current search.
 */
import { chromium, type Page, type Response } from 'playwright-core';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { haversineKm } from '@/lib/geo';
import { DUP_RADIUS_KM, LISTING_ROOT, sleep } from '../listing-lib';
import { blocked, sized } from '../maps-bot';
import {
  DAY_KEYS,
  appendRecords,
  botLogger,
  hhmm,
  normPhone,
  readRecords,
  readState,
  socialKind,
  splitCityLine,
  online,
  stopRequested,
  waitForInternet,
  writeState,
  type DayKey,
  type RawRecord,
} from './record';

const BOT = 'google-maps';
const EDGE = 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe';
/** A search that returns at least this many places is assumed to be cut off by Google. */
const DENSE_AT = 95;
const MAX_EMPTY_IN_A_ROW = 3;
/** Edge grows with every search; a fresh one every this many keeps a long run inside a small laptop's memory. */
const RECYCLE_EVERY = 40;

/** One Edge + one tab, replaceable: `next()` closes the old browser and opens a fresh one. */
async function browserSession(headful?: boolean) {
  const open = async () => {
    const browser = await chromium.launch({ executablePath: EDGE, headless: !headful });
    const page = await browser.newPage({ viewport: { width: 1280, height: 900 }, locale: 'en-US' });
    return { browser, page };
  };
  let cur = await open();
  return {
    get page() {
      return cur.page;
    },
    async next() {
      await cur.browser.close().catch(() => {});
      cur = await open();
    },
    close: () => cur.browser.close().catch(() => {}),
  };
}
const DAY_NAMES: Record<string, DayKey> = {
  monday: 'mon', tuesday: 'tue', wednesday: 'wed', thursday: 'thu', friday: 'fri', saturday: 'sat', sunday: 'sun',
};

interface Plan {
  city: string;
  bbox: { south: number; north: number; west: number; east: number };
  tileStep: number;
  tileZoom: number;
  googleCategories: Record<string, string[]>;
  defaultGroups: string[];
}

interface State {
  /** Search keys already finished ("hardware store|city", "hardware store|22.650,75.790"). */
  done: string[];
  /** Categories whose city-wide search hit the cap — searched tile by tile. */
  dense: string[];
}

function arg(name: string, fallback?: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : fallback;
}
const flag = (name: string) => process.argv.includes(`--${name}`);

/* ───────────────────────────── parsing ──────────────────────────────────── */

/** Safe deep index: at(e, 4, 7) = e?.[4]?.[7]. */
function at(o: unknown, ...path: number[]): any {
  let cur: any = o;
  for (const i of path) {
    if (!Array.isArray(cur)) return undefined;
    cur = cur[i];
  }
  return cur;
}

/** A `/search?tbm=map` body → the place arrays in it. */
export function placesIn(body: string): any[] {
  let data: any;
  try {
    // Page 1 is `)]}'` + JSON; later pages are {"c":0,"d":")]}'…"} + a trailing /*""*/.
    data = JSON.parse(body.replace(/^\)\]\}'\s*/, '').replace(/\/\*""\*\/\s*$/, ''));
    if (data && !Array.isArray(data) && typeof data.d === 'string') data = JSON.parse(data.d.replace(/^\)\]\}'\s*/, ''));
  } catch {
    return [];
  }
  // The results list sits at a fixed index today (64); find it by shape so a
  // shift in Google's layout doesn't silently return nothing.
  const looksLikePlace = (e: any) => Array.isArray(e) && typeof e[11] === 'string' && typeof at(e, 9, 2) === 'number';
  const candidates = Array.isArray(data) ? [data[64], ...data] : [];
  for (const list of candidates) {
    if (!Array.isArray(list)) continue;
    const places = list.map((r: any) => at(r, 1)).filter(looksLikePlace);
    if (places.length) return places;
  }
  return [];
}

/** One day of Google's hours: [["10 am–8:30 pm", [[10], [20, 30]]], …] or [["Closed"]]. */
function dayHours(shifts: any[]): string | undefined {
  if (!Array.isArray(shifts) || !shifts.length) return undefined;
  const out: string[] = [];
  for (const s of shifts) {
    const label = String(s?.[0] ?? '');
    if (/^closed$/i.test(label)) return 'closed';
    if (/24 hours/i.test(label)) return '00:00-23:59';
    const [open, close] = [at(s, 1, 0), at(s, 1, 1)];
    if (!Array.isArray(open) || !Array.isArray(close)) return undefined;
    const ch = Number(close[0] ?? 0);
    out.push(`${hhmm(Number(open[0] ?? 0), Number(open[1] ?? 0))}-${ch >= 24 ? '23:59' : hhmm(ch, Number(close[1] ?? 0))}`);
  }
  return out.join(', ');
}

/** Google's place array → a RawRecord. Index meanings were read off live data (Oct 2026). */
export function toRecord(e: any, foundBy: string): RawRecord | null {
  const placeId: string | undefined = e[78] ?? at(e, 227, 0, 4);
  const name: string = String(e[11] ?? '').trim();
  if (!placeId || !name) return null;

  const hours: Partial<Record<DayKey, string>> = {};
  let hoursRaw: string[] = [];
  for (const d of at(e, 203, 0) ?? []) {
    const key = DAY_NAMES[String(d?.[0] ?? '').toLowerCase()];
    const parsed = dayHours(d?.[3]);
    hoursRaw.push(`${d?.[0]}: ${(d?.[3] ?? []).map((s: any) => s?.[0]).join(', ')}`);
    if (key && parsed) hours[key] = parsed;
  }
  const fullWeek = DAY_KEYS.every((k) => hours[k]);

  const phones = [
    ...new Set(
      ((e[178] ?? []) as any[])
        .map((p) => normPhone(String(p?.[3] ?? p?.[0] ?? '')))
        .filter((p): p is string => !!p),
    ),
  ];

  const addressParts: string[] = Array.isArray(e[2]) ? e[2].filter((x: unknown) => typeof x === 'string') : [];
  const cityLine = addressParts.length ? addressParts[addressParts.length - 1] : '';
  const { city, region, pinCode } = splitCityLine(cityLine);
  const website: string | undefined = at(e, 7, 0);
  const social = website ? socialKind(website) : undefined;

  const photos = [
    ...new Set(
      ((at(e, 37, 0) ?? []) as any[])
        .map((p) => at(p, 6, 0))
        .filter((u): u is string => typeof u === 'string' && u.includes('googleusercontent'))
        .map((u) => sized(u, 1600)),
    ),
  ];

  // About-tab attributes: [[groupId, "Accessibility", [[id, "Wheelchair-accessible entrance", [1|0, …]], …]], …]
  const amenities: string[] = [];
  const payments: string[] = [];
  for (const group of at(e, 100, 1) ?? []) {
    for (const item of group?.[2] ?? []) {
      const label = item?.[1];
      const yes = at(item, 2, 0) === 1;
      if (typeof label !== 'string' || !yes) continue;
      (/payment|card|upi|cash|nfc|cheque/i.test(String(group?.[1])) ? payments : amenities).push(label);
    }
  }

  const description = [at(e, 32, 1, 1), at(e, 32, 0, 1)].find((x) => typeof x === 'string');
  const owner = typeof at(e, 57, 1) === 'string' ? String(at(e, 57, 1)).replace(/\s*\(Owner\)\s*$/, '') : undefined;
  const altName = typeof e[101] === 'string' && e[101] !== name ? e[101] : undefined;

  return {
    source: BOT,
    sourceId: placeId,
    sourceUrl: `https://www.google.com/maps/place/?q=place_id:${placeId}`,
    collectedAt: new Date().toISOString(),
    foundBy,
    name,
    altNames: altName ? [altName] : undefined,
    categories: Array.isArray(e[13]) ? e[13].filter((c: unknown) => typeof c === 'string') : [],
    description,
    phones,
    website: website && !social ? website : undefined,
    socials: website && social ? { [social]: website } : undefined,
    address: e[39] ?? e[18],
    addressLine: addressParts.slice(0, -1).join(', ') || undefined,
    locality: typeof e[14] === 'string' ? e[14] : undefined,
    city,
    region,
    pinCode,
    point: { latitude: Number(at(e, 9, 2)), longitude: Number(at(e, 9, 3)) },
    hours: fullWeek ? (hours as Record<DayKey, string>) : undefined,
    hoursRaw: !fullWeek && hoursRaw.length ? hoursRaw.join('; ') : undefined,
    rating: typeof at(e, 4, 7) === 'number' ? at(e, 4, 7) : undefined,
    reviewCount: typeof at(e, 4, 8) === 'number' ? at(e, 4, 8) : undefined,
    claimed: e[49] ? false : true,
    ownerName: owner,
    amenities,
    paymentMethods: payments,
    photos,
    extra: {
      cid: e[10],
      kgId: e[89],
      timezone: e[30],
    },
  };
}

/* ───────────────────────────── searching ────────────────────────────────── */

interface SearchResult {
  places: RawRecord[];
  /** The page never produced a results list — Google slow / throttling. */
  failed: boolean;
}

async function search(page: Page, url: string, foundBy: string): Promise<SearchResult> {
  const found = new Map<string, RawRecord>();
  let lastData = Date.now();
  const onResponse = async (r: Response) => {
    if (!r.url().includes('/search?tbm=map')) return;
    try {
      for (const e of placesIn(await r.text())) {
        const rec = toRecord(e, foundBy);
        if (rec) found.set(rec.sourceId, rec);
      }
      lastData = Date.now();
    } catch {
      // body gone (navigation) — ignore
    }
  };
  page.on('response', onResponse);
  try {
    await page.goto(url, { waitUntil: 'domcontentloaded' });
    if (await blocked(page)) throw new Error('BLOCKED');
    const listed = await page
      .waitForSelector('div[role=feed] a[href*="/maps/place/"], div[role=main] h1', { timeout: 30000 })
      .then(() => true)
      .catch(() => false);
    if (!listed) {
      const body = await page.locator('body').innerText().catch(() => '');
      return { places: [], failed: !/can't find|No results/i.test(body) };
    }
    // Scroll the list until Google stops sending pages (or says it's the end).
    if (await page.$('div[role=feed]')) {
      for (let i = 0; i < 60; i++) {
        if (await page.locator("text=You've reached the end of the list").count()) break;
        if (Date.now() - lastData > 6000 && i > 2) break;
        await page.$eval('div[role=feed]', (f) => f.scrollBy(0, 5000)).catch(() => {});
        await sleep(700 + Math.random() * 500);
      }
    }
    await sleep(1200); // the last page's body may still be arriving
    return { places: [...found.values()], failed: false };
  } finally {
    page.off('response', onResponse);
  }
}

function tiles(plan: Plan): { lat: number; lng: number }[] {
  const out: { lat: number; lng: number }[] = [];
  const { south, north, west, east } = plan.bbox;
  for (let lat = south + plan.tileStep / 2; lat < north; lat += plan.tileStep) {
    for (let lng = west + plan.tileStep / 2; lng < east; lng += plan.tileStep) out.push({ lat, lng });
  }
  return out;
}

/* ───────────────────────────── run ──────────────────────────────────────── */

export interface GoogleRunOptions {
  categories: string[];
  root?: string;
  headful?: boolean;
  noTiles?: boolean;
  maxSearches?: number;
  log?: (line: string) => void;
}

export interface GoogleRunResult {
  searches: number;
  newPlaces: number;
  endReason: string;
  throttled: boolean;
}

export async function runGoogleMaps(plan: Plan, opts: GoogleRunOptions): Promise<GoogleRunResult> {
  const root = opts.root ?? LISTING_ROOT;
  const log = opts.log ?? botLogger(BOT, root);
  const state = readState<State>(BOT, { done: [], dense: [] }, root);
  const done = new Set(state.done);
  const dense = new Set(state.dense);
  const seen = new Set(readRecords(BOT, root).map((r) => r.sourceId));
  const save = () => writeState(BOT, { done: [...done], dense: [...dense] }, root);
  log(`google-maps: ${opts.categories.length} categories, ${seen.size} places already collected, ${done.size} searches done before`);

  const session = await browserSession(opts.headful);
  let searches = 0;
  let newPlaces = 0;
  let empty = 0;
  let endReason = 'every search is done';
  let throttled = false;

  const run = async (key: string, url: string, label: string): Promise<number | null> => {
    if (done.has(key)) return null;
    if (opts.maxSearches && searches >= opts.maxSearches) throw new Error('MAX');
    if (stopRequested(BOT, root)) throw new Error('STOP');
    const t0 = Date.now();
    if (searches && searches % RECYCLE_EVERY === 0) await session.next();
    let res = await search(session.page, url, label).catch((e) => {
      if (e instanceof Error && e.message === 'BLOCKED') throw e;
      return { places: [], failed: true } as SearchResult;
    });
    // "Nothing loaded" with the internet down is an outage, not Google: wait, then search again.
    if (res.failed && !(await online())) {
      if (!(await waitForInternet(log))) throw new Error('OFFLINE');
      res = await search(session.page, url, label).catch(() => ({ places: [], failed: true }) as SearchResult);
    }
    searches++;
    const fresh = res.places.filter((p) => !seen.has(p.sourceId));
    appendRecords(BOT, fresh, root);
    fresh.forEach((p) => seen.add(p.sourceId));
    newPlaces += fresh.length;
    log(`[${searches}] ${label} … ${res.places.length} found, ${fresh.length} new (${((Date.now() - t0) / 1000).toFixed(0)} s)${res.failed ? ' — DID NOT LOAD' : ''}`);
    if (res.failed) {
      if (++empty >= MAX_EMPTY_IN_A_ROW) throw new Error('THROTTLED');
      return null; // not marked done: retried next run
    }
    empty = 0;
    done.add(key);
    save();
    await sleep(4000 + Math.random() * 6000);
    return res.places.length;
  };

  try {
    for (const cat of opts.categories) {
      const q = `${cat} in ${plan.city}`;
      const count = await run(`${cat}|city`, `https://www.google.com/maps/search/${encodeURIComponent(q)}?hl=en`, q);
      if (count !== null && count >= DENSE_AT) {
        dense.add(cat);
        save();
      }
      if (!dense.has(cat) || opts.noTiles) continue;
      for (const t of tiles(plan)) {
        const at3 = `${t.lat.toFixed(3)},${t.lng.toFixed(3)}`;
        await run(
          `${cat}|${at3}`,
          `https://www.google.com/maps/search/${encodeURIComponent(cat)}/@${at3},${plan.tileZoom}z?hl=en`,
          `${cat} @ ${at3}`,
        );
      }
    }
  } catch (e) {
    const m = e instanceof Error ? e.message : String(e);
    if (m === 'MAX') endReason = `stopped after --max-searches ${opts.maxSearches}`;
    else if (m === 'STOP') endReason = 'STOP file found';
    else if (m === 'OFFLINE') endReason = 'the internet stayed down';
    else if (m === 'BLOCKED' || m === 'THROTTLED') {
      throttled = true;
      endReason = m === 'BLOCKED' ? 'Google showed a consent/captcha page' : `${MAX_EMPTY_IN_A_ROW} searches in a row loaded nothing — Google is slowing us down`;
    } else throw e;
  } finally {
    save();
    await session.close();
  }
  log(`google-maps: ${searches} searches, ${newPlaces} new places (total ${seen.size}). End: ${endReason}`);
  return { searches, newPlaces, endReason, throttled };
}

export function loadPlan(file = join(process.cwd(), 'scripts', 'collect', 'plan.json')): Plan {
  return JSON.parse(readFileSync(file, 'utf8')) as Plan;
}

/** --categories wins; else --group (comma list); else the plan's default groups. */
export function pickCategories(plan: Plan, categories?: string, groups?: string): string[] {
  if (categories) return categories.split(',').map((c) => c.trim()).filter(Boolean);
  const names = groups ? groups.split(',').map((g) => g.trim()) : plan.defaultGroups;
  return names.flatMap((g) => {
    const list = plan.googleCategories[g];
    if (!list) throw new Error(`No group "${g}" in plan.json (have: ${Object.keys(plan.googleCategories).join(', ')})`);
    return list;
  });
}

/* ───────────────────────────── photo + location fill ────────────────────── */

/** Words of an area name, for "is this result in the same part of town". */
const areaWords = (s: string | undefined) =>
  new Set(
    (s ?? '')
      .toLowerCase()
      .split(/[^a-z0-9]+/)
      .filter((w) => w.length > 2 && !['indore', 'madhya', 'pradesh', 'road', 'nagar', 'colony', 'near', 'the', 'and'].includes(w)),
  );

/**
 * Every merged business held ONLY because it has no photo and/or no pin is
 * looked up on Google, and the FULL Google record is saved — so it brings the
 * photo, the real pin, phone, hours and website; the next merge joins it on
 * its own (or, for a business with no pin, the Google record is that business).
 *
 *   - has a pin, needs a photo: `/maps/search/<name>/@lat,lng,17z`. A result
 *     counts within 150 m with a matching name, or with the same phone within 1 km.
 *   - needs a location (magicpin stores on a placeholder pin): `<name> <area> Indore`
 *     city-wide. A result counts when the name matches AND either the phone
 *     matches or its address names the same area — never on the name alone.
 * Location lookups go first (fewer, and each one makes a listing possible).
 * Businesses already looked up are remembered in state.json (`photoFill`).
 */
export async function runPhotoFill(
  opts: { root?: string; headful?: boolean; max?: number; /** Stop looking up at this time (ms). */ until?: number; log?: (l: string) => void } = {},
) {
  const root = opts.root ?? LISTING_ROOT;
  const log = opts.log ?? botLogger(BOT, root);
  const { NO_PHOTO, NO_PIN, similarNames } = await import('../merge-listings');
  const mergedFile = join(root, 'merged', 'businesses.json');
  const merged = JSON.parse(readFileSync(mergedFile, 'utf8')) as {
    id: string;
    name: string;
    phones: string[];
    locality?: string;
    address?: string;
    addressLine?: string;
    point?: { latitude: number; longitude: number };
    holdReasons: string[];
  }[];
  const state = readState<State & { photoFill?: string[] }>(BOT, { done: [], dense: [], photoFill: [] }, root);
  const tried = new Set(state.photoFill ?? []);
  const save = () => writeState(BOT, { ...state, photoFill: [...tried] }, root);
  const seen = new Set(readRecords(BOT, root).map((r) => r.sourceId));
  const onlyMissing = (m: (typeof merged)[number]) => m.holdReasons.length > 0 && m.holdReasons.every((r) => r === NO_PHOTO || r === NO_PIN);
  const waiting = merged.filter((m) => onlyMissing(m) && !tried.has(m.id));
  const needPin = waiting.filter((m) => !m.point);
  const needPhoto = waiting.filter((m) => m.point);
  const targets = [...needPin, ...needPhoto];
  log(`fill: ${needPin.length} businesses need a location, ${needPhoto.length} need only a photo`);

  const session = await browserSession(opts.headful);
  let found = 0;
  let looked = 0;
  let empty = 0;
  let endReason = 'every business looked up';
  try {
    for (const m of targets) {
      if (opts.max && looked >= opts.max) {
        endReason = `stopped after ${opts.max}`;
        break;
      }
      if (opts.until && Date.now() >= opts.until) {
        endReason = 'time is up';
        break;
      }
      if (stopRequested(BOT, root)) {
        endReason = 'STOP file found';
        break;
      }
      const url = m.point
        ? `https://www.google.com/maps/search/${encodeURIComponent(m.name)}/@${m.point.latitude.toFixed(5)},${m.point.longitude.toFixed(5)},17z?hl=en`
        : `https://www.google.com/maps/search/${encodeURIComponent([m.name, m.locality, plan().city].filter(Boolean).join(' '))}?hl=en`;
      if (looked && looked % RECYCLE_EVERY === 0) await session.next();
      const lookup = () =>
        search(session.page, url, `fill: ${m.name}`).catch((e) => {
          if (e instanceof Error && e.message === 'BLOCKED') throw e;
          return { places: [], failed: true } as SearchResult;
        });
      let res = await lookup();
      if (res.failed && !(await online())) {
        if (!(await waitForInternet(log))) {
          endReason = 'the internet stayed down';
          break;
        }
        res = await lookup();
      }
      looked++;
      if (res.failed) {
        if (++empty >= MAX_EMPTY_IN_A_ROW) {
          endReason = `${MAX_EMPTY_IN_A_ROW} lookups in a row loaded nothing — Google is slowing us down`;
          break;
        }
        continue;
      }
      empty = 0;
      tried.add(m.id);
      const samePhone = (p: RawRecord) => (p.phones ?? []).some((ph) => m.phones.includes(ph));
      const match = res.places.find((p) => {
        if (!p.point) return false;
        if (m.point) {
          const d = haversineKm(p.point, m.point);
          return (d <= DUP_RADIUS_KM && similarNames(p, m)) || (d <= 1 && samePhone(p));
        }
        if (samePhone(p)) return true;
        if (!similarNames(p, m)) return false;
        const want = areaWords(m.locality ?? m.addressLine ?? m.address);
        const got = areaWords(`${p.address ?? ''} ${p.locality ?? ''}`);
        return want.size > 0 && [...want].some((w) => got.has(w));
      });
      // A location is worth saving on its own; for a photo lookup only a photo is.
      const useful = match && (!m.point || match.photos?.length);
      if (useful) {
        found++;
        if (!seen.has(match.sourceId)) {
          appendRecords(BOT, [{ ...match, foundBy: `fill: ${m.id}` }], root);
          seen.add(match.sourceId);
        }
      }
      const what = !match ? 'not found' : !m.point ? `location${match.photos?.length ? ' + photo' : ''} (${match.name})` : match.photos?.length ? `photo (${match.name})` : 'found, no photo';
      log(`[${looked}/${targets.length}] ${m.name} … ${what}`);
      if (looked % 10 === 0) save();
      await sleep(2500 + Math.random() * 3500);
    }
  } catch (e) {
    if (e instanceof Error && e.message === 'BLOCKED') endReason = 'Google showed a consent/captcha page';
    else throw e;
  } finally {
    save();
    await session.close();
  }
  log(`fill: ${looked} looked up, ${found} found (photo or location). End: ${endReason}. Run the merge again to use them.`);
  return { looked, found };
}

let cachedPlan: Plan | undefined;
const plan = () => (cachedPlan ??= loadPlan());

async function main() {
  if (flag('fill-photos')) {
    await runPhotoFill({ root: arg('root'), headful: flag('headful'), max: arg('max') ? Number(arg('max')) : undefined });
    return;
  }
  const plan = loadPlan(arg('plan'));
  const result = await runGoogleMaps(plan, {
    categories: pickCategories(plan, arg('categories'), arg('group')),
    root: arg('root'),
    headful: flag('headful'),
    noTiles: flag('no-tiles'),
    maxSearches: arg('max-searches') ? Number(arg('max-searches')) : undefined,
  });
  if (result.throttled) process.exitCode = 2;
}

if (process.argv[1] && /google-maps/.test(process.argv[1])) {
  main().catch((e) => {
    console.error(e);
    process.exit(1);
  });
}

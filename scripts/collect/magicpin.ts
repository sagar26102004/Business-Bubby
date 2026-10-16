/// <reference types="node" />
/**
 * MAGICPIN COLLECTOR — salons, spas, fashion, electronics, grocery, pharmacy,
 * fitness and hotels in Indore from magicpin.in.
 *
 *   npx tsx scripts/collect/magicpin.ts [--categories "Salon,Fitness"] [--max-stores 50] [--max-pages 3] [--no-skip]
 *
 * Writes E:\listing\magicpin\records.jsonl (RawRecord). Never publishes.
 *
 * No browser: magicpin serves its pages ready-made, so a plain request gets
 * all of it (~0.5 s a page). Two steps, both read as page DATA:
 *   1. Each category's list pages (`/india/Indore/All/<Category>/?page=N`)
 *      carry a schema.org ItemList: name, pin, area and the store page.
 *   2. Each store page carries `merchantData` in __NEXT_DATA__: phone numbers,
 *      the week's hours, full address, category, description, cover photo.
 * Food is left to Zomato. One request at a time, 3–7 s apart. A 403/429 or a
 * captcha page means a rest (15 min, 30 if refused again soon), then the same
 * page again; the run only ends when the queue is empty or at a STOP file.
 * Store pages Google Maps already has with a phone and photo are skipped
 * (`--no-skip` reads them too). Store pages found and read are remembered in
 * state.json after every page, so a re-run continues where it ended.
 */
import { createReadStream, existsSync } from 'node:fs';
import { join } from 'node:path';
import { createInterface } from 'node:readline';
import { LISTING_ROOT, normName, sleep } from '../listing-lib';
import {
  DAY_KEYS,
  appendRecords,
  botLogger,
  fetchHtml as get,
  normPhone,
  readRecords,
  readState,
  stopRequested,
  writeState,
  type DayKey,
  type RawRecord,
} from './record';

const BOT = 'magicpin';
const CITY = 'Indore';
/** magicpin's own category slugs (no food — Zomato covers it). */
const CATEGORIES = ['Salon', 'Spa', 'Beauty', 'Fashion', 'Electronics', 'Fitness', 'Grocery', 'Pharmacy', 'Hotel'];
const MAX_PAGES = 400;
const DAY: Record<string, DayKey> = { MONDAY: 'mon', TUESDAY: 'tue', WEDNESDAY: 'wed', THURSDAY: 'thu', FRIDAY: 'fri', SATURDAY: 'sat', SUNDAY: 'sun' };

interface State {
  /** Store pages already read (or found dead). */
  done: string[];
  /** Store pages found on list pages, not yet read. */
  queue: string[];
  /** Categories whose list pages are fully walked. */
  listed: string[];
  /** Store pages not read because Google Maps already has them (see coveredByGoogle). */
  skipped?: string[];
}

function arg(name: string, fallback?: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : fallback;
}
/**
 * 3–7 s between pages, and a 2-minute break every 100. At 1.5–4 s magicpin
 * refused us after ~1,150 store pages (13 Oct 2026).
 */
let pages = 0;
const pause = async () => {
  await sleep(3000 + Math.random() * 4000);
  if (++pages % 100 === 0) await sleep(120_000);
};
/**
 * After a refusal: rest, then try again — for as long as it takes (15 Oct 2026:
 * stopping after three refusals lost whole nights). The rest starts at 15 min;
 * refused again within a few pages of coming back → 30 min; a good stretch
 * resets it to 15.
 */
const SHORT_REST_MS = 15 * 60_000;
const LONG_REST_MS = 30 * 60_000;
/** Fewer pages than this between two refusals = the short rest wasn't enough. */
const QUICK_REFUSAL_PAGES = 20;

/**
 * Store pages Google Maps already covers well are skipped (Sagar, 15 Oct 2026):
 * the URL's name + area match a Google record that has a phone AND a photo.
 * They're kept in state.skipped, so a later `--no-skip` run can still read them.
 */
interface GoogleHit {
  addr: string;
}
const slugText = (s: string) => decodeURIComponent(s).replace(/[-_]+/g, ' ');
const squash = (s: string) => normName(s);

async function googleIndex(root: string): Promise<Map<string, GoogleHit[]>> {
  const idx = new Map<string, GoogleHit[]>();
  const file = join(root, 'google-maps', 'records.jsonl');
  if (!existsSync(file)) return idx;
  for await (const line of createInterface({ input: createReadStream(file) })) {
    if (!line.trim()) continue;
    let r: RawRecord;
    try {
      r = JSON.parse(line);
    } catch {
      continue;
    }
    if (!r.phones?.length || !r.photos?.length) continue;
    const k = squash(r.name ?? '');
    if (!k) continue;
    const a = idx.get(k) ?? [];
    a.push({ addr: squash(`${r.address ?? ''} ${r.locality ?? ''}`) });
    idx.set(k, a);
  }
  return idx;
}

/** /Indore/<Area>/<Category>/<Name>/store/<id> → covered by Google? */
function coveredByGoogle(url: string, idx: Map<string, GoogleHit[]>): boolean {
  const m = /magicpin\.in\/[^/]+\/([^/]+)\/[^/]+\/([^/]+)\/store\//.exec(url);
  if (!m) return false;
  const hits = idx.get(squash(slugText(m[2])));
  if (!hits) return false;
  const area = squash(slugText(m[1]));
  return hits.some((h) => !area || h.addr.includes(area));
}

/** One list page → the store URLs on it. */
async function listPage(url: string): Promise<string[]> {
  const html = await get(url);
  const lds = [...html.matchAll(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/g)].map((m) => m[1]);
  const out: string[] = [];
  for (const raw of lds) {
    try {
      const j = JSON.parse(raw);
      for (const el of j.itemListElement ?? []) {
        const id = el?.item?.identifier;
        if (typeof id === 'string' && id.includes('/store/')) out.push(id.replace(/\/+$/, ''));
      }
    } catch {
      // not the ItemList
    }
  }
  return out;
}

/** "22:00:00" → "22:00". */
const hm = (t: string) => t.slice(0, 5);

export function toRecord(m: any, url: string): RawRecord | null {
  if (!m?.name || m.lat === undefined) return null;
  // magicpin files some out-of-state stores under Indore ("…, Raipur, Chhattisgarh 492006, Nagda, Indore").
  const addr = String(m.address?.address ?? '');
  if (/\b(chhattisgarh|maharashtra|gujarat|rajasthan|uttar pradesh|delhi|karnataka|telangana|bihar|haryana|punjab|west bengal|tamil nadu|kerala|odisha|jharkhand)\b/i.test(addr)) return null;
  const hours: Partial<Record<DayKey, string>> = {};
  for (const d of m.timings ?? []) {
    const key = DAY[String(d?.day ?? '').toUpperCase()];
    if (!key) continue;
    const slots = (d.time_slots ?? []).filter((s: any) => s?.opentime && s?.closetime);
    hours[key] = slots.length ? slots.map((s: any) => `${hm(s.opentime)}-${hm(s.closetime) === '00:00' ? '23:59' : hm(s.closetime)}`).join(', ') : 'closed';
  }
  const full = DAY_KEYS.every((k) => hours[k]);
  const subs = (m.subCategories?.categories ?? []).filter((c: unknown) => typeof c === 'string' && c.trim());
  return {
    source: BOT,
    sourceId: String(m.merchantId ?? m.mid ?? url),
    sourceUrl: url,
    collectedAt: new Date().toISOString(),
    name: String(m.name).trim(),
    categories: [m.category, ...(m.establishmentType?.name ? [m.establishmentType.name] : []), ...subs].filter(Boolean),
    description: m.description || undefined,
    phones: [...new Set(((m.phoneNumbers ?? []) as string[]).map(normPhone).filter((p): p is string => !!p))],
    address: m.address?.address,
    locality: m.locality ?? m.address?.locality,
    city: m.city ?? CITY,
    point: { latitude: Number(m.lat), longitude: Number(m.lon) },
    plusCode: /^[23456789CFGHJMPQRVWX]{4}\+[23456789CFGHJMPQRVWX]{2,3}/i.exec(m.address?.address ?? '')?.[0],
    hours: full ? (hours as Record<DayKey, string>) : undefined,
    rating: m.rating || undefined,
    reviewCount: m.totalRatingCount || undefined,
    services: subs.length ? subs : undefined,
    amenities: (m.highlights ?? []).filter((h: unknown) => typeof h === 'string'),
    photos: [m.coverPic].filter((p): p is string => typeof p === 'string' && /^https?:/.test(p)),
    extra: {
      mid: m.mid,
      costForTwo: m.costForTwo || undefined,
      isChain: m.isChain || undefined,
      closed: m.isMerchantClosed || undefined,
      companyName: m.companyName || undefined,
    },
  };
}

async function storePage(url: string): Promise<RawRecord | null> {
  const html = await get(url);
  const raw = /<script id="__NEXT_DATA__"[^>]*>([\s\S]*?)<\/script>/.exec(html)?.[1];
  if (!raw) return null;
  const m = JSON.parse(raw)?.props?.pageProps?.merchantData;
  if (!m || m.isMerchantClosed || m.redirectToHomepage) return null;
  return toRecord(m, url);
}

export async function runMagicpin(
  opts: { categories?: string[]; maxStores?: number; maxPages?: number; root?: string; noSkip?: boolean } = {},
) {
  const root = opts.root ?? LISTING_ROOT;
  const log = botLogger(BOT, root);
  const state = readState<State>(BOT, { done: [], queue: [], listed: [], skipped: [] }, root);
  const done = new Set(state.done);
  const queue = new Set(state.queue);
  const listed = new Set(state.listed);
  const skipped = new Set(state.skipped ?? []);
  const save = () => writeState(BOT, { done: [...done], queue: [...queue], listed: [...listed], skipped: [...skipped] }, root);
  const seen = new Set(readRecords(BOT, root).map((r) => r.sourceId));
  let stores = 0;
  let endReason = 'every list and store page is done';
  try {
    // 1. List pages → the queue of store pages.
    for (const cat of opts.categories ?? CATEGORIES) {
      if (listed.has(cat)) continue;
      let added = 0;
      for (let p = 1; p <= (opts.maxPages ?? MAX_PAGES); p++) {
        if (stopRequested(BOT, root)) throw new Error('STOP');
        const urls = await listPage(`https://magicpin.in/india/${CITY}/All/${cat}/${p > 1 ? `?page=${p}` : ''}`);
        const fresh = urls.filter((u) => !done.has(u) && !queue.has(u));
        fresh.forEach((u) => queue.add(u));
        added += fresh.length;
        save();
        log(`${cat} page ${p}: ${urls.length} stores, ${fresh.length} new`);
        if (!urls.length || (!fresh.length && p > 2)) break;
        await pause();
      }
      listed.add(cat);
      save();
      log(`${cat}: ${added} store pages queued`);
    }
    // 2. Store pages → records. Skip what Google already has with phone + photo.
    if (!opts.noSkip) {
      const idx = await googleIndex(root);
      let n = 0;
      for (const url of [...queue]) {
        if (coveredByGoogle(url, idx)) {
          queue.delete(url);
          skipped.add(url);
          n++;
        }
      }
      save();
      log(`skipped ${n} store pages Google Maps already has (phone + photo) — ${queue.size} left to read`);
    } else {
      // Read the skipped ones too.
      for (const url of skipped) queue.add(url);
      skipped.clear();
    }
    let blocks = 0;
    let pagesAtLastBlock = -Infinity;
    // A refused page goes to the back of `work` and is read again after the rest.
    const work = [...queue];
    for (let w = 0; w < work.length; w++) {
      const url = work[w];
      if (opts.maxStores && stores >= opts.maxStores) {
        endReason = `stopped after --max-stores ${opts.maxStores}`;
        break;
      }
      if (stopRequested(BOT, root)) throw new Error('STOP');
      let rec: RawRecord | null;
      try {
        rec = await storePage(url);
      } catch (e) {
        if (!(e instanceof Error && e.message === 'BLOCKED')) {
          log(`  failed ${url}: ${e instanceof Error ? e.message.split('\n')[0] : e}`);
          rec = null;
        } else {
          // Refused: rest, then carry on with this same store page.
          blocks++;
          const rest = stores - pagesAtLastBlock < QUICK_REFUSAL_PAGES ? LONG_REST_MS : SHORT_REST_MS;
          pagesAtLastBlock = stores;
          save();
          log(`magicpin refused us (#${blocks}) after ${stores} pages this run — resting ${rest / 60_000} min`);
          for (let t = 0; t < rest && !stopRequested(BOT, root); t += 60_000) await sleep(60_000);
          if (stopRequested(BOT, root)) throw new Error('STOP');
          work.push(url);
          continue;
        }
      }
      stores++;
      queue.delete(url);
      done.add(url);
      if (rec && !seen.has(rec.sourceId)) {
        appendRecords(BOT, [rec], root);
        seen.add(rec.sourceId);
        log(`[${stores}] ${rec.name} · ${rec.categories[0] ?? ''} · ${rec.phones?.length ? 'phone' : 'no phone'} · ${rec.hours ? 'hours' : 'no hours'}`);
      }
      if (stores % 10 === 0) save();
      await pause();
    }
  } catch (e) {
    const m = e instanceof Error ? e.message : String(e);
    if (m === 'STOP') endReason = 'STOP file found';
    else if (m === 'BLOCKED') endReason = 'magicpin showed a block/captcha page — try again later';
    else throw e;
  } finally {
    save();
  }
  log(`magicpin: ${stores} store pages read, ${queue.size} still queued, ${seen.size} records in total. End: ${endReason}`);
}

if (process.argv[1] && /magicpin/.test(process.argv[1])) {
  runMagicpin({
    categories: arg('categories')?.split(',').map((c) => c.trim()),
    maxStores: arg('max-stores') ? Number(arg('max-stores')) : undefined,
    maxPages: arg('max-pages') ? Number(arg('max-pages')) : undefined,
    root: arg('root'),
    noSkip: process.argv.includes('--no-skip'),
  }).catch((e) => {
    console.error(e);
    process.exit(1);
  });
}

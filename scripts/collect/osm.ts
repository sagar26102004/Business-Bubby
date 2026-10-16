/// <reference types="node" />
/**
 * OPENSTREETMAP COLLECTOR — every named business OSM knows in the plan's bbox,
 * in one request.
 *
 *   npx tsx scripts/collect/osm.ts [--refresh] [--root <dir>]
 *
 * Writes E:\listing\osm\records.jsonl (RawRecord) and keeps the raw answer in
 * E:\listing\osm\raw\<city>-<date>.json, so a re-run the same day costs
 * nothing (--refresh asks again). OSM's data is ODbL: free to use with credit
 * ("© OpenStreetMap contributors"), and the Overpass API is a free public
 * service, so the bot asks once and never in a loop.
 *
 * OSM in Indore is good for names, pins and categories and patchy for phones
 * and hours; the merge step lets Google fill those in.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { LISTING_ROOT, sleep } from '../listing-lib';
import { loadPlan } from './google-maps';
import {
  DAY_KEYS,
  appendRecords,
  botDir,
  botLogger,
  hhmm,
  normPhone,
  readRecords,
  socialKind,
  type DayKey,
  type RawRecord,
} from './record';

const BOT = 'osm';
/** Public Overpass servers, tried in turn — the main one is often busy (504) for minutes at a time. */
const OVERPASS = [
  'https://overpass-api.de/api/interpreter',
  'https://overpass.kumi.systems/api/interpreter',
  'https://maps.mail.ru/osm/tools/overpass/api/interpreter',
  'https://overpass.private.coffee/api/interpreter',
];

/** Tag keys that make a named thing a business, and the values that don't. */
const BUSINESS_KEYS = ['shop', 'amenity', 'healthcare', 'leisure', 'office', 'craft', 'tourism', 'club'];
const NOT_A_BUSINESS =
  /^(amenity=(place_of_worship|parking|parking_space|parking_entrance|toilets|bench|waste_basket|waste_disposal|recycling|drinking_water|shelter|bus_station|taxi|fuel|atm|post_box|telephone|fountain|clock|grave_yard|townhall|police|fire_station|courthouse|prison|public_building|community_centre|social_facility|bicycle_parking|motorcycle_parking|vending_machine|loading_dock|water_point|charging_station)|leisure=(park|garden|playground|pitch|track|stadium|swimming_pool|common|nature_reserve|picnic_table|slipway|dog_park)|tourism=(attraction|viewpoint|artwork|information|picnic_site|museum|gallery|zoo|theme_park|camp_site))$/;

function arg(name: string, fallback?: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : fallback;
}

function query(b: { south: number; west: number; north: number; east: number }): string {
  const box = `${b.south},${b.west},${b.north},${b.east}`;
  return `[out:json][timeout:180];
(
${BUSINESS_KEYS.map((k) => `  nwr["name"]["${k}"](${box});`).join('\n')}
);
out center tags;`;
}

/* ───────────────────────────── hours ────────────────────────────────────── */

const OSM_DAYS = ['Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa', 'Su'];

/**
 * The common OSM opening_hours forms → the publisher's week. Handles "24/7",
 * "Mo-Sa 09:00-21:00; Su off", "Mo,We,Fr 10:00-13:00,17:00-20:00" and a
 * bare "09:00-21:00" (every day); days no rule names are closed. Anything fancier (PH, months, week numbers)
 * returns undefined, and the raw text is kept instead.
 */
export function osmHours(raw: string): Record<DayKey, string> | undefined {
  const text = raw.trim();
  if (text === '24/7') return Object.fromEntries(DAY_KEYS.map((k) => [k, '00:00-23:59'])) as Record<DayKey, string>;
  const week: Partial<Record<DayKey, string>> = {};
  let namedDays = false;
  // Rules are split by ";" — and by ", " when a day name follows ("Mo-Sa 16:00-20:30, Su 10:00-12:00").
  const rules = text.split(/;|,\s*(?=(?:Mo|Tu|We|Th|Fr|Sa|Su)\b)/).map((r) => r.trim()).filter(Boolean);
  for (const rule of rules) {
    const m = /^(?:([A-Za-z,\- ]+?)\s+)?(off|closed|\d{1,2}:\d{2}\s*-\s*\d{1,2}:\d{2}(?:\s*,\s*\d{1,2}:\d{2}\s*-\s*\d{1,2}:\d{2})*)$/i.exec(rule);
    if (!m) return undefined;
    const days = new Set<number>();
    if (!m[1]) OSM_DAYS.forEach((_, i) => days.add(i));
    else {
      namedDays = true;
      for (const part of m[1].replace(/\s/g, '').split(',')) {
        const [a, b] = part.split('-');
        const ia = OSM_DAYS.indexOf(a);
        const ib = b ? OSM_DAYS.indexOf(b) : ia;
        if (ia < 0 || ib < 0) return undefined;
        for (let i = ia; ; i = (i + 1) % 7) {
          days.add(i);
          if (i === ib) break;
        }
      }
    }
    const value = /^(off|closed)$/i.test(m[2])
      ? 'closed'
      : m[2]
          .split(',')
          .map((s) => {
            const [o, c] = s.split('-').map((t) => t.trim().split(':').map(Number));
            return `${hhmm(o[0], o[1])}-${c[0] >= 24 ? '23:59' : hhmm(c[0], c[1])}`;
          })
          .join(', ');
    for (const i of days) week[DAY_KEYS[i]] = value;
  }
  // In OSM, a day no rule names is closed ("Mo-Sa 09:00-21:00" = shut on Sunday).
  if (namedDays) for (const k of DAY_KEYS) week[k] ??= 'closed';
  return DAY_KEYS.every((k) => week[k]) ? (week as Record<DayKey, string>) : undefined;
}

/* ───────────────────────────── one element ──────────────────────────────── */

interface OsmElement {
  type: 'node' | 'way' | 'relation';
  id: number;
  lat?: number;
  lon?: number;
  center?: { lat: number; lon: number };
  tags: Record<string, string>;
}

const list = (v: string | undefined) => (v ? v.split(/\s*;\s*/).filter(Boolean) : []);

export function toRecord(el: OsmElement, city: string): RawRecord | null {
  const t = el.tags;
  const categories = BUSINESS_KEYS.filter((k) => t[k]).map((k) => `${k}=${t[k]}`);
  if (!categories.length || categories.every((c) => NOT_A_BUSINESS.test(c))) return null;
  const lat = el.lat ?? el.center?.lat;
  const lon = el.lon ?? el.center?.lon;
  if (lat === undefined || lon === undefined) return null;

  const phones = [
    ...new Set(
      [t.phone, t['contact:phone'], t['contact:mobile'], t.mobile, t['phone:mobile']]
        .flatMap(list)
        .map(normPhone)
        .filter((p): p is string => !!p),
    ),
  ];
  const websites = [t.website, t['contact:website'], t.url].flatMap(list);
  const socials: NonNullable<RawRecord['socials']> = {};
  let website: string | undefined;
  for (const w of [...websites, t['contact:facebook'], t['contact:instagram'], t.facebook, t.instagram].filter(Boolean) as string[]) {
    const kind = socialKind(w);
    if (kind) socials[kind] ??= w;
    else website ??= w;
  }
  const hoursText = t.opening_hours;
  const hours = hoursText ? osmHours(hoursText) : undefined;
  const street = [t['addr:housenumber'], t['addr:housename'], t['addr:street']].filter(Boolean).join(' ');
  const addressLine = [street, t['addr:place'], t['addr:suburb'] ?? t['addr:neighbourhood']].filter(Boolean).join(', ');

  const extra: Record<string, string> = {};
  for (const [k, v] of Object.entries(t)) {
    if (/^(name|phone|contact:|mobile|website|url|opening_hours|addr:|email|facebook|instagram|description)/.test(k)) continue;
    if (BUSINESS_KEYS.includes(k)) continue;
    extra[k] = v;
  }

  return {
    source: BOT,
    sourceId: `${el.type}/${el.id}`,
    sourceUrl: `https://www.openstreetmap.org/${el.type}/${el.id}`,
    collectedAt: new Date().toISOString(),
    name: t.name.trim(),
    altNames: [t['name:en'], t['name:hi'], t.alt_name, t.official_name].filter((n): n is string => !!n && n !== t.name),
    categories,
    description: t.description,
    phones,
    whatsapp: t['contact:whatsapp'] ? normPhone(t['contact:whatsapp']) : undefined,
    emails: [t.email, t['contact:email']].flatMap(list),
    website,
    socials,
    addressLine: addressLine || undefined,
    locality: t['addr:suburb'] ?? t['addr:neighbourhood'],
    city: t['addr:city'] ?? city,
    region: t['addr:state'],
    pinCode: t['addr:postcode'],
    point: { latitude: lat, longitude: lon },
    hours,
    hoursRaw: hoursText && !hours ? hoursText : undefined,
    extra,
  };
}

/* ───────────────────────────── run ──────────────────────────────────────── */

export async function runOsm(opts: { root?: string; refresh?: boolean; log?: (l: string) => void } = {}) {
  const root = opts.root ?? LISTING_ROOT;
  const log = opts.log ?? botLogger(BOT, root);
  const plan = loadPlan();
  const rawDir = join(botDir(BOT, root), 'raw');
  mkdirSync(rawDir, { recursive: true });
  const rawFile = join(rawDir, `${plan.city.toLowerCase()}-${new Date().toISOString().slice(0, 10)}.json`);

  let elements: OsmElement[];
  if (existsSync(rawFile) && !opts.refresh) {
    elements = (JSON.parse(readFileSync(rawFile, 'utf8')) as { elements: OsmElement[] }).elements;
    log(`osm: using today's saved answer (${elements.length} elements) — --refresh to ask again`);
  } else {
    log(`osm: asking Overpass for every named business in ${plan.city}…`);
    // A busy server answers 429/504: move on to the next one, and after a full round wait and go again.
    let res: Response | undefined;
    for (let attempt = 1; attempt <= OVERPASS.length * 3; attempt++) {
      const server = OVERPASS[(attempt - 1) % OVERPASS.length];
      res = await fetch(server, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'User-Agent': 'OnePlace-listing/1.0 (local business directory)' },
        body: `data=${encodeURIComponent(query(plan.bbox))}`,
      }).catch(() => undefined);
      if (res?.ok) break;
      if (res && ![429, 502, 503, 504].includes(res.status)) break;
      log(`osm: ${new URL(server).host} busy (${res?.status ?? 'no answer'})`);
      if (attempt % OVERPASS.length === 0) await sleep(60_000);
    }
    if (!res?.ok) throw new Error(`Overpass answered ${res?.status}: ${(await res?.text())?.slice(0, 300)}`);
    const text = await res.text();
    writeFileSync(rawFile, text);
    elements = (JSON.parse(text) as { elements: OsmElement[] }).elements;
    log(`osm: ${elements.length} elements`);
  }

  const seen = new Set(readRecords(BOT, root).map((r) => r.sourceId));
  const records = elements.map((el) => toRecord(el, plan.city)).filter((r): r is RawRecord => !!r);
  const fresh = records.filter((r) => !seen.has(r.sourceId));
  appendRecords(BOT, fresh, root);
  const n = (f: (r: RawRecord) => unknown) => records.filter(f).length;
  log(
    `osm: ${records.length} businesses (${fresh.length} new) — phone ${n((r) => r.phones?.length)}, hours ${n((r) => r.hours)}, website ${n((r) => r.website)}, email ${n((r) => r.emails?.length)}`,
  );
  return { total: records.length, newPlaces: fresh.length };
}

if (process.argv[1] && /[\\/]osm\.ts$/.test(process.argv[1])) {
  runOsm({ root: arg('root'), refresh: process.argv.includes('--refresh') }).catch((e) => {
    console.error(e);
    process.exit(1);
  });
}

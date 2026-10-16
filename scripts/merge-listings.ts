/// <reference types="node" />
/**
 * MERGE — every collector bot's records → one final file of businesses.
 *
 *   npx tsx scripts/merge-listings.ts [--include-food] [--root E:\listing] [--offline]
 *
 * Reads E:\listing\<bot>\records.jsonl for every bot folder (google-maps, osm,
 * justdial, …), finds the same business across sources and merges the records
 * field by field: one source has the email, another the phone → one business
 * with both. Writes, under E:\listing\merged\:
 *
 *   businesses.json    every merged business (the publisher's input, via build-ready.ts)
 *   review.json        pairs that MIGHT be the same place — decide in decisions.json
 *   decisions.json     yours to edit: { "<keyA>|<keyB>": "same" | "different" }
 *   merge-report.txt   totals, field coverage, conflicts, unmapped categories
 *
 * SAME BUSINESS when any strong key matches (LISTING-PLAN.md, "Merge rules"):
 *   - the same phone number, and the two are within 1 km (or 5 km with the same name)
 *     (a chain's call-centre number shared by many branches is never a key);
 *   - the same website host or Instagram handle, with the same proviso;
 *   - the same name (or one inside the other) with pins within 150 m — only
 *     ACROSS sources, so a chain's two branches in one source stay apart.
 * A similar name within 50 m with no strong key goes to review.json and both
 * are held until decisions.json says "same" or "different".
 *
 * FIELDS: lists (phones, emails, categories, photos, amenities…) are unioned;
 * single values come from the most trusted source that has one — google-maps,
 * then practo, zomato, justdial, indiamart, magicpin, sulekha, osm. Hours only
 * from a source with all 7 days.
 *
 * ALREADY ON ONE PLACE: every merged business is checked against the live
 * listings (name + pin within 150 m, or the same phone) and the published-keys
 * file. Those are kept in the file, marked `alreadyListed`, and never re-published.
 * Re-running is safe and deterministic: ids come from the cluster's best record.
 */
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { haversineKm } from '@/lib/geo';
import { DUP_RADIUS_KM, LISTING_ROOT, anonClient, isRealName, loadKeyFile, normName, type KnownListing } from './listing-lib';
import { tagsFor } from './collect/category-tags';
import { normHost, normPhone, readRecords, type DayKey, type RawRecord } from './collect/record';

/** Most trusted first. A source not listed ranks after all of these. */
export const SOURCE_PRIORITY = ['google-maps', 'practo', 'zomato', 'justdial', 'indiamart', 'magicpin', 'sulekha', 'osm'];
/** Folders under E:\listing that are not bots. */
const NOT_BOTS = new Set(['food data', 'merged', 'ready', 'shared', 'logs']);
/** The hold reasons the fill (google-maps.ts --fill-photos) looks for. */
export const NO_PHOTO = 'no photo yet — the photo fill looks it up on Google';
export const NO_PIN = 'no pin';
/** Indore's centre, and how far from it a pin may be before it needs an address to back it. */
const CITY_CENTER = { latitude: 22.7196, longitude: 75.8577 };
const FAR_FROM_CITY_KM = 40;
/** Sources whose pins are never placeholders. */
const PRECISE_PIN_SOURCES = new Set(['google-maps', 'practo']);
const PHONE_RADIUS_KM = 1;
/** A phone/website match further apart than PHONE_RADIUS_KM still joins when the names are identical and within this. */
const SAME_NAME_RADIUS_KM = 5;
const NEAR_RADIUS_KM = 0.05;
/** A phone on more than this many records of ONE source is a shared/call-centre number. */
const SHARED_PHONE_AT = 3;
/** Hosts that are never one business's own site. */
const GENERIC_HOSTS =
  /(^|\.)(google\.com|business\.site|g\.page|goo\.gl|justdial\.com|indiamart\.com|sulekha\.com|magicpin\.in|practo\.com|zomato\.com|swiggy\.com|wa\.me|whatsapp\.com|linktr\.ee|sites\.google\.com|blogspot\.com|wixsite\.com|instagram\.com|facebook\.com|youtube\.com|twitter\.com|x\.com|linkedin\.com)$/;
/** Words that say what KIND of place it is, not which one — two names sharing only these are not alike. */
const NAME_STOPWORDS = new Set(
  ('the and of shop store stores indore centre center pvt ltd private limited co mp new shri sri shree dr doctor clinic clinics hospital ' +
    'medical medicals pharmacy chemist chemists lab labs laboratory diagnostic diagnostics dental care health healthcare gym fitness salon ' +
    'school academy classes coaching institute hardware electricals electronics traders trading enterprises agency agencies services service ' +
    'mart general kirana provision provisions super market bazaar house home hotel restaurant cafe').split(' '),
);

export interface MergedBusiness {
  id: string;
  name: string;
  altNames?: string[];
  categories: string[];
  tags: string[];
  type: 'shop' | 'service';
  food: boolean;
  description?: string;
  phones: string[];
  whatsapp?: string;
  emails: string[];
  website?: string;
  socials?: RawRecord['socials'];
  address?: string;
  addressLine?: string;
  locality?: string;
  city?: string;
  region?: string;
  pinCode?: string;
  point?: { latitude: number; longitude: number };
  hours?: Record<DayKey, string>;
  hoursRaw?: string;
  rating?: number;
  reviewCount?: number;
  claimed?: boolean;
  ownerName?: string;
  yearEstablished?: number;
  gstin?: string;
  services?: string[];
  products?: string[];
  amenities?: string[];
  paymentMethods?: string[];
  photos: string[];
  /** Every record that went into this business. */
  sources: { source: string; sourceId: string; sourceUrl?: string; name: string }[];
  /** Which source each single-valued field came from. */
  fieldSources: Record<string, string>;
  /** Per-source extras, verbatim. */
  extra?: Record<string, unknown>;
  conflicts?: string[];
  alreadyListed?: { id: string; name: string; by: 'name+pin' | 'phone' | 'key file' };
  publishable: boolean;
  holdReasons: string[];
}

function arg(name: string, fallback?: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : fallback;
}

const rank = (source: string) => {
  const i = SOURCE_PRIORITY.indexOf(source);
  return i < 0 ? SOURCE_PRIORITY.length : i;
};
const recKey = (r: RawRecord) => `${r.source}:${r.sourceId}`;
const nameTokens = (name: string) =>
  new Set(
    name
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .toLowerCase()
      .replace(/&/g, ' and ')
      .split(/[^a-z0-9]+/)
      .filter((t) => t.length > 1 && !NAME_STOPWORDS.has(t)),
  );
export function similarNames(a: Pick<RawRecord, 'name'>, b: Pick<RawRecord, 'name'>): boolean {
  const ka = normName(a.name);
  const kb = normName(b.name);
  // One name inside the other counts only when it is at least half of it:
  // "Gupta Clinic" ⊂ "Herbo Care Gupta Clinic" yes, "A Block" ⊂ "Water Tank on top of A block" no.
  const [short, long] = ka.length <= kb.length ? [ka, kb] : [kb, ka];
  if (short.length >= 4 && long.includes(short) && short.length * 2 >= long.length) return true;
  const ta = nameTokens(a.name);
  const tb = nameTokens(b.name);
  if (!ta.size || !tb.size) return false;
  const shared = [...ta].filter((t) => tb.has(t)).length;
  return shared / Math.max(ta.size, tb.size) >= 0.5;
}
const km = (a: RawRecord, b: RawRecord) => (a.point && b.point ? haversineKm(a.point, b.point) : Infinity);

/* ───────────────────────────── union-find ───────────────────────────────── */

class Clusters {
  private parent = new Map<number, number>();
  find(i: number): number {
    let p = this.parent.get(i) ?? i;
    if (p !== i) {
      p = this.find(p);
      this.parent.set(i, p);
    }
    return p;
  }
  union(a: number, b: number) {
    const ra = this.find(a);
    const rb = this.find(b);
    if (ra !== rb) this.parent.set(Math.max(ra, rb), Math.min(ra, rb));
  }
}

/** Pins bucketed into ~220 m cells, so "who is near me" never scans every record. */
function spatialIndex(records: RawRecord[]) {
  const cell = (lat: number, lng: number) => `${Math.floor(lat / 0.002)}:${Math.floor(lng / 0.002)}`;
  const grid = new Map<string, number[]>();
  records.forEach((r, i) => {
    if (!r.point) return;
    const k = cell(r.point.latitude, r.point.longitude);
    (grid.get(k) ?? grid.set(k, []).get(k)!).push(i);
  });
  return (r: RawRecord): number[] => {
    if (!r.point) return [];
    const cy = Math.floor(r.point.latitude / 0.002);
    const cx = Math.floor(r.point.longitude / 0.002);
    const out: number[] = [];
    for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) out.push(...(grid.get(`${cy + dy}:${cx + dx}`) ?? []));
    return out;
  };
}

/* ───────────────────────────── merge one cluster ────────────────────────── */

function mergeCluster(members: RawRecord[]): Omit<MergedBusiness, 'publishable' | 'holdReasons' | 'tags' | 'type' | 'food'> {
  const byTrust = [...members].sort((a, b) => rank(a.source) - rank(b.source));
  const fieldSources: Record<string, string> = {};
  const pick = <K extends keyof RawRecord>(field: K, ok: (v: RawRecord[K]) => boolean = (v) => v !== undefined && v !== null && v !== '') => {
    for (const m of byTrust) {
      if (ok(m[field])) {
        fieldSources[field as string] = m.source;
        return m[field];
      }
    }
    return undefined;
  };
  const union = (get: (r: RawRecord) => string[] | undefined) => [...new Set(byTrust.flatMap((r) => get(r) ?? []))];

  const name = pick('name') as string;
  const point = pick('point') as MergedBusiness['point'];
  const socials: NonNullable<RawRecord['socials']> = {};
  for (const m of byTrust) for (const [k, v] of Object.entries(m.socials ?? {})) (socials as Record<string, string>)[k] ??= v as string;

  const conflicts: string[] = [];
  if (point) {
    for (const m of members) {
      const d = m.point ? haversineKm(point, m.point) : 0;
      if (d > 0.3) conflicts.push(`${m.source} puts it ${Math.round(d * 1000)} m away (${m.name})`);
    }
  }
  const names = [...new Set(members.map((m) => m.name.trim()))];
  const extra: Record<string, unknown> = {};
  for (const m of members) if (m.extra && Object.keys(m.extra).length) extra[m.source] = m.extra;

  const best = byTrust[0];
  return {
    id: `m_${createHash('sha1').update(recKey(best)).digest('hex').slice(0, 16)}`,
    name,
    altNames: [...new Set([...names.filter((n) => n !== name), ...union((r) => r.altNames)])],
    categories: union((r) => r.categories),
    description: pick('description') as string | undefined,
    phones: union((r) => r.phones?.map((p) => normPhone(p) ?? p)),
    whatsapp: pick('whatsapp') as string | undefined,
    emails: union((r) => r.emails?.map((e) => e.trim().toLowerCase())),
    website: pick('website') as string | undefined,
    socials,
    address: pick('address') as string | undefined,
    addressLine: pick('addressLine') as string | undefined,
    locality: pick('locality') as string | undefined,
    city: pick('city') as string | undefined,
    region: pick('region') as string | undefined,
    pinCode: pick('pinCode') as string | undefined,
    point,
    hours: pick('hours') as MergedBusiness['hours'],
    hoursRaw: pick('hoursRaw') as string | undefined,
    rating: pick('rating') as number | undefined,
    reviewCount: pick('reviewCount') as number | undefined,
    claimed: pick('claimed', (v) => v !== undefined) as boolean | undefined,
    ownerName: pick('ownerName') as string | undefined,
    yearEstablished: pick('yearEstablished') as number | undefined,
    gstin: pick('gstin') as string | undefined,
    services: union((r) => r.services),
    products: union((r) => r.products),
    amenities: union((r) => r.amenities),
    paymentMethods: union((r) => r.paymentMethods),
    photos: union((r) => r.photos),
    sources: byTrust.map((r) => ({ source: r.source, sourceId: r.sourceId, sourceUrl: r.sourceUrl, name: r.name })),
    fieldSources,
    extra: Object.keys(extra).length ? extra : undefined,
    conflicts: conflicts.length ? conflicts : undefined,
  };
}

/* ───────────────────────────── live listings ────────────────────────────── */

interface LiveListing extends KnownListing {
  phone?: string;
}

async function loadLive(): Promise<LiveListing[]> {
  const sb = anonClient();
  const out: LiveListing[] = [];
  for (let from = 0; ; from += 1000) {
    const { data, error } = await sb
      .from('businesses')
      .select('id, name:data->>name, phone:data->>phone, point:data->location->point')
      .range(from, from + 999);
    if (error) throw error;
    for (const r of data ?? []) {
      out.push({ ref: r.id as string, name: (r.name as string) ?? '', phone: (r.phone as string) ?? undefined, point: (r.point as never) ?? undefined });
    }
    if (!data || data.length < 1000) return out;
  }
}

/* ───────────────────────────── run ──────────────────────────────────────── */

export async function merge(opts: { root?: string; includeFood?: boolean; offline?: boolean } = {}) {
  const root = opts.root ?? LISTING_ROOT;
  const outDir = join(root, 'merged');
  mkdirSync(outDir, { recursive: true });
  const report: string[] = [];
  const say = (l: string) => {
    console.log(l);
    report.push(l);
  };

  // 1. Every bot's records.
  const bots = readdirSync(root, { withFileTypes: true })
    .filter((d) => d.isDirectory() && !NOT_BOTS.has(d.name) && !d.name.startsWith('.') && existsSync(join(root, d.name, 'records.jsonl')))
    .map((d) => d.name);
  const records: RawRecord[] = [];
  for (const bot of bots) {
    const rs = readRecords(bot, root).filter((r) => r.name?.trim());
    say(`${bot}: ${rs.length} records`);
    records.push(...rs);
  }
  if (!records.length) throw new Error(`No records.jsonl under ${root} — run a collector bot first.`);

  // Placeholder photos: magicpin shows one stock picture on every store that
  // has none, so a photo URL on many records of one site isn't that business's.
  const photoUse = new Map<string, number>();
  for (const r of records) for (const u of new Set(r.photos ?? [])) photoUse.set(`${r.source}|${u}`, (photoUse.get(`${r.source}|${u}`) ?? 0) + 1);
  let stockPhotos = 0;
  for (const r of records) {
    const own = (r.photos ?? []).filter((u) => (photoUse.get(`${r.source}|${u}`) ?? 0) <= SHARED_PHONE_AT);
    stockPhotos += (r.photos?.length ?? 0) - own.length;
    r.photos = own;
  }
  if (stockPhotos) say(`stock photos dropped (one picture on many records of a site): ${stockPhotos}`);

  // Placeholder pins: a site that doesn't know where a store is drops it on
  // the city centre, so one exact point on many of its records is no pin at all.
  const pointUse = new Map<string, number>();
  const pointKey = (r: RawRecord) => `${r.source}|${r.point!.latitude.toFixed(6)},${r.point!.longitude.toFixed(6)}`;
  for (const r of records) if (r.point) pointUse.set(pointKey(r), (pointUse.get(pointKey(r)) ?? 0) + 1);
  let placeholders = 0;
  for (const r of records) {
    // Google's and Practo's pins are always the real place — many shops in one
    // mall or market share a pin there, and dropping it lost 678 real locations (14 Oct).
    if (PRECISE_PIN_SOURCES.has(r.source)) continue;
    if (r.point && (pointUse.get(pointKey(r)) ?? 0) > SHARED_PHONE_AT) {
      r.extra = { ...r.extra, placeholderPin: r.point };
      r.point = undefined;
      placeholders++;
    }
  }
  if (placeholders) say(`placeholder pins dropped (one exact point on many records of a site): ${placeholders}`);

  // Region pins: Google gives a business that hides its address (home-based,
  // service-area) a point for its whole REGION — 180 Indore businesses sat on
  // one spot in Chhattisgarh (21.068, 82.753), others in the Arabian Sea or at
  // the middle of Madhya Pradesh (16 Oct). Every bot searches Indore, so a pin
  // over FAR_FROM_CITY_KM away with no address — or with "Indore" in its name
  // or address — is not where the business is. Even PRECISE_PIN_SOURCES.
  let regionPins = 0;
  for (const r of records) {
    if (!r.point || haversineKm(r.point, CITY_CENTER) <= FAR_FROM_CITY_KM) continue;
    const text = [r.name, r.address, r.addressLine, r.locality, r.city].filter(Boolean).join(' ');
    if (!(r.address || r.addressLine) || /indore/i.test(text)) {
      r.extra = { ...r.extra, regionPin: r.point };
      r.point = undefined;
      regionPins++;
    }
  }
  if (regionPins) say(`region pins dropped (no address, or "Indore" in it, but > ${FAR_FROM_CITY_KM} km from Indore): ${regionPins}`);

  // 2. Strong keys.
  const clusters = new Clusters();
  const near = spatialIndex(records);
  const keyOf = (r: RawRecord) => recKey(r);

  // Shared numbers: a phone on > SHARED_PHONE_AT records of one source is a call centre, not a key.
  const phoneUse = new Map<string, number>();
  for (const r of records) for (const p of new Set(r.phones ?? [])) phoneUse.set(`${r.source}|${p}`, (phoneUse.get(`${r.source}|${p}`) ?? 0) + 1);
  const sharedPhones = new Set([...phoneUse].filter(([, n]) => n > SHARED_PHONE_AT).map(([k]) => k.split('|')[1]));

  const linkBy = (keys: (r: RawRecord) => string[]) => {
    const index = new Map<string, number[]>();
    records.forEach((r, i) => keys(r).forEach((k) => (index.get(k) ?? index.set(k, []).get(k)!).push(i)));
    for (const ids of index.values()) {
      for (let a = 0; a < ids.length; a++) {
        for (let b = a + 1; b < ids.length; b++) {
          const ra = records[ids[a]];
          const rb = records[ids[b]];
          const d = km(ra, rb);
          // One site already lists these as two places (a doctor and the lab
          // in the same building share a number): join only when the names agree too.
          if (ra.source === rb.source) {
            if (d <= PHONE_RADIUS_KM && similarNames(ra, rb)) clusters.union(ids[a], ids[b]);
            continue;
          }
          // A chain's branches often share one number or site: never join them across town.
          if (d <= PHONE_RADIUS_KM || (d <= SAME_NAME_RADIUS_KM && normName(ra.name) === normName(rb.name))) clusters.union(ids[a], ids[b]);
        }
      }
    }
  };
  linkBy((r) => (r.phones ?? []).map((p) => normPhone(p) ?? p).filter((p) => !sharedPhones.has(p)));
  linkBy((r) => {
    const host = normHost(r.website);
    const ig = r.socials?.instagram ? `ig:${normHost(r.socials.instagram)}${new URL(r.socials.instagram, 'https://x').pathname.toLowerCase().replace(/\/+$/, '')}` : undefined;
    return [host && !GENERIC_HOSTS.test(host) ? `web:${host}` : undefined, ig].filter((k): k is string => !!k);
  });

  // Same name (or one inside the other) within 150 m, across sources.
  records.forEach((r, i) => {
    const key = normName(r.name);
    for (const j of near(r)) {
      if (j <= i) continue;
      const o = records[j];
      if (o.source === r.source || km(r, o) > DUP_RADIUS_KM) continue;
      const ok = normName(o.name);
      if (key === ok || (key.length >= 4 && ok.length >= 4 && (key.includes(ok) || ok.includes(key)))) clusters.union(i, j);
    }
  });

  // 3. Person-made decisions, then the "maybe" pairs left over.
  const decisionsFile = join(outDir, 'decisions.json');
  if (!existsSync(decisionsFile)) writeFileSync(decisionsFile, '{}\n');
  const decisions = JSON.parse(readFileSync(decisionsFile, 'utf8')) as Record<string, 'same' | 'different'>;
  const indexOfKey = new Map(records.map((r, i) => [keyOf(r), i]));
  for (const [pair, verdict] of Object.entries(decisions)) {
    const [a, b] = pair.split('|').map((k) => indexOfKey.get(k));
    if (verdict === 'same' && a !== undefined && b !== undefined) clusters.union(a, b);
  }
  const review: { pair: string; metres: number; a: Partial<RawRecord>; b: Partial<RawRecord> }[] = [];
  const held = new Map<number, string>();
  records.forEach((r, i) => {
    for (const j of near(r)) {
      if (j <= i) continue;
      const o = records[j];
      if (o.source === r.source || clusters.find(i) === clusters.find(j)) continue;
      const d = km(r, o);
      if (d > NEAR_RADIUS_KM || !similarNames(r, o)) continue;
      const pair = [keyOf(r), keyOf(o)].sort().join('|');
      if (decisions[pair]) continue;
      const brief = (x: RawRecord) => ({ source: x.source, sourceId: x.sourceId, name: x.name, address: x.address ?? x.addressLine, phones: x.phones, categories: x.categories });
      review.push({ pair, metres: Math.round(d * 1000), a: brief(r), b: brief(o) });
      held.set(i, o.name);
      held.set(j, r.name);
    }
  });

  // 4. Clusters → merged businesses.
  const groups = new Map<number, number[]>();
  records.forEach((_, i) => (groups.get(clusters.find(i)) ?? groups.set(clusters.find(i), []).get(clusters.find(i))!).push(i));

  let live: LiveListing[] = [];
  if (!opts.offline) {
    // No internet must not throw away a night's collecting (13 Oct): merge without the live check.
    // That's safe — list-business.ts checks every folder against the live listings again before publishing.
    live = await loadLive().catch((e) => {
      say(`!! could not reach the live listings (${e instanceof Error ? e.message : e}) — merged WITHOUT that check; re-run the merge when online`);
      return [];
    });
    say(`live listings checked against: ${live.length}`);
  }
  const keyFile = loadKeyFile();
  const liveRefs = new Set(live.map((l) => l.ref));
  const listedByKey = new Map<string, KnownListing[]>();
  for (const l of [...live, ...keyFile]) {
    const k = normName(l.name);
    (listedByKey.get(k) ?? listedByKey.set(k, []).get(k)!).push(l);
  }
  const livePhones = new Map<string, LiveListing>();
  for (const l of live) {
    const p = l.phone ? normPhone(l.phone) : undefined;
    if (p) livePhones.set(p, l);
  }
  const unmatched = new Map<string, number>();

  const merged: MergedBusiness[] = [];
  for (const ids of groups.values()) {
    const members = ids.map((i) => records[i]);
    const base = mergeCluster(members);
    const t = tagsFor(base.categories);
    t.unmatched.forEach((c) => unmatched.set(c, (unmatched.get(c) ?? 0) + 1));

    const holdReasons: string[] = [];
    let alreadyListed: MergedBusiness['alreadyListed'];
    if (base.point) {
      // Keys computed once (listedByKey, below the loop's setup) — a name lookup, then the distance.
      for (const l of listedByKey.get(normName(base.name)) ?? []) {
        if (l.point && haversineKm(base.point, l.point) <= DUP_RADIUS_KM) {
          alreadyListed = { id: l.ref, name: l.name, by: liveRefs.has(l.ref) ? 'name+pin' : 'key file' };
          break;
        }
      }
    }
    if (!alreadyListed) {
      const hit = base.phones.map((p) => livePhones.get(p)).find(Boolean);
      if (hit && base.point && hit.point && haversineKm(base.point, hit.point) <= PHONE_RADIUS_KM) alreadyListed = { id: hit.ref, name: hit.name, by: 'phone' };
    }
    if (alreadyListed) holdReasons.push(`already on One Place as "${alreadyListed.name}"`);
    if (!t.tags.length) holdReasons.push('no tag matched its categories');
    if (t.food && !opts.includeFood) holdReasons.push('food (Zomato covers food; --include-food to list)');
    if (!base.point) holdReasons.push(NO_PIN);
    if (!isRealName(base.name)) holdReasons.push('the name is not a name ("' + base.name + '")');
    if (!base.phones.length && !base.addressLine && !base.address) holdReasons.push('no phone and no address');
    // Sagar, 13 Oct 2026: one real photo is what makes a listing look authentic — none, no listing.
    if (!base.photos.length) holdReasons.push(NO_PHOTO);
    const heldBy = ids.map((i) => held.get(i)).find(Boolean);
    if (heldBy) holdReasons.push(`might be the same as "${heldBy}" — decide in review.json → decisions.json`);

    merged.push({ ...base, tags: t.tags, type: t.type === 'shop' ? 'shop' : 'service', food: t.food, alreadyListed, publishable: !holdReasons.length, holdReasons });
  }
  merged.sort((a, b) => a.name.localeCompare(b.name));

  // 5. Write.
  const write = (file: string, data: unknown) => {
    const path = join(outDir, file);
    writeFileSync(`${path}.tmp`, typeof data === 'string' ? data : JSON.stringify(data, null, 2));
    renameSync(`${path}.tmp`, path);
  };
  write('businesses.json', merged);
  write('review.json', review);

  const n = (f: (m: MergedBusiness) => unknown) => merged.filter(f).length;
  const multi = n((m) => new Set(m.sources.map((s) => s.source)).size > 1);
  say('');
  say(`${records.length} records → ${merged.length} businesses (${multi} found on more than one site)`);
  say(`  publishable now: ${n((m) => m.publishable)}`);
  say(`  waiting only for a photo: ${n((m) => m.holdReasons.length === 1 && m.holdReasons[0] === NO_PHOTO)} (google-maps.ts --fill-photos, then merge again)`);
  say(`  already on One Place: ${n((m) => m.alreadyListed)} · food: ${n((m) => m.food)} · no tag: ${n((m) => !m.tags.length)} · to review: ${review.length} pairs`);
  say(`  with phone ${n((m) => m.phones.length)} · hours ${n((m) => m.hours)} · email ${n((m) => m.emails.length)} · website ${n((m) => m.website)} · photo ${n((m) => m.photos.length)}`);
  if (sharedPhones.size) say(`  shared numbers ignored as merge keys: ${sharedPhones.size}`);
  const byTag = new Map<string, number>();
  for (const m of merged.filter((x) => x.publishable)) for (const t of m.tags) byTag.set(t, (byTag.get(t) ?? 0) + 1);
  say('');
  say('Publishable by tag (top 40):');
  for (const [t, c] of [...byTag].sort((a, b) => b[1] - a[1]).slice(0, 40)) say(`  ${String(c).padStart(5)}  ${t}`);
  say('');
  say('Categories no rule matched (add to scripts/collect/category-tags.ts), top 60:');
  for (const [c, k] of [...unmatched].sort((a, b) => b[1] - a[1]).slice(0, 60)) say(`  ${String(k).padStart(5)}  ${c}`);
  const conflicted = merged.filter((m) => m.conflicts);
  if (conflicted.length) {
    say('');
    say(`Pins that disagree by > 300 m (${conflicted.length}):`);
    for (const m of conflicted.slice(0, 30)) say(`  ${m.name}: ${m.conflicts!.join('; ')}`);
  }
  write('merge-report.txt', `${report.join('\n')}\n`);
  console.log(`\nWrote ${join(outDir, 'businesses.json')}`);
  return merged;
}

if (process.argv[1] && /merge-listings/.test(process.argv[1])) {
  merge({ root: arg('root'), includeFood: process.argv.includes('--include-food'), offline: process.argv.includes('--offline') }).catch((e) => {
    console.error(e);
    process.exit(1);
  });
}

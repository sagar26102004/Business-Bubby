/// <reference types="node" />
/**
 * PRACTO COLLECTOR — Indore's clinics and doctors from practo.com.
 *
 *   npx tsx scripts/collect/practo.ts [--specialities "dentist,dermatologist"] [--max-pages 3]
 *
 * Writes E:\listing\practo\records.jsonl (RawRecord). Never publishes.
 *
 * Each speciality's list pages (`/indore/<speciality>?page=N`, 10 doctors a
 * page) carry one schema.org block per doctor: name, speciality, fee, photos,
 * address, pin and the clinic they practise at. A CLINIC is the business: the
 * bot writes one record per clinic, with every doctor seen there listed under
 * `extra.doctors` (and their specialities as categories). A doctor with no
 * clinic becomes a record of their own.
 *
 * Practo shows no clinic phone (calls go through Practo's own number), so these
 * records add doctors, specialities, fees and clinic photos to what Google gives.
 * No browser: plain requests, one at a time, 1.5–4 s apart; a 403/429 or a
 * captcha page stops the run. Finished pages are remembered in state.json.
 */
import { LISTING_ROOT, sleep } from '../listing-lib';
import { appendRecords, botLogger, fetchHtml, jsonLd, readRecords, readState, stopRequested, writeState, type RawRecord } from './record';

const BOT = 'practo';
const CITY = 'indore';
const MAX_PAGES = 100;
/** Practo's speciality slugs. One that doesn't exist just returns no doctors. */
const SPECIALITIES = [
  'dentist', 'general-physician', 'dermatologist', 'gynecologist-obstetrician', 'pediatrician', 'orthopedist',
  'ophthalmologist', 'ear-nose-throat-ent-specialist', 'cardiologist', 'physiotherapist', 'homoeopath', 'ayurveda',
  'psychiatrist', 'psychologist', 'urologist', 'neurologist', 'gastroenterologist', 'diabetologist',
  'dietitian-nutritionist', 'pulmonologist', 'nephrologist', 'oncologist', 'endocrinologist', 'sexologist',
  'general-surgeon', 'plastic-surgeon', 'veterinarian', 'trichologist', 'infertility-specialist',
];

interface State {
  /** "<speciality>|<page>" already read; "<speciality>|end" once a speciality is used up. */
  done: string[];
}

interface Doctor {
  name: string;
  speciality: string;
  url?: string;
  fee?: number;
  photo?: string;
}

function arg(name: string, fallback?: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : fallback;
}
const pause = () => sleep(1500 + Math.random() * 2500);

/** schema.org @type → readable speciality ("MedicalClinic" stays a clinic). */
const specialityOf = (ld: any, slug: string) =>
  typeof ld['@type'] === 'string' && ld['@type'] !== 'Physician' ? ld['@type'].replace(/([a-z])([A-Z])/g, '$1 $2') : slug.replace(/-/g, ' ');

const practiceId = (url: string | undefined) => (url ? /[?&]practice_id=(\d+)/.exec(url)?.[1] : undefined);

/** Fold one doctor's block into its clinic's record (created on first sight). */
function fold(byClinic: Map<string, RawRecord>, ld: any, slug: string) {
  if (!ld?.name || !ld.url) return;
  const clinic = ld.branchOf;
  const pid = practiceId(ld.url);
  const key = pid ? `clinic:${pid}` : `doctor:${ld.url.split('?')[0]}`;
  const speciality = specialityOf(ld, slug);
  const doctor: Doctor = {
    name: String(ld.name).trim(),
    speciality,
    url: ld.url.split('?')[0],
    fee: typeof ld.priceRange === 'number' ? ld.priceRange : Number(ld.priceRange) || undefined,
    photo: typeof ld.image === 'string' ? ld.image : undefined,
  };
  const addr = ld.address ?? {};
  let rec = byClinic.get(key);
  if (!rec) {
    const photos = ((ld.photo ?? []) as any[]).map((p) => p?.url).filter((u: unknown): u is string => typeof u === 'string' && u.includes('/practices/'));
    rec = {
      source: BOT,
      sourceId: key,
      sourceUrl: clinic?.url ?? doctor.url,
      collectedAt: new Date().toISOString(),
      name: String(clinic?.name ?? ld.name).trim(),
      categories: [],
      address: [addr.streetAddress, addr.postalCode].filter(Boolean).join(', ') || undefined,
      addressLine: addr.streetAddress,
      locality: addr.addressLocality,
      city: 'Indore',
      region: 'Madhya Pradesh',
      pinCode: addr.postalCode,
      point: ld.geo?.latitude ? { latitude: Number(ld.geo.latitude), longitude: Number(ld.geo.longitude) } : undefined,
      photos,
      extra: { doctors: [] as Doctor[] },
    };
    byClinic.set(key, rec);
  }
  const doctors = rec.extra!.doctors as Doctor[];
  if (!doctors.some((d) => d.url === doctor.url)) doctors.push(doctor);
  rec.categories = [...new Set([...(rec.categories ?? []), clinic ? 'Clinic' : 'Doctor', speciality])];
  rec.services = [...new Set([...(rec.services ?? []), speciality])];
}

export async function runPracto(opts: { specialities?: string[]; maxPages?: number; root?: string } = {}) {
  const root = opts.root ?? LISTING_ROOT;
  const log = botLogger(BOT, root);
  const state = readState<State>(BOT, { done: [] }, root);
  const done = new Set(state.done);
  const save = () => writeState(BOT, { done: [...done] }, root);
  // Earlier records are reloaded so a clinic seen again gains its new doctors instead of a second line.
  const byClinic = new Map(readRecords(BOT, root).map((r) => [r.sourceId, r]));
  const before = new Map([...byClinic].map(([k, r]) => [k, JSON.stringify(r.extra?.doctors ?? [])]));
  let pages = 0;
  let endReason = 'every speciality is done';
  try {
    for (const slug of opts.specialities ?? SPECIALITIES) {
      if (done.has(`${slug}|end`)) continue;
      for (let p = 1; p <= (opts.maxPages ?? MAX_PAGES); p++) {
        if (done.has(`${slug}|${p}`)) continue;
        if (stopRequested(BOT, root)) throw new Error('STOP');
        const html = await fetchHtml(`https://www.practo.com/${CITY}/${slug}${p > 1 ? `?page=${p}` : ''}`);
        pages++;
        const doctors = jsonLd(html).filter((ld) => ld && ld.url && /\/doctor\//.test(ld.url));
        const known = new Set([...byClinic.values()].flatMap((r) => ((r.extra?.doctors ?? []) as Doctor[]).map((d) => d.url)));
        const freshDoctors = doctors.filter((ld) => !known.has(String(ld.url).split('?')[0])).length;
        doctors.forEach((ld) => fold(byClinic, ld, slug));
        log(`${slug} page ${p}: ${doctors.length} doctors, ${freshDoctors} new (${byClinic.size} clinics/doctors so far)`);
        done.add(`${slug}|${p}`);
        // Past its last page Practo repeats an earlier one — no new doctor means this speciality is used up.
        if (!doctors.length || !freshDoctors) {
          done.add(`${slug}|end`);
          break;
        }
        if (pages % 5 === 0) {
          flush();
          save();
        }
        await pause();
      }
    }
  } catch (e) {
    const m = e instanceof Error ? e.message : String(e);
    if (m === 'STOP') endReason = 'STOP file found';
    else if (m === 'BLOCKED') endReason = 'Practo showed a block/captcha page — try again later';
    else throw e;
  } finally {
    flush();
    save();
  }
  log(`practo: ${pages} pages read, ${byClinic.size} clinics/doctors in total. End: ${endReason}`);

  /** Append every clinic that's new or gained a doctor (readRecords keeps the last line per id). */
  function flush() {
    const changed = [...byClinic].filter(([k, r]) => before.get(k) !== JSON.stringify(r.extra?.doctors ?? [])).map(([, r]) => r);
    appendRecords(BOT, changed, root);
    for (const r of changed) before.set(r.sourceId, JSON.stringify(r.extra?.doctors ?? []));
  }
}

if (process.argv[1] && /practo/.test(process.argv[1])) {
  runPracto({
    specialities: arg('specialities')?.split(',').map((s) => s.trim()),
    maxPages: arg('max-pages') ? Number(arg('max-pages')) : undefined,
    root: arg('root'),
  }).catch((e) => {
    console.error(e);
    process.exit(1);
  });
}

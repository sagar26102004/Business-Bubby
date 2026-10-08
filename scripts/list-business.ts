/**
 * BULK LISTING — publish a business from a folder on disk, as the super-admin.
 *
 *   npx tsx scripts/list-business.ts "E:\listing\cafe\Amigos Café and Restaurant" [--dry-run]
 *   npx tsx scripts/list-business.ts "E:\listing\cafe" [--dry-run]     (every sub-folder)
 *   npx tsx scripts/list-business.ts "E:\listing\cafe" --summary       (what's waiting + what to check)
 *   …add --keep to keep published folders, --keys <file> to use another key file
 *
 * One folder = one listing (scripts/maps-bot.ts builds these from Google Maps):
 *   <lat>, <lng>.png   map screenshot — the file NAME is the pin (or location.point in listing.json)
 *   listing.json       facts read off that screenshot (tags, address, hours…)
 *   menu.json          the menu, in the register wizard's paste format
 *   cover.jpg          the display picture
 *   1.jpg, 2.jpg, …    the work showcase, in that order
 *
 * It goes through the same pieces the app does — `parseOfferings`/`toMenuItem`
 * for the menu, `cloudinary-sign` for uploads, the `businesses` row shape of
 * `src/data/supabase/businesses.ts` `create` — so a listing made here is
 * indistinguishable from one made in the wizard.
 *
 * SAFE TO RE-RUN. Every published business's KEY (normalised name + pin) is
 * appended to E:\listing\published-keys.json and its folder is then deleted
 * (`--keep` keeps it). Before inserting, the key is checked against every live
 * listing and that file, so the same café is never listed twice — a match
 * within 150 m is recorded as a duplicate and skipped.
 *
 * Credentials live in scripts/.listing.env (gitignored):
 *   LISTING_LOGIN=<username or phone>
 *   LISTING_PASSWORD=<password>
 */
/// <reference types="node" />
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { randomUUID } from 'node:crypto';
import { existsSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { basename, extname, join } from 'node:path';
import type { Business, BusinessLocation, ListingType, MenuItem, PortfolioItem } from '@/domain/types';
import { DAY_LABELS, dayFromShifts, summarizeHours, type OpeningHours, type Shift } from '@/domain/hours';
import { getType } from '@/domain/catalog';
import { hasTag, isFoodShop } from '@/domain/tags';
import { suggestModules } from '@/domain/modules';
import { parseOfferings, toMenuItem } from '@/features/offerings/importOfferings';
import { storedUrl } from '@/lib/media';

import {
  anonClient,
  appendKey,
  describeDuplicate,
  findDuplicate,
  KEYS_FILE,
  loadKeyFile,
  loadLiveListings,
  need,
  type KnownListing,
} from './listing-lib';

const MAX_IMAGE_BYTES = 10485760; // = MAX_UPLOAD_BYTES.image in src/lib/upload.ts
const IMAGE_EXT = /\.(jpe?g|png|webp)$/i;

/* ───────────────────────────── listing.json ─────────────────────────────── */

/**
 * The listing's facts — written by hand from a map screenshot, or by
 * scripts/maps-bot.ts. Hours are "HH:MM-HH:MM", comma-separated shifts, or
 * "closed". `point` wins over a "<lat>, <lng>.png" screenshot name.
 */
interface ListingFacts {
  name?: string;
  type?: ListingType;
  tags: string[];
  tagline?: string;
  description?: string;
  phone?: string;
  location: {
    addressLine?: string;
    city?: string;
    region?: string;
    country?: string;
    point?: { latitude: number; longitude: number };
  };
  hours?: Partial<Record<'mon' | 'tue' | 'wed' | 'thu' | 'fri' | 'sat' | 'sun', string>>;
}

const DAY_KEYS = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'] as const;

function parseHours(hours: ListingFacts['hours']): OpeningHours | undefined {
  if (!hours) return undefined;
  const days = DAY_KEYS.map((key) => {
    const raw = hours[key]?.trim();
    if (!raw || /^closed$/i.test(raw)) return { closed: true };
    const shifts: Shift[] = raw.split(',').map((part) => {
      const m = /^(\d{1,2}:\d{2})\s*[-–]\s*(\d{1,2}:\d{2})$/.exec(part.trim());
      if (!m) throw new Error(`listing.json hours.${key}: "${part}" is not HH:MM-HH:MM`);
      return { open: m[1].padStart(5, '0'), close: m[2].padStart(5, '0') };
    });
    return dayFromShifts(shifts);
  });
  return { days };
}

/** "22.7307, 75.9024.png" → the pin. */
function pointFromFolder(dir: string): { latitude: number; longitude: number } | undefined {
  for (const f of readdirSync(dir)) {
    const m = /^\s*(-?\d+(?:\.\d+)?)\s*,\s*(-?\d+(?:\.\d+)?)\s*\.\w+$/.exec(f);
    if (m) return { latitude: Number(m[1]), longitude: Number(m[2]) };
  }
  return undefined;
}

/* ───────────────────────────── uploads ──────────────────────────────────── */

/** Node twin of src/lib/cloudinary.ts — sign at the edge function, POST straight to Cloudinary. */
async function uploadImage(sb: SupabaseClient, file: string): Promise<string> {
  const bytes = statSync(file).size;
  if (bytes > MAX_IMAGE_BYTES) {
    throw new Error(`${basename(file)} is ${Math.round(bytes / 1048576)} MB — keep photos under 10 MB.`);
  }
  const ext = extname(file).slice(1).toLowerCase().replace('jpeg', 'jpg');
  const contentType = ext === 'jpg' ? 'image/jpeg' : `image/${ext}`;

  const { data, error } = await sb.functions.invoke('cloudinary-sign', { body: { kind: 'image', ext, bytes } });
  if (error) {
    const body = await (error as { context?: Response }).context?.json?.().catch(() => null);
    throw new Error(`cloudinary-sign: ${body?.error ?? error.message}`);
  }
  const sig = data as {
    apiKey: string; timestamp: string; signature: string; publicId: string;
    uploadPreset: string; transformation?: string; uploadUrl: string;
  };

  const form = new FormData();
  form.append('file', new Blob([readFileSync(file)], { type: contentType }), `${sig.publicId.split('/').pop()}.${ext}`);
  form.append('api_key', sig.apiKey);
  form.append('timestamp', sig.timestamp);
  form.append('signature', sig.signature);
  form.append('public_id', sig.publicId);
  form.append('upload_preset', sig.uploadPreset);
  if (sig.transformation) form.append('transformation', sig.transformation);

  const res = await fetch(sig.uploadUrl, { method: 'POST', body: form });
  const body = (await res.json().catch(() => null)) as { secure_url?: string; error?: { message?: string } } | null;
  if (!res.ok || !body?.secure_url) {
    throw new Error(`Cloudinary refused ${basename(file)}: ${body?.error?.message ?? res.status}`);
  }
  return storedUrl(body.secure_url, 'image');
}

/* ───────────────────────────── sign-in ──────────────────────────────────── */

/** Mirrors src/data/supabase/auth.ts: `<login>@localo.app`, then the phone lookup RPC. */
async function signIn(sb: SupabaseClient): Promise<string> {
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

/* ───────────────────────────── one folder ───────────────────────────────── */

interface RunOptions {
  dryRun: boolean;
  /**
   * Unattended mode (the /start-listing loop): publish only what needs no human
   * judgement. A folder whose menu is still being read, whose name is a near
   * miss of a live listing, or whose Maps page loaded only partly is HELD —
   * left in place, untouched, for a person.
   */
  auto: boolean;
  /** Keep a folder after publishing it (default: delete — its key is kept instead). */
  keep: boolean;
  keysFile: string;
  /** Live listings + the key file: what the duplicate key checks against. */
  known: KnownListing[];
}

/**
 * A published (or duplicate) folder has done its job once its key is in the
 * key file — remove it. Only ever called after the insert AND the key write
 * succeeded; `listing.result.json` stays behind if the delete itself fails.
 */
function retire(dir: string, opts: RunOptions) {
  if (opts.keep) return;
  try {
    rmSync(dir, { recursive: true, force: true });
    console.log('   🗑 folder removed (key saved)');
  } catch (e) {
    console.log(`   folder not removed: ${e instanceof Error ? e.message : e}`);
  }
}

export type FolderOutcome = 'published' | 'duplicate' | 'held' | 'skipped' | 'dry-run';

/** Why an unattended run must leave this folder for a person — empty when it's safe. */
function holdReasons(dir: string, dup: ReturnType<typeof findDuplicate>): string[] {
  const files = readdirSync(dir);
  const reasons: string[] = [];
  if (files.some((f) => /^menu \d+\./i.test(f)) && !files.includes('menu.json')) reasons.push('menu pending');
  if (dup?.kind === 'near') reasons.push('similar name nearby');
  const review = files.includes('review.txt') ? readFileSync(join(dir, 'review.txt'), 'utf8') : '';
  if (/basics missing/.test(review)) reasons.push('Maps page did not load (no address/pin)');
  if (/hours incomplete/.test(review)) reasons.push('opening hours incomplete');
  return reasons;
}

async function listFolder(sb: SupabaseClient | null, ownerId: string, dir: string, opts: RunOptions): Promise<FolderOutcome> {
  const { dryRun, known } = opts;
  const name0 = basename(dir);
  console.log(`\n━━ ${name0}`);

  if (existsSync(join(dir, 'listing.result.json'))) {
    console.log('   already listed (listing.result.json exists) — skipped');
    return 'skipped';
  }
  const factsFile = join(dir, 'listing.json');
  if (!existsSync(factsFile)) throw new Error('no listing.json in the folder');
  const facts = JSON.parse(readFileSync(factsFile, 'utf8')) as ListingFacts;
  const name = facts.name?.trim() || name0;
  const type: ListingType = facts.type ?? 'shop';
  const tags = facts.tags ?? [];

  // Menu — the wizard's own parser, so it files exactly like a paste.
  let menu: MenuItem[] | undefined;
  const menuFile = join(dir, 'menu.json');
  if (existsSync(menuFile)) {
    const summary = parseOfferings(readFileSync(menuFile, 'utf8'));
    menu = summary.rows.map(toMenuItem);
  }
  if (menu && !isFoodShop(tags)) throw new Error('menu.json present but the tags are not a food shop');

  const point = facts.location.point ?? pointFromFolder(dir);
  if (!point) throw new Error('no map pin — set location.point in listing.json or add a "<lat>, <lng>.png" screenshot');
  const location: BusinessLocation = {
    kind: 'office',
    isHome: false,
    hidePreciseLocation: false,
    addressLine: facts.location.addressLine,
    city: facts.location.city,
    region: facts.location.region,
    country: facts.location.country ?? 'India',
    point,
  };
  const openingHours = parseHours(facts.hours);

  const files = readdirSync(dir);
  const cover = files.find((f) => /^cover\.(jpe?g|png|webp)$/i.test(f));
  const showcase = files
    .filter((f) => /^\d+\.\w+$/.test(f) && IMAGE_EXT.test(f))
    .sort((a, b) => parseInt(a, 10) - parseInt(b, 10));

  // ── summary ──
  console.log(`   name      ${name}  (${type})`);
  console.log(`   tags      ${tags.join(', ')}`);
  console.log(`   address   ${[location.addressLine, location.city, location.region].filter(Boolean).join(', ')}`);
  console.log(`   pin       ${point.latitude}, ${point.longitude}`);
  console.log(`   hours     ${openingHours ? summarizeHours(openingHours) : '—'}`);
  if (openingHours) {
    openingHours.days.forEach((d, i) =>
      console.log(`             ${DAY_LABELS[i]}  ${d.closed ? 'closed' : (d.shifts ?? []).map((s) => `${s.open}–${s.close}`).join(', ')}`),
    );
  }
  if (menu) {
    const bySection = new Map<string, number>();
    for (const m of menu) bySection.set(m.category ?? '(none)', (bySection.get(m.category ?? '(none)') ?? 0) + 1);
    console.log(`   menu      ${menu.length} items`);
    for (const [s, n] of bySection) console.log(`             ${s}: ${n}`);
  } else console.log('   menu      —');
  console.log(`   cover     ${cover ?? '—'}`);
  console.log(`   showcase  ${showcase.length ? showcase.join(', ') : '—'}`);

  // The duplicate key — same normalised name + pin within 150 m — against every
  // live listing, whoever owns it now. A chain's other branch is far enough
  // away to pass; the same café under a new folder name or owner is not.
  const dup = findDuplicate(name, point, known);
  if (dup) console.log(`   ⚠ ${describeDuplicate(dup)}`);

  if (opts.auto && dup?.kind !== 'duplicate') {
    const reasons = holdReasons(dir, dup);
    if (reasons.length) {
      console.log(`   ⏸ held for a person: ${reasons.join(', ')}`);
      return 'held';
    }
  }

  if (dryRun || !sb) {
    console.log(`   (dry run — nothing uploaded or published${dup?.kind === 'duplicate' ? '; would be SKIPPED as a duplicate' : ''})`);
    return 'dry-run';
  }
  if (dup?.kind === 'duplicate') {
    // Remember the answer so a re-run doesn't ask again.
    appendKey(
      { name, type, latitude: point.latitude, longitude: point.longitude, id: dup.of.ref, status: 'duplicate', duplicateOf: dup.of.ref },
      opts.keysFile,
    );
    writeFileSync(
      join(dir, 'listing.result.json'),
      JSON.stringify({ duplicateOf: dup.of.ref, name: dup.of.name, metres: dup.metres, checkedAt: new Date().toISOString() }, null, 2),
    );
    console.log(`   already live as ${dup.of.ref} — skipped`);
    retire(dir, opts);
    return 'duplicate';
  }

  // ── uploads ──
  const coverImageUrl = cover ? await uploadImage(sb, join(dir, cover)) : undefined;
  if (cover) console.log(`   ↑ ${cover}`);
  if (menu) {
    // Dish photos the collector saved beside the menu ("photo": "dishes/3.jpg").
    // A photo that isn't a local file is dropped: nothing should hot-link a
    // third-party site.
    let dishes = 0;
    const withPhoto = menu.filter((m) => m.imageUrl);
    for (let i = 0; i < withPhoto.length; i += 4) {
      // 4 uploads at a time: a café can have 100+ dish photos.
      await Promise.all(
        withPhoto.slice(i, i + 4).map(async (m) => {
          const file = join(dir, m.imageUrl!);
          if (!/^https?:/i.test(m.imageUrl!) && existsSync(file)) {
            m.imageUrl = await uploadImage(sb, file).catch(() => undefined);
            if (m.imageUrl) dishes++;
          } else m.imageUrl = undefined;
        }),
      );
    }
    if (dishes) console.log(`   ↑ ${dishes} dish photo(s)`);
  }
  const portfolio: PortfolioItem[] = [];
  for (const f of showcase) {
    portfolio.push({ id: randomUUID(), kind: 'photo', url: await uploadImage(sb, join(dir, f)), createdAt: new Date().toISOString() });
    console.log(`   ↑ ${f}`);
  }

  // ── the row, shaped exactly like businesses.create ──
  const id = randomUUID();
  const business: Business = {
    id,
    ownerId,
    name,
    tagline: facts.tagline,
    description: facts.description,
    type,
    subcategoryId: getType(type)?.subcategories.find((s) => hasTag(tags, s.name))?.id,
    tags: tags.length ? tags : undefined,
    coverImageUrl,
    location,
    phone: facts.phone,
    menu,
    openingHours,
    hours: summarizeHours(openingHours),
    modules: suggestModules({ type, tags, hasMenu: !!menu?.length }),
    portfolio: portfolio.length ? portfolio : undefined,
    employeeIds: [],
    callHandlerIds: [],
    ownerHandlesCalls: true,
    chatRecipientIds: [],
    createdAt: new Date().toISOString(),
  };
  // Drop undefined keys so the jsonb document matches what supabase-js writes from the app.
  const data = JSON.parse(JSON.stringify(business));
  const { error } = await sb.from('businesses').insert({ id, owner_id: ownerId, type, data });
  if (error) throw error;

  writeFileSync(
    join(dir, 'listing.result.json'),
    JSON.stringify({ id, name, coverImageUrl, portfolio: portfolio.map((p) => p.url), listedAt: business.createdAt }, null, 2),
  );
  appendKey({ name, type, latitude: point.latitude, longitude: point.longitude, id, status: 'published' }, opts.keysFile);
  // Two folders for the same café in one batch: the second must see the first.
  known.push({ ref: id, name, point });
  console.log(`   ✔ published — id ${id}  (/business/${id})`);
  retire(dir, opts);
  return 'published';
}

/* ───────────────────────────── summary ──────────────────────────────────── */

/** One line per unpublished folder — the "ready to publish?" report. */
function summarize(dirs: string[], live: KnownListing[]) {
  const rows: string[] = [];
  for (const dir of dirs) {
    if (existsSync(join(dir, 'listing.result.json'))) continue;
    const name = basename(dir);
    if (!existsSync(join(dir, 'listing.json'))) {
      rows.push(`✖ ${name} — no listing.json`);
      continue;
    }
    try {
      const facts = JSON.parse(readFileSync(join(dir, 'listing.json'), 'utf8')) as ListingFacts;
      const days = Object.values(facts.hours ?? {}).filter(Boolean).length;
      let menu = 'no menu';
      if (existsSync(join(dir, 'menu.json'))) {
        menu = `${parseOfferings(readFileSync(join(dir, 'menu.json'), 'utf8')).rows.length} items`;
      } else if (readdirSync(dir).some((f) => /^menu \d+\./i.test(f))) menu = 'MENU PENDING (photos waiting)';
      const cover = readdirSync(dir).some((f) => /^cover\./i.test(f)) ? 'cover' : 'NO COVER';
      const pin = facts.location.point || pointFromFolder(dir) ? '' : ' · NO PIN';
      rows.push(`• ${facts.name ?? name} — ${facts.tags.join('/')} · ${days}/7 days · ${menu} · ${cover}${pin}`);
      const dup = findDuplicate(facts.name ?? name, facts.location.point ?? pointFromFolder(dir), live);
      if (dup) rows.push(`    ⚠ ${describeDuplicate(dup)}`);
      if (existsSync(join(dir, 'review.txt'))) {
        for (const line of readFileSync(join(dir, 'review.txt'), 'utf8').split(/\r?\n/).filter(Boolean)) {
          rows.push(`    ⚠ ${line.length > 160 ? `${line.slice(0, 160)}…` : line}`);
        }
      }
    } catch (e) {
      rows.push(`✖ ${name} — ${e instanceof Error ? e.message : e}`);
    }
  }
  console.log(rows.length ? rows.join('\n') : 'Nothing waiting to publish.');
}

/* ───────────────────────────── main ─────────────────────────────────────── */

export interface PublishResult {
  published: number;
  duplicate: number;
  held: number;
  failed: number;
}

/**
 * Publish every ready folder under `target` (or `target` itself). The CLI below
 * and the /start-listing loop (scripts/listing-loop.ts) both come through here.
 */
export async function publish(
  target: string,
  flags: { dryRun?: boolean; auto?: boolean; keep?: boolean; keysFile?: string } = {},
): Promise<PublishResult> {
  const result: PublishResult = { published: 0, duplicate: 0, held: 0, failed: 0 };
  if (!existsSync(target)) return result;
  const dryRun = !!flags.dryRun;
  const keysFile = flags.keysFile ?? KEYS_FILE;

  // A folder with a listing.json is one business; otherwise every sub-folder is.
  const dirs = existsSync(join(target, 'listing.json'))
    ? [target]
    : readdirSync(target).map((d) => join(target, d)).filter((d) => statSync(d).isDirectory());
  if (!dirs.length) return result;

  let sb: SupabaseClient | null = null;
  let ownerId = '(dry run)';
  if (!dryRun) {
    sb = createClient(need('EXPO_PUBLIC_SUPABASE_URL'), need('EXPO_PUBLIC_SUPABASE_ANON_KEY'), {
      auth: { persistSession: false, autoRefreshToken: false },
    });
    ownerId = await signIn(sb);
    console.log(`signed in as ${ownerId}`);
  }

  // Everything already live (any owner) + everything in the key file — the
  // duplicate key checks against both.
  const known = [...(await loadLiveListings(sb ?? anonClient())), ...loadKeyFile(keysFile)];
  const opts: RunOptions = { dryRun, auto: !!flags.auto, keep: !!flags.keep, keysFile, known };

  for (const dir of dirs) {
    try {
      const outcome = await listFolder(sb, ownerId, dir, opts);
      if (outcome === 'published') result.published++;
      else if (outcome === 'duplicate') result.duplicate++;
      else if (outcome === 'held') result.held++;
    } catch (e) {
      result.failed++;
      console.error(`   ✖ ${e instanceof Error ? e.message : e}`);
    }
  }
  if (sb) await sb.auth.signOut({ scope: 'local' });
  return result;
}

async function main() {
  const args = process.argv.slice(2);
  const target = args.find((a, i) => !a.startsWith('--') && args[i - 1] !== '--keys');
  if (!target) throw new Error('Usage: npx tsx scripts/list-business.ts <folder> [--dry-run | --summary | --auto] [--keep]');
  const keysFile = args.includes('--keys') ? args[args.indexOf('--keys') + 1] : KEYS_FILE;

  if (args.includes('--summary')) {
    const dirs = existsSync(join(target, 'listing.json'))
      ? [target]
      : readdirSync(target).map((d) => join(target, d)).filter((d) => statSync(d).isDirectory());
    return summarize(dirs, [...(await loadLiveListings(anonClient())), ...loadKeyFile(keysFile)]);
  }
  const r = await publish(target, {
    dryRun: args.includes('--dry-run'),
    auto: args.includes('--auto'),
    keep: args.includes('--keep'),
    keysFile,
  });
  console.log(`\npublished ${r.published} · duplicates ${r.duplicate} · held ${r.held} · failed ${r.failed}`);
  if (r.failed) process.exitCode = 1;
}

if (process.argv[1] && /list-business/.test(process.argv[1])) {
  main().catch((e) => {
    console.error(e instanceof Error ? e.message : e);
    process.exit(1);
  });
}

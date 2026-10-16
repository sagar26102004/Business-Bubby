/// <reference types="node" />
/**
 * READY — the merged file → publish folders for list-business.ts.
 *
 *   npx tsx scripts/build-ready.ts [--tags "Gym,Salon"] [--limit 50] [--no-photos] [--root E:\listing]
 *
 * Reads E:\listing\merged\businesses.json (scripts/merge-listings.ts) and, for
 * every business that is `publishable`, writes
 *
 *   E:\listing\ready\<first tag>\<name>\listing.json   (the shape list-business.ts reads)
 *   E:\listing\ready\<first tag>\<name>\cover.jpg      (the best photo, full size)
 *
 * then: npx tsx scripts/list-business.ts "E:\listing\ready\Gym" --summary / --dry-run / --auto
 *
 * The publisher's own checks still run on every folder (duplicate key against
 * every live listing, owner account, "Listing inactive"), so nothing here can
 * list a place twice. A folder already in ready\ is left alone, and anything
 * the publisher has listed is in the key file, which the next merge reads.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { LISTING_ROOT, cleanName, findDuplicate, folderName, loadKeyFile } from './listing-lib';
import { download, sized } from './maps-bot';

/** Cover width: sharp on any phone, about a third of the bytes of Google's 1600 px. */
const COVER_WIDTH = 1000;
import type { MergedBusiness } from './merge-listings';

function arg(name: string, fallback?: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : fallback;
}

/** +919876543210 → "+91 9876543210" (the format the register wizard stores). */
const displayPhone = (p: string) => (/^\+91\d{10}$/.test(p) ? `+91 ${p.slice(3)}` : p);

export function listingFacts(m: MergedBusiness) {
  return {
    name: cleanName(m.name),
    type: m.type,
    tags: m.tags,
    description: m.description,
    phone: m.phones[0] ? displayPhone(m.phones[0]) : undefined,
    email: m.emails[0],
    // A Google short link (g.co/kgs/…) is Google's page about the place, not its website.
    website: m.website && !/^https?:\/\/(g\.co|goo\.gl|maps\.app\.goo\.gl)\//i.test(m.website) ? m.website : undefined,
    socials: m.socials && Object.keys(m.socials).length ? m.socials : undefined,
    location: {
      addressLine: [m.addressLine, m.pinCode].filter(Boolean).join(', ') || m.address,
      city: m.city,
      region: m.region,
      country: 'India',
      point: m.point,
    },
    hours: m.hours,
    source: {
      merged: m.id,
      sources: m.sources.map((s) => ({ source: s.source, id: s.sourceId, url: s.sourceUrl })),
      otherPhones: m.phones.slice(1).map(displayPhone),
      otherEmails: m.emails.slice(1),
      categories: m.categories,
    },
  };
}

export interface BuildOptions {
  root?: string;
  tags?: string[];
  limit?: number;
  photos?: boolean;
  /** Businesses already handled this run (published, duplicate or failed) — never rebuilt. */
  skipIds?: Set<string>;
  /** The merged file, already read (the publish loop reads it once). */
  all?: MergedBusiness[];
}

/**
 * Make up to `limit` ready folders. Anything whose key is already in the
 * published-keys file is skipped, so a published (and deleted) folder is never
 * rebuilt. Businesses with a phone go first — they're the ones outreach can reach.
 * Returns the merged ids it made folders for.
 */
export async function buildReady(opts: BuildOptions = {}): Promise<string[]> {
  const root = opts.root ?? LISTING_ROOT;
  const all = opts.all ?? readMerged(root);
  const wantTags = opts.tags?.map((t) => t.toLowerCase());
  const limit = opts.limit || Infinity;
  const photos = opts.photos !== false;
  const keys = loadKeyFile();
  const listedAlready = (m: MergedBusiness) => findDuplicate(m.name, m.point, keys)?.kind === 'duplicate';

  const picked = all
    .filter((m) => m.publishable && !opts.skipIds?.has(m.id) && (!wantTags || m.tags.some((t) => wantTags.includes(t.toLowerCase()))))
    .sort((a, b) => Number(b.phones.length > 0) - Number(a.phones.length > 0));
  const ids: string[] = [];

  let made = 0;
  let skipped = 0;
  for (const m of picked) {
    if (made >= limit) break;
    if (listedAlready(m)) {
      opts.skipIds?.add(m.id);
      skipped++;
      continue;
    }
    const group = join(root, 'ready', folderName(m.tags[0]));
    let dir = join(group, folderName(m.name));
    // Two branches with one name ("Gupta Clinic") get the locality, then the id, to tell them apart.
    if (existsSync(dir)) {
      const prev = JSON.parse(readFileSync(join(dir, 'listing.json'), 'utf8')) as { source?: { merged?: string } };
      if (prev.source?.merged === m.id) {
        skipped++;
        continue;
      }
      dir = join(group, folderName(`${m.name} - ${m.locality ?? m.id.slice(2, 8)}`));
      if (existsSync(dir)) dir = join(group, folderName(`${m.name} - ${m.id.slice(2, 10)}`));
      if (existsSync(dir)) {
        skipped++;
        continue;
      }
    }
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, 'listing.json'), JSON.stringify(listingFacts(m), null, 2));
    let cover = '';
    if (photos && m.photos[0]) {
      // Try each photo until one downloads — a dead link shouldn't leave a listing without one.
      cover = ' (no photo would download)';
      for (const url of m.photos.slice(0, 4)) {
        const src = url.includes('googleusercontent') ? sized(url, COVER_WIDTH) : url;
        if (await download(src, join(dir, 'cover')).catch(() => null)) {
          cover = ' + cover';
          break;
        }
      }
    }
    made++;
    ids.push(m.id);
    opts.skipIds?.add(m.id);
    console.log(`  ${m.tags[0]} › ${m.name}${cover}`);
  }
  console.log(`${made} folder(s) made under ${join(root, 'ready')}${skipped ? `, ${skipped} skipped (already there or already published)` : ''}.`);
  return ids;
}

export function readMerged(root = LISTING_ROOT): MergedBusiness[] {
  const file = join(root, 'merged', 'businesses.json');
  if (!existsSync(file)) throw new Error(`No ${file} — run scripts/merge-listings.ts first.`);
  return JSON.parse(readFileSync(file, 'utf8')) as MergedBusiness[];
}

async function main() {
  const root = arg('root', LISTING_ROOT)!;
  const all = readMerged(root);
  const tags = arg('tags')?.split(',').map((t) => t.trim()).filter(Boolean);
  console.log(`${all.filter((m) => m.publishable).length} publishable of ${all.length} merged${tags ? ` (tags ${tags.join(', ')})` : ''}`);
  await buildReady({ root, all, tags, limit: Number(arg('limit', '0')) || undefined, photos: !process.argv.includes('--no-photos') });
  console.log(`Next: npx tsx scripts/list-business.ts "${join(root, 'ready', '<tag>')}" --summary`);
}

if (process.argv[1] && /build-ready/.test(process.argv[1])) {
  main().catch((e) => {
    console.error(e);
    process.exit(1);
  });
}

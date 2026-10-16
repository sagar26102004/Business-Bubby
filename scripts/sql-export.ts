/// <reference types="node" />
/**
 * SQL EXPORT — the merged file → plain INSERT statements, run once in bulk.
 *
 *   npx tsx scripts/sql-export.ts [--no-photo-too] [--batch 1000] [--root E:\listing]
 *
 * Instead of publishing one by one (an owner account each, a sign-up and an
 * API round trip per listing — Supabase free-plan MAU and rate limits), every
 * publishable business becomes one row of an INSERT, owned by the super-admin
 * (Sagar's own account, the platform admin). No accounts are created; a
 * listing can be handed to its real owner later from the admin desk.
 *
 * Writes E:\listing\sql\:
 *   part-001.sql …       one transaction per file, `--batch` rows each (≈2 MB) —
 *                        small enough for the SQL editor, or run them all with
 *   run-all.ps1          npx supabase db query --linked -f <file>, in order, stopping at the first error
 *   manifest.json        merged id → business id, name, tags (what went in)
 *
 * Covers are the photo's own link (Google / Magicpin), not a Cloudinary upload:
 * no upload credits, no storage, no egress of ours. lib/media.ts leaves a
 * non-Cloudinary URL untouched, so the app and website show it as it is.
 *
 * Safe to re-run: ids are derived from the merged id, every statement is
 * `on conflict (id) do nothing`, so running a part twice adds nothing. The
 * merge already left out everything on One Place (live listings + key file).
 *
 * --no-photo-too also writes, separately (extra-001.sql …), the businesses held
 * ONLY for lacking a photo that do have a phone — run those only if wanted.
 */
import { createHash } from 'node:crypto';
import { mkdirSync, readdirSync, rmSync, writeFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { LISTING_ROOT } from './listing-lib';
import { businessDocument, type ListingFacts } from './list-business';
import { listingFacts, readMerged } from './build-ready';
import { sized } from './maps-bot';
import type { MergedBusiness } from './merge-listings';

/** The super-admin (username "sagar", in platform_admins) — owner of every bulk row. */
const SUPER_ADMIN_ID = '55601dcb-22df-42e8-948b-f2a5127bfa09';
/** Cover width for Google photos: sharp on a phone, ~165 KB (1000 px is ~220 KB; the app
 * can't shrink a non-Cloudinary photo for a card, so this is what every card loads). */
const COVER_WIDTH = 800;

function arg(name: string, fallback?: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : fallback;
}

/** A stable uuid from the merged id, so re-running the export gives the same rows. */
function uuidFrom(mergedId: string): string {
  const h = createHash('sha1').update(`localo-bulk:${mergedId}`).digest('hex');
  // Version 5 / RFC 4122 variant bits, like uuidv5.
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-5${h.slice(13, 16)}-${((parseInt(h[16], 16) & 3) | 8).toString(16)}${h.slice(17, 20)}-${h.slice(20, 32)}`;
}

const cover = (m: MergedBusiness): string | undefined => {
  // Some Google links come as http:// — the same file is served over https.
  const url = m.photos.map((p) => p.replace(/^http:\/\/(lh\d\.googleusercontent\.com)/, 'https://$1')).find((p) => /^https:\/\//.test(p));
  if (!url) return undefined;
  return url.includes('googleusercontent') ? sized(url, COVER_WIDTH) : url;
};

/** A SQL string literal: standard_conforming_strings is on, so only ' needs doubling. */
const lit = (s: string) => `'${s.replace(/'/g, "''")}'`;

interface Row {
  mergedId: string;
  id: string;
  name: string;
  tags: string[];
  sql: string;
}

function row(m: MergedBusiness, createdAt: string): Row {
  const id = uuidFrom(m.id);
  const facts = listingFacts(m) as ListingFacts;
  const doc = businessDocument(facts, { id, ownerId: SUPER_ADMIN_ID, coverImageUrl: cover(m), createdAt });
  const json = JSON.stringify(doc);
  return {
    mergedId: m.id,
    id,
    name: doc.name,
    tags: m.tags,
    sql: `(${lit(id)}, ${lit(SUPER_ADMIN_ID)}, ${lit(doc.type)}, ${lit(json)}::jsonb)`,
  };
}

function writeParts(dir: string, prefix: string, rows: Row[], batch: number): string[] {
  const files: string[] = [];
  for (let i = 0; i < rows.length; i += batch) {
    const chunk = rows.slice(i, i + batch);
    const file = join(dir, `${prefix}-${String(files.length + 1).padStart(3, '0')}.sql`);
    writeFileSync(
      file,
      `-- ${chunk.length} businesses (${i + 1}–${i + chunk.length} of ${rows.length}), owner = super-admin\n` +
        `begin;\n` +
        `insert into public.businesses (id, owner_id, type, data) values\n` +
        chunk.map((r) => r.sql).join(',\n') +
        `\non conflict (id) do nothing;\ncommit;\n`,
    );
    files.push(file);
  }
  return files;
}

function main() {
  const root = arg('root', LISTING_ROOT)!;
  const batch = Number(arg('batch', '1000')) || 1000;
  const all = readMerged(root);
  const createdAt = new Date().toISOString();

  const main = all.filter((m) => m.publishable);
  const extra = process.argv.includes('--no-photo-too')
    ? all.filter((m) => !m.publishable && m.phones.length && m.holdReasons.length > 0 && m.holdReasons.every((r) => /photo/.test(r)))
    : [];
  // Businesses with a phone first, then by how well-known they are.
  const order = (a: MergedBusiness, b: MergedBusiness) =>
    Number(b.phones.length > 0) - Number(a.phones.length > 0) || (b.reviewCount ?? 0) - (a.reviewCount ?? 0);
  main.sort(order);
  extra.sort(order);

  const dir = join(root, 'sql');
  if (existsSync(dir)) for (const f of readdirSync(dir)) if (/\.(sql|json|ps1)$/.test(f)) rmSync(join(dir, f));
  mkdirSync(dir, { recursive: true });

  const seen = new Set<string>();
  const toRows = (list: MergedBusiness[]) =>
    list.flatMap((m) => {
      const r = row(m, createdAt);
      if (seen.has(r.id)) return [];
      seen.add(r.id);
      return [r];
    });
  const mainRows = toRows(main);
  const extraRows = toRows(extra);
  const mainFiles = writeParts(dir, 'part', mainRows, batch);
  const extraFiles = writeParts(dir, 'extra', extraRows, batch);

  writeFileSync(
    join(dir, 'manifest.json'),
    JSON.stringify(
      [...mainRows.map((r) => ({ ...r, set: 'main' })), ...extraRows.map((r) => ({ ...r, set: 'extra' }))].map(({ sql: _sql, ...r }) => r),
      null,
      1,
    ),
  );
  // One runner: every part in order through the linked project, stopping at the first failure.
  const runner = (files: string[]) =>
    files.map((f) => `Write-Host "${f}"; npx supabase db query --linked -f "${f}" | Out-Null; if (-not $?) { Write-Host "FAILED at ${f}"; exit 1 }`).join('\n');
  writeFileSync(
    join(dir, 'run-all.ps1'),
    `# Inserts every part-*.sql into the live database (run from D:\\WorkSpace). Safe to re-run.\n${runner(mainFiles)}\nWrite-Host "Done: ${mainRows.length} businesses."\n`,
  );
  if (extraFiles.length)
    writeFileSync(join(dir, 'run-extra.ps1'), `# The no-photo set (has a phone). Optional.\n${runner(extraFiles)}\nWrite-Host "Done: ${extraRows.length} businesses."\n`);

  const withPhone = mainRows.length ? main.filter((m) => m.phones.length).length : 0;
  console.log(`${mainRows.length} businesses → ${mainFiles.length} file(s) in ${dir} (${withPhone} with a phone)`);
  if (extraFiles.length) console.log(`${extraRows.length} no-photo businesses with a phone → ${extraFiles.length} extra file(s)`);
}

main();

/// <reference types="node" />
/**
 * FINAL SHEET — every bulk-published listing, with everything we know about it,
 * as one Excel workbook for calling businesses one by one.
 *
 *   npx tsx scripts/export-final-sheet.ts [--out E:\listing\final\businesses.xlsx]
 *
 * Rows = every listing in the owner-accounts registry (E:\listing\shared\owner-accounts.json),
 * read live from Supabase, enriched from the merged file (rating, reviews,
 * other phones, Google Maps link). Most complete first — phone + map pin + cover
 * photo + hours — because those are the businesses worth calling first.
 *
 * Your own columns — Contacted?, Contacted on, Result (Pass/Fail), Notes — are
 * carried over by listing id every time this is re-run, so re-run it freely after
 * more publishing. Close the file in Excel first (Windows locks an open workbook).
 */
import ExcelJS from 'exceljs';
import { existsSync, mkdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import type { GeoPoint } from '@/domain/types';
import { haversineKm } from '@/lib/geo';
import { LISTING_ROOT, OWNER_PASSWORD, anonClient, normName, readOwnerAccounts } from './listing-lib';
import type { MergedBusiness } from './merge-listings';

function arg(name: string, fallback?: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : fallback;
}

const OUT = arg('out', join(LISTING_ROOT, 'final', 'businesses.xlsx'))!;
const WEBSITE = 'https://oneplace-website.vercel.app';
const FONT = 'Arial';
const SHEET = 'Businesses';

interface Live {
  id: string;
  name: string;
  tags?: string[];
  phone?: string;
  email?: string;
  website?: string;
  location?: { addressLine?: string; city?: string; point?: GeoPoint };
  cover?: string;
  hours?: string;
  active?: string | boolean;
  links?: { url: string; kind?: string }[];
  createdAt?: string;
}

async function loadLive(ids: string[]): Promise<Live[]> {
  const sb = anonClient();
  const out: Live[] = [];
  for (let i = 0; i < ids.length; i += 200) {
    const { data, error } = await sb
      .from('businesses')
      .select(
        'id, name:data->>name, tags:data->tags, phone:data->>phone, email:data->>email, website:data->>website, ' +
          'location:data->location, cover:data->>coverImageUrl, hours:data->>hours, active:data->>listingActive, ' +
          'links:data->showcaseLinks, createdAt:data->>createdAt',
      )
      .in('id', ids.slice(i, i + 200));
    if (error) throw error;
    out.push(...((data ?? []) as unknown as Live[]));
  }
  return out;
}

const digits = (p?: string) => {
  const d = (p ?? '').replace(/\D/g, '');
  return d.length >= 10 ? d.slice(-10) : '';
};

/**
 * Indian mobiles start 6–9 — but an Indore landline (0731 …) is stored as
 * "+91 731…", which also starts with 7, so 731 counts as a landline.
 */
const isMobile = (d: string) => /^[6-9]\d{9}$/.test(d) && !d.startsWith('731');

/** Find a live listing's merged record: same phone nearby, or same name within 150 m. */
function enricher(merged: MergedBusiness[]) {
  const byPhone = new Map<string, MergedBusiness[]>();
  const byName = new Map<string, MergedBusiness[]>();
  const byListed = new Map<string, MergedBusiness>();
  for (const m of merged) {
    if (m.alreadyListed?.id) byListed.set(m.alreadyListed.id, m);
    for (const p of m.phones) {
      const d = digits(p);
      if (d) byPhone.set(d, [...(byPhone.get(d) ?? []), m]);
    }
    const k = normName(m.name);
    if (k) byName.set(k, [...(byName.get(k) ?? []), m]);
  }
  const near = (m: MergedBusiness, pt?: GeoPoint, km = 0.15) => !!(pt && m.point && haversineKm(pt, m.point) <= km);
  return (b: Live): MergedBusiness | undefined => {
    const pt = b.location?.point;
    return (
      byListed.get(b.id) ??
      byName.get(normName(b.name))?.find((m) => near(m, pt)) ??
      byPhone.get(digits(b.phone))?.find((m) => near(m, pt, 1))
    );
  };
}

/** The user's own columns from the last file, by listing id. */
async function readMarks(): Promise<Map<string, unknown[]>> {
  const marks = new Map<string, unknown[]>();
  if (!existsSync(OUT)) return marks;
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.readFile(OUT);
  const ws = wb.getWorksheet(SHEET);
  if (!ws) return marks;
  const head = (ws.getRow(1).values as unknown[]).map((v) => String(v ?? ''));
  const col = (h: string) => head.indexOf(h);
  const idCol = col('Listing ID');
  if (idCol < 0) return marks;
  ws.eachRow((row, n) => {
    if (n === 1) return;
    const id = String(row.getCell(idCol).value ?? '');
    if (id) marks.set(id, MARK_COLUMNS.map((h) => (col(h) >= 0 ? row.getCell(col(h)).value : null)));
  });
  return marks;
}

const MARK_COLUMNS = ['Contacted?', 'Contacted on', 'Result', 'Notes'];

async function main() {
  const owners = readOwnerAccounts();
  const ids = Object.keys(owners);
  console.log(`${ids.length} listings in the owner-accounts registry — reading them live…`);
  const live = await loadLive(ids);
  const mergedFile = join(LISTING_ROOT, 'merged', 'businesses.json');
  const merged = existsSync(mergedFile) ? (JSON.parse(readFileSync(mergedFile, 'utf8')) as MergedBusiness[]) : [];
  const find = enricher(merged);
  const marks = await readMarks();
  const marked = [...marks.values()].filter(([contacted, on, result, notes]) => contacted === 'Yes' || on || (result && result !== 'Pending') || notes).length;
  console.log(`${live.length} live · ${merged.length} merged records · ${marked} rows with your marks carried over`);

  const rows = live.map((b) => {
    const m = find(b);
    const pt = b.location?.point;
    const phone = b.phone ?? (m?.phones[0] ? `+91 ${digits(m.phones[0])}` : undefined);
    const d = digits(phone);
    const missing = [!d && 'phone', !pt && 'map pin', !b.cover && 'cover photo', !b.hours && 'hours'].filter(Boolean) as string[];
    const gmaps =
      m?.sources.find((s) => s.source === 'google-maps')?.sourceUrl ??
      (pt ? `https://www.google.com/maps/search/?api=1&query=${pt.latitude},${pt.longitude}` : undefined);
    const socials = [
      ...(b.links ?? []).map((l) => l.url),
      ...Object.values(m?.socials ?? {}).filter((v): v is string => typeof v === 'string'),
    ];
    return {
      id: b.id,
      complete: missing.length === 0,
      cells: {
        'Business name': b.name,
        Category: (b.tags ?? []).join(', '),
        Phone: phone ?? '',
        'Phone type': !d ? '' : isMobile(d) ? 'Mobile' : 'Landline',
        WhatsApp: isMobile(d) ? { text: 'Open', hyperlink: `https://wa.me/91${d}` } : '',
        'Other phones': (m?.phones ?? []).map(digits).filter((x) => x && x !== d).join(', '),
        Email: b.email ?? m?.emails[0] ?? '',
        Website: b.website ?? '',
        'Instagram / socials': [...new Set(socials)].join('  '),
        Address: b.location?.addressLine ?? m?.address ?? '',
        Area: m?.locality ?? '',
        City: b.location?.city ?? m?.city ?? '',
        'Google Maps': gmaps ? { text: 'Map', hyperlink: gmaps } : '',
        Rating: m?.rating ?? '',
        Reviews: m?.reviewCount ?? '',
        Hours: b.hours ?? '',
        'Cover photo': b.cover ? { text: 'Photo', hyperlink: b.cover } : '',
        'Info complete': missing.length ? `Missing: ${missing.join(', ')}` : 'Complete',
        'Listing status': String(b.active) === 'false' ? 'Inactive' : 'Active',
        'Owner username': owners[b.id]?.username ?? '',
        Password: OWNER_PASSWORD,
        'Page on website': { text: 'Open page', hyperlink: `${WEBSITE}/b/${b.id}` },
        'Listed on': b.createdAt ? new Date(b.createdAt) : '',
        'Contacted?': 'No',
        'Contacted on': null as unknown,
        Result: 'Pending',
        Notes: '',
        'Listing ID': b.id,
      } as Record<string, unknown>,
      reviews: m?.reviewCount ?? 0,
    };
  });
  // Complete first, then those with a phone, then the busiest (most reviews) — the best calls first.
  rows.sort(
    (a, b) =>
      Number(b.complete) - Number(a.complete) ||
      Number(!!b.cells.Phone) - Number(!!a.cells.Phone) ||
      b.reviews - a.reviews,
  );
  for (const r of rows) {
    const prev = marks.get(r.id);
    if (prev) MARK_COLUMNS.forEach((h, i) => prev[i] != null && prev[i] !== '' && (r.cells[h] = prev[i]));
  }

  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet(SHEET, { views: [{ state: 'frozen', xSplit: 1, ySplit: 1 }] });
  const widths: Record<string, number> = {
    'Business name': 34, Category: 22, Phone: 16, 'Phone type': 11, WhatsApp: 10, 'Other phones': 18, Email: 26, Website: 26,
    'Instagram / socials': 28, Address: 44, Area: 16, City: 10, 'Google Maps': 11, Rating: 8, Reviews: 9,
    Hours: 30, 'Cover photo': 11, 'Info complete': 24, 'Listing status': 13, 'Owner username': 22, Password: 11,
    'Page on website': 14, 'Listed on': 12, 'Contacted?': 12, 'Contacted on': 14, Result: 11, Notes: 40, 'Listing ID': 38,
  };
  const headers = Object.keys(rows[0]?.cells ?? widths);
  ws.columns = headers.map((h) => ({ header: h, key: h, width: widths[h] ?? 14 }));
  for (const r of rows) ws.addRow(r.cells);

  const colOf = (h: string) => headers.indexOf(h) + 1;
  const letter = (h: string) => ws.getColumn(colOf(h)).letter;
  const last = rows.length + 1;
  ws.eachRow((row, n) => {
    row.font = { name: FONT, size: 10, bold: n === 1, color: n === 1 ? { argb: 'FFFFFFFF' } : undefined };
    if (n === 1) {
      row.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF3F5E4A' } };
      row.height = 20;
    }
  });
  for (const h of ['WhatsApp', 'Google Maps', 'Cover photo', 'Page on website']) {
    ws.getColumn(colOf(h)).eachCell((c, n) => n > 1 && c.value && (c.font = { name: FONT, size: 10, color: { argb: 'FF1A5FB4' }, underline: true }));
  }
  ws.getColumn(colOf('Listed on')).numFmt = 'dd-mmm-yyyy';
  ws.getColumn(colOf('Contacted on')).numFmt = 'dd-mmm-yyyy';
  // Your columns stand out.
  for (const h of MARK_COLUMNS) {
    ws.getCell(1, colOf(h)).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFB5562F' } };
  }
  for (let n = 2; n <= last; n++) {
    ws.getCell(n, colOf('Contacted?')).dataValidation = { type: 'list', allowBlank: true, formulae: ['"Yes,No"'] };
    ws.getCell(n, colOf('Result')).dataValidation = { type: 'list', allowBlank: true, formulae: ['"Pending,Pass,Fail"'] };
    ws.getCell(n, colOf('Contacted on')).dataValidation = { type: 'date', operator: 'greaterThan', allowBlank: true, formulae: [new Date(2026, 0, 1)] };
  }
  const all = `A2:${ws.getColumn(headers.length).letter}${last}`;
  const res = `$${letter('Result')}2`;
  const con = `$${letter('Contacted?')}2`;
  ws.addConditionalFormatting({
    ref: all,
    rules: [
      { type: 'expression', priority: 1, formulae: [`${res}="Pass"`], style: { fill: { type: 'pattern', pattern: 'solid', bgColor: { argb: 'FFD8EFD9' } } } },
      { type: 'expression', priority: 2, formulae: [`${res}="Fail"`], style: { fill: { type: 'pattern', pattern: 'solid', bgColor: { argb: 'FFF6D5D2' } } } },
      { type: 'expression', priority: 3, formulae: [`${con}="Yes"`], style: { fill: { type: 'pattern', pattern: 'solid', bgColor: { argb: 'FFFFF4CE' } } } },
    ],
  });
  ws.autoFilter = { from: { row: 1, column: 1 }, to: { row: 1, column: headers.length } };

  // Summary — live formulas, so it updates as you fill in the sheet.
  const sum = wb.addWorksheet('Summary');
  sum.columns = [{ width: 34 }, { width: 14 }];
  const R = (h: string) => `${SHEET}!$${letter(h)}$2:$${letter(h)}$${last}`;
  const lines: [string, string | number][] = [
    ['Listings in this sheet', rows.length],
    ['Complete info (phone, pin, photo, hours)', `=COUNTIF(${R('Info complete')},"Complete")`],
    ['With a phone number', `=COUNTIF(${R('Phone')},"?*")`],
    ['… of them mobile (WhatsApp)', `=COUNTIF(${R('Phone type')},"Mobile")`],
    ['Active (owner has signed in)', `=COUNTIF(${R('Listing status')},"Active")`],
    ['', ''],
    ['Contacted', `=COUNTIF(${R('Contacted?')},"Yes")`],
    ['Not contacted yet', `=COUNTIF(${R('Contacted?')},"<>Yes")`],
    ['Pass (agreed to list)', `=COUNTIF(${R('Result')},"Pass")`],
    ['Fail', `=COUNTIF(${R('Result')},"Fail")`],
    ['Pass rate of those contacted', `=IFERROR(B9/B7,0)`],
    ['', ''],
    ['Exported', new Date().toLocaleString('en-IN', { hour12: false })],
    ['Shared password for every owner account', OWNER_PASSWORD],
  ];
  lines.forEach(([k, v], i) => {
    const row = sum.getRow(i + 1);
    row.getCell(1).value = k;
    row.getCell(2).value = typeof v === 'string' && v.startsWith('=') ? { formula: v.slice(1) } : v;
    row.font = { name: FONT, size: 11, bold: i === 0 };
  });
  sum.getCell('B11').numFmt = '0%';

  // By category: how many, how many complete, how many passed.
  const cats = new Map<string, number>();
  for (const r of rows) {
    const c = String(r.cells.Category).split(', ')[0] || '(none)';
    cats.set(c, (cats.get(c) ?? 0) + 1);
  }
  const start = lines.length + 2;
  sum.getRow(start).values = ['Category (first tag)', 'Listings', 'Contacted', 'Pass'];
  sum.getRow(start).font = { name: FONT, size: 11, bold: true };
  sum.getColumn(3).width = 12;
  sum.getColumn(4).width = 10;
  [...cats.entries()]
    .sort((a, b) => b[1] - a[1])
    .forEach(([c, n], i) => {
      const row = sum.getRow(start + 1 + i);
      const cat = `${SHEET}!$${letter('Category')}$2:$${letter('Category')}$${last}`;
      const like = `"${c.replace(/"/g, '""')}*"`;
      row.values = [c, n];
      row.getCell(3).value = { formula: `COUNTIFS(${cat},${like},${R('Contacted?')},"Yes")` };
      row.getCell(4).value = { formula: `COUNTIFS(${cat},${like},${R('Result')},"Pass")` };
      row.font = { name: FONT, size: 10 };
    });

  mkdirSync(dirname(OUT), { recursive: true });
  await wb.xlsx.writeFile(OUT);
  const complete = rows.filter((r) => r.complete).length;
  console.log(`Wrote ${OUT}: ${rows.length} listings, ${complete} with complete info.`);
}

main().catch((e) => {
  console.error(e instanceof Error && /EBUSY|EPERM/.test(e.message) ? `${OUT} is open in Excel — close it and run again.` : e);
  process.exit(1);
});

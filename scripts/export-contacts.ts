/// <reference types="node" />
/**
 * The outreach list: every food place the listing run has published that is
 * still INACTIVE (nobody has signed in to its owner account yet), as business
 * name + contact number + the owner's login (Username / Password columns, also
 * `{username}` / `{password}` in outreach-message.txt) + a one-tap WhatsApp
 * message about the app.
 *
 *   npx tsx scripts/export-contacts.ts --link <download link> [--out E:\listing\food-contacts.xlsx] [--all-types]
 *
 * One sheet per city — Business name · Contact number · WhatsApp ("Send" opens
 * WhatsApp with scripts/outreach-message.txt filled in) · Sent? · Notes — plus
 * "No WhatsApp" (landlines and places with no number, to call instead) and a
 * Summary. A number shared by several branches is ONE row, so nobody gets the
 * message twice. Sending stays manual: one tap per row, from your own WhatsApp.
 *
 * Re-run it after each listing run: Sent?/Notes are carried over by listing id,
 * places that weren't in the last file are marked "New", and the link is reused
 * from the last file when --link is left out. Without any link the sheet still
 * has names and numbers, just no Send column. Close the file in Excel first —
 * Windows won't let the script overwrite an open workbook. A plain
 * Business name / Contact number CSV is written next to it.
 *
 * --all-types also lists the super-admin's non-food listings (tyre shops, gyms…).
 * Credentials: LISTING_LOGIN / LISTING_PASSWORD in scripts/.listing.env, as for list-business.
 */
import ExcelJS from 'exceljs';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { BusinessLocation, GeoPoint } from '@/domain/types';
import { isFoodShop } from '@/domain/tags';
import { citiesForState } from '@/domain/geoCatalog';
import { haversineKm } from '@/lib/geo';
import { FOOD_ROOT, OWNER_PASSWORD, anonClient, readOutreachLog, readOwnerAccounts, signIn } from './listing-lib';

const DEFAULT_OUT = join(FOOD_ROOT, 'food-contacts.xlsx');
const MESSAGE_FILE = join(process.cwd(), 'scripts', 'outreach-message.txt');
const NO_WHATSAPP = 'No WhatsApp';
const LINK_LABEL = 'Download link';
const FONT = 'Arial';

interface Row {
  id: string;
  name: string;
  phone?: string;
  location?: BusinessLocation;
  tags: string[];
  /** Its owner account's username (password OWNER_PASSWORD), once it has one. */
  username?: string;
}

/** One person to message: every listing that shares a number. */
interface Contact {
  ids: string[];
  names: string[];
  /** One username per listing on the row (several branches = several logins). */
  usernames: string[];
  /** 10 digits, or '' when the listing has no number. */
  digits: string;
  city: string;
}

/**
 * Zomato-collected places carry a proper city; Google Maps ones sometimes put a
 * locality there ("56 Shop"). Those take the city named in the address or, failing
 * that, the city of the nearest place that does have one (within NEAREST_CITY_KM).
 */
const KNOWN_CITIES = citiesForState().map((c) => c.toLowerCase());
const NEAREST_CITY_KM = 40;
function namedCity(loc?: BusinessLocation): string | undefined {
  const city = loc?.city?.trim() ?? '';
  if (KNOWN_CITIES.includes(city.toLowerCase())) return city;
  const address = (loc?.addressLine ?? '').toLowerCase();
  return citiesForState().find((c) => new RegExp(`\\b${c.toLowerCase()}\\b`).test(address));
}
function assignCities(rows: Row[]): Map<Row, string> {
  const out = new Map<Row, string>();
  const placed: { point: GeoPoint; city: string }[] = [];
  for (const r of rows) {
    const city = namedCity(r.location);
    if (!city) continue;
    out.set(r, city);
    if (r.location?.point) placed.push({ point: r.location.point, city });
  }
  for (const r of rows) {
    if (out.has(r)) continue;
    const p = r.location?.point;
    const near = p && placed.map((q) => ({ city: q.city, km: haversineKm(p, q.point) })).sort((a, b) => a.km - b.km)[0];
    out.set(r, near && near.km <= NEAREST_CITY_KM ? near.city : 'Other');
  }
  return out;
}

/**
 * The run's listings: those that got their own owner account
 * (owner-accounts.json) plus any still under the super-admin — and of those,
 * only the ones still INACTIVE, i.e. nobody has signed in to them yet.
 */
async function loadListings(): Promise<Row[]> {
  const sb = anonClient();
  const adminId = await signIn(sb);
  const accounts = readOwnerAccounts();
  const out: Row[] = [];
  for (let from = 0; ; from += 1000) {
    const { data, error } = await sb
      .from('businesses')
      .select('id, owner_id, data')
      .range(from, from + 999);
    if (error) throw error;
    for (const r of data ?? []) {
      const d = r.data as Record<string, any>;
      const id = r.id as string;
      if (d.demo || d.listingActive !== false) continue;
      if (r.owner_id !== adminId && !accounts[id]) continue;
      out.push({
        id,
        name: d.name ?? '',
        phone: d.phone || undefined,
        location: d.location,
        tags: d.tags ?? [],
        username: accounts[id]?.username,
      });
    }
    if (!data || data.length < 1000) return out;
  }
}

/** Indian mobiles start 6–9; anything else (a landline) can't take WhatsApp. */
const isMobile = (digits: string) => /^[6-9]\d{9}$/.test(digits);
const showNumber = (digits: string) => (digits.length === 10 ? `${digits.slice(0, 5)} ${digits.slice(5)}` : digits);

function toContacts(rows: Row[], cityOf: Map<Row, string>): Contact[] {
  const byNumber = new Map<string, Contact>();
  const out: Contact[] = [];
  for (const r of rows) {
    const digits = (r.phone ?? '').replace(/\D/g, '').slice(-10);
    const known = digits ? byNumber.get(digits) : undefined;
    if (known) {
      known.ids.push(r.id);
      if (!known.names.includes(r.name)) known.names.push(r.name);
      if (r.username) known.usernames.push(r.username);
      continue;
    }
    const c: Contact = {
      ids: [r.id],
      names: [r.name],
      usernames: r.username ? [r.username] : [],
      digits,
      city: cityOf.get(r)!,
    };
    if (digits) byNumber.set(digits, c);
    out.push(c);
  }
  return out;
}

interface Previous {
  /** Sent?/Called? and Notes, keyed by every listing id on the row. */
  marks: Map<string, { sent: string; notes: string }>;
  link?: string;
}

const cellText = (v: ExcelJS.CellValue) => (v && typeof v === 'object' && 'text' in v ? String(v.text) : String(v ?? ''));

/** What the last export knew: the marks typed into it and the link it used. */
async function loadPrevious(path: string): Promise<Previous | null> {
  if (!existsSync(path)) return null;
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.readFile(path);
  const prev: Previous = { marks: new Map() };
  wb.eachSheet((ws) => {
    if (ws.name === 'Summary') {
      ws.eachRow((row) => {
        const value = cellText(row.getCell(2).value);
        if (cellText(row.getCell(1).value) === LINK_LABEL && /^https?:\/\//.test(value)) prev.link = value;
      });
      return;
    }
    const header = (ws.getRow(1).values as unknown[]).map((v) => String(v ?? ''));
    const id = header.indexOf('Id');
    // "Called?" is the No WhatsApp sheet's name for it, and what the first version of the city sheets used.
    const sent = header.indexOf('Sent?') >= 0 ? header.indexOf('Sent?') : header.indexOf('Called?');
    const notes = header.indexOf('Notes');
    if (id < 0) return;
    ws.eachRow((row, n) => {
      if (n === 1) return;
      const mark = {
        sent: sent >= 0 ? cellText(row.getCell(sent).value) : '',
        notes: notes >= 0 ? cellText(row.getCell(notes).value) : '',
      };
      for (const key of cellText(row.getCell(id).value).split(',')) if (key) prev.marks.set(key, mark);
    });
  });
  return prev;
}

/** {name}, {link}, and — when the message wants them — {username} / {password}. */
const whatsappUrl = (digits: string, template: string, name: string, link: string, username: string) =>
  `https://wa.me/91${digits}?text=${encodeURIComponent(
    template
      .replaceAll('{name}', name)
      .replaceAll('{link}', link)
      .replaceAll('{username}', username)
      .replaceAll('{password}', OWNER_PASSWORD)
      .trim(),
  )}`;

const loginOf = (c: { usernames: string[] }) => c.usernames.join(', ');

function styleHeader(ws: ExcelJS.Worksheet, columns: number, rows: number) {
  const head = ws.getRow(1);
  head.font = { name: FONT, bold: true, color: { argb: 'FFFFFFFF' } };
  head.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF3F5E4A' } };
  ws.autoFilter = { from: 'A1', to: { row: rows + 1, column: columns } };
}

const columnLetter = (cols: Partial<ExcelJS.Column>[], key: string) =>
  String.fromCharCode(65 + cols.findIndex((c) => c.key === key));

async function main() {
  const args = process.argv.slice(2);
  const arg = (name: string) => {
    const i = args.indexOf(`--${name}`);
    return i >= 0 ? args[i + 1] : undefined;
  };
  const out = arg('out') ?? DEFAULT_OUT;
  const allTypes = args.includes('--all-types');
  const template = readFileSync(MESSAGE_FILE, 'utf8');

  const listings = (await loadListings()).filter((r) => allTypes || isFoodShop(r.tags));
  const prev = await loadPrevious(out);
  const link = arg('link') ?? prev?.link;
  if (link && !/^https?:\/\//.test(link)) throw new Error(`--link should be a full URL (https://…), got "${link}".`);

  const contacts = toContacts(listings, assignCities(listings));
  const log = readOutreachLog();
  const typedMark = (c: Contact) => c.ids.map((id) => prev?.marks.get(id)).find(Boolean);
  /** What was typed into Sent? wins; otherwise what outreach-sender recorded. */
  const markOf = (c: Contact) => {
    const typed = typedMark(c);
    const sent = c.ids.map((id) => log[id]).find(Boolean);
    if (typed?.sent || !sent) return typed;
    return { sent: sent.status === 'sent' ? `sent ${sent.at.slice(0, 10)}` : 'skipped', notes: typed?.notes ?? '' };
  };
  const isNew = (c: Contact) => prev !== null && !typedMark(c);
  const nameOf = (c: Contact) => c.names.join(' / ');
  const byName = (a: Contact, b: Contact) => nameOf(a).localeCompare(nameOf(b));

  const whatsapp = contacts.filter((c) => isMobile(c.digits)).sort(byName);
  const others = contacts
    .filter((c) => !isMobile(c.digits))
    .sort((a, b) => Number(!a.digits) - Number(!b.digits) || byName(a, b));
  const byCity = new Map<string, Contact[]>();
  for (const c of whatsapp) byCity.set(c.city, [...(byCity.get(c.city) ?? []), c]);
  const cities = [...byCity.keys()].sort((a, b) => (a === 'Other' ? 1 : b === 'Other' ? -1 : a.localeCompare(b)));

  const wb = new ExcelJS.Workbook();
  wb.calcProperties.fullCalcOnLoad = true;
  const summary = wb.addWorksheet('Summary');

  const cityColumns: Partial<ExcelJS.Column>[] = [
    { header: 'Id', key: 'id', width: 10, hidden: true },
    { header: 'Business name', key: 'name', width: 40 },
    { header: 'Contact number', key: 'number', width: 16 },
    { header: 'Username', key: 'username', width: 22 },
    { header: 'Password', key: 'password', width: 10 },
    ...(link ? [{ header: 'WhatsApp', key: 'send', width: 11 }] : []),
    { header: 'New', key: 'isNew', width: 7 },
    { header: 'Sent?', key: 'sent', width: 10 },
    { header: 'Notes', key: 'notes', width: 40 },
  ];
  let longestUrl = 0;
  for (const city of cities) {
    const ws = wb.addWorksheet(city, { views: [{ state: 'frozen', ySplit: 1 }] });
    ws.columns = cityColumns;
    const rows = byCity.get(city)!;
    for (const c of rows) {
      const mark = markOf(c);
      const url = link ? whatsappUrl(c.digits, template, nameOf(c), link, loginOf(c)) : '';
      longestUrl = Math.max(longestUrl, url.length);
      const row = ws.addRow({
        id: c.ids.join(','),
        name: nameOf(c),
        number: showNumber(c.digits),
        username: loginOf(c),
        password: c.usernames.length ? OWNER_PASSWORD : '',
        send: url ? { text: 'Send', hyperlink: url } : undefined,
        isNew: isNew(c) ? 'New' : '',
        sent: mark?.sent ?? '',
        notes: mark?.notes ?? '',
      });
      row.font = { name: FONT };
      if (url) row.getCell('send').font = { name: FONT, color: { argb: 'FF0563C1' }, underline: true };
    }
    styleHeader(ws, cityColumns.length, rows.length);
  }

  // Landlines and missing numbers: call these instead of messaging.
  const otherColumns: Partial<ExcelJS.Column>[] = [
    { header: 'Id', key: 'id', width: 10, hidden: true },
    { header: 'Business name', key: 'name', width: 40 },
    { header: 'Contact number', key: 'number', width: 16 },
    { header: 'City', key: 'city', width: 12 },
    { header: 'Username', key: 'username', width: 22 },
    { header: 'Password', key: 'password', width: 10 },
    { header: 'New', key: 'isNew', width: 7 },
    { header: 'Called?', key: 'sent', width: 10 },
    { header: 'Notes', key: 'notes', width: 40 },
  ];
  const ows = wb.addWorksheet(NO_WHATSAPP, { views: [{ state: 'frozen', ySplit: 1 }] });
  ows.columns = otherColumns;
  for (const c of others) {
    const mark = markOf(c);
    ows.addRow({
      id: c.ids.join(','),
      name: nameOf(c),
      number: c.digits ? showNumber(c.digits) : '— no number —',
      city: c.city,
      username: loginOf(c),
      password: c.usernames.length ? OWNER_PASSWORD : '',
      isNew: isNew(c) ? 'New' : '',
      sent: mark?.sent ?? '',
      notes: mark?.notes ?? '',
    }).font = { name: FONT };
  }
  styleHeader(ows, otherColumns.length, others.length);

  summary.columns = [
    { header: 'Sheet', width: 16 },
    { header: 'Contacts', width: 11 },
    { header: 'Done', width: 9 },
    { header: 'Not done', width: 10 },
    { header: 'New', width: 8 },
  ];
  const sheets = [
    ...cities.map((c) => ({ name: c, n: byCity.get(c)!.length, cols: cityColumns })),
    { name: NO_WHATSAPP, n: others.length, cols: otherColumns },
  ];
  for (const s of sheets) {
    const range = (key: string) => `'${s.name}'!${columnLetter(s.cols, key)}2:${columnLetter(s.cols, key)}${s.n + 1}`;
    const r = summary.rowCount + 1;
    summary.addRow([
      s.name,
      { formula: `COUNTA(${range('name')})` },
      { formula: `COUNTA(${range('sent')})` },
      { formula: `B${r}-C${r}` },
      { formula: `COUNTIF(${range('isNew')},"New")` },
    ]);
  }
  const totalRow = sheets.length + 2;
  summary.addRow(['Total', ...['B', 'C', 'D', 'E'].map((c) => ({ formula: `SUM(${c}2:${c}${totalRow - 1})` }))]);
  summary.addRow([]);
  summary.addRow([LINK_LABEL, link ?? '(none yet: re-run with --link <url> to add the WhatsApp Send buttons)']);
  summary.addRow([
    `Food places published by the listing run (super-admin's listings)${allTypes ? ', all types' : ''}. ` +
      `Numbers are the ones each place shows on its public Zomato/Google page. ` +
      `Exported ${new Date().toISOString().slice(0, 10)} by scripts/export-contacts.ts.`,
  ]);
  summary.addRow([
    'Tap Send to open WhatsApp with the message ready (scripts/outreach-message.txt), send it yourself, ' +
      'then type anything in Sent? (e.g. "yes"). Sent?/Called? and Notes are kept when the script is re-run.',
  ]);
  summary.eachRow((row) => (row.font = { name: FONT, bold: row.number === 1 || row.number === totalRow }));

  try {
    await wb.xlsx.writeFile(out);
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === 'EBUSY') throw new Error(`${out} is open in Excel — close it and run again.`);
    throw e;
  }
  const csv = out.replace(/\.xlsx$/i, '') + '.csv';
  const quote = (v: string) => `"${v.replaceAll('"', '""')}"`;
  const lines = [
    ['Business name', 'Contact number', 'City', 'Username', 'Password'],
    ...[...whatsapp, ...others].map((c) => [
      nameOf(c),
      c.digits,
      c.city,
      loginOf(c),
      c.usernames.length ? OWNER_PASSWORD : '',
    ]),
  ];
  // The BOM makes Excel read the file as UTF-8.
  writeFileSync(csv, '\uFEFF' + lines.map((l) => l.map(quote).join(',')).join('\r\n') + '\r\n');

  console.log(`${listings.length} listings → ${contacts.length} contacts → ${out} (+ ${csv})`);
  for (const c of cities) console.log(`  ${c}: ${byCity.get(c)!.length} on WhatsApp`);
  console.log(
    `  ${NO_WHATSAPP}: ${others.length} (${others.filter((c) => c.digits).length} landline, ${others.filter((c) => !c.digits).length} no number)`,
  );
  console.log(`  ${listings.length - contacts.length} listings share a number with another branch`);
  if (prev) console.log(`  ${contacts.filter(isNew).length} new since the last export`);
  console.log(
    link
      ? `  link: ${link} (longest WhatsApp link ${longestUrl} chars)`
      : '  no link yet: re-run with --link <url> to add the Send buttons',
  );
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});

/// <reference types="node" />
/**
 * MAPS BOT — collect listings from Google Maps into folders that
 * scripts/list-business.ts can publish. It never publishes anything itself.
 *
 *   npx tsx scripts/maps-bot.ts --query "cafes in Indore" --type cafe --limit 20 [--headful] [--no-menu-ai]
 *
 * For each new place it creates E:\listing\<type>\<Place name>\ with:
 *   listing.json       name, tags, address, pin, hours, phone, source URL
 *   cover.jpg          the place's main photo, full size
 *   menu 1.jpg, …      the printed-menu photos, full size (kept until the menu is read)
 *   menu.json          the menu from the best source that has one: the photos (read by
 *                      Claude), Google's typed menu, or the web (Zomato / Swiggy / own
 *                      site) — see ensureMenu in scripts/menu-from-photos.ts
 *   menu.online.json   Google's typed menu, when it has one (delivery-app prices)
 *   review.txt         anything a person should look at before publishing
 *
 * Places already known are skipped, so re-running with a bigger --limit just
 * collects the next ones. "Known" = a folder of that name, or the DUPLICATE KEY
 * (same normalised name + pin within 150 m, scripts/listing-lib.ts) matching a
 * live listing of ANY owner, an entry in E:\listing\published-keys.json, or any
 * collected folder, however it is named.
 *
 * SAFE PACE: ~20 places an hour (one run, then rest). The run stops by itself
 * after 3 places in a row fail to load — Google's quiet throttle. Runs at a person's pace (3–8 s per place)
 * and stops if Google shows a consent or captcha page.
 */
import { chromium, type Page } from 'playwright-core';
import { appendFileSync, copyFileSync, existsSync, mkdirSync, readdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  anonClient,
  describeDuplicate,
  findDuplicate,
  folderName,
  loadLiveListings,
  loadKeyFile,
  loadLocalListings,
  sectionFor,
  sleep,
  type KnownListing,
} from './listing-lib';
import { ensureMenu } from './menu-from-photos';

const EDGE = 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe';
const DAYS = ['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday'];
const DAY_KEYS = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'];
const MAX_MENU_PHOTOS = 8;
/** Consecutive places that fail to load fully before the run stops (quiet throttle). */
const MAX_UNHEALTHY = 3;

/** Google category → Localo tags (names from TAG_CATALOG in src/domain/tags.ts). */
export const CATEGORY_TAGS: [RegExp, string[]][] = [
  [/coffee|cafe|café|tea house|tea/i, ['Cafe']],
  [/bakery|cake|patisserie/i, ['Bakery']],
  [/sweet|mithai|dessert|ice cream/i, ['Sweet Shop']],
  [/restaurant|diner|eatery|dhaba|bistro|fast food|pizza|burger|food court|family restaurant/i, ['Restaurant']],
];

function arg(name: string, fallback?: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : fallback;
}
const flag = (name: string) => process.argv.includes(`--${name}`);
const pause = () => sleep(3000 + Math.random() * 5000);

/* ───────────────────────────── hours ────────────────────────────────────── */

/** "6:30 am" / "12" / "11 pm" → minutes, with the meridiem it had (if any). */
function clock(t: string): { mins: number; mer?: 'am' | 'pm' } | null {
  const m = /^(\d{1,2})(?::(\d{2}))?\s*(am|pm|a\.m\.|p\.m\.)?$/i.exec(t.trim().replace(/\u202f|\u00a0/g, ' '));
  if (!m) return null;
  const h = Number(m[1]);
  const min = Number(m[2] ?? 0);
  if (h > 12 || min > 59) return null;
  const mer = m[3] ? (m[3].toLowerCase().startsWith('a') ? 'am' : 'pm') : undefined;
  return { mins: (h % 12) * 60 + min, mer };
}

const hhmm = (mins: number) =>
  `${String(Math.floor(mins / 60) % 24).padStart(2, '0')}:${String(mins % 60).padStart(2, '0')}`;

/**
 * Google's "6:30 am to 11 pm", "12 to 11:30 pm" (noon), "11 am to 3 pm, 7 to 11 pm",
 * "Open 24 hours", "Closed" → "HH:MM-HH:MM[, …]" | "closed" | null (unreadable).
 */
export function googleHours(text: string): string | null {
  const t = text.trim();
  if (/^closed$/i.test(t)) return 'closed';
  if (/open 24 hours/i.test(t)) return '00:00-23:59';
  const shifts: string[] = [];
  for (const part of t.split(/,\s*/)) {
    const m = /^(.+?)\s*(?:to|–|-)\s*(.+)$/i.exec(part);
    if (!m) return null;
    const a = clock(m[1]);
    const b = clock(m[2]);
    if (!a || !b) return null;
    const bMer = b.mer ?? a.mer ?? 'pm';
    const close = b.mins + (bMer === 'pm' ? 720 : 0);
    // An open time without am/pm borrows the close's ("12 to 11:30 pm" = noon).
    const aMer = a.mer ?? bMer;
    let open = a.mins + (aMer === 'pm' ? 720 : 0);
    if (!a.mer && open > close && bMer === 'pm') open -= 720; // "8 to 2 pm" → 8 am
    shifts.push(`${hhmm(open)}-${hhmm(close)}`);
  }
  return shifts.join(', ');
}

/* ───────────────────────────── page helpers ─────────────────────────────── */

async function blocked(page: Page): Promise<boolean> {
  const url = page.url();
  return /consent\.google|\/sorry\//.test(url) || (await page.$('form[action*="consent"]')) !== null;
}

/** lh3 photo URL at a chosen size. */
const sized = (src: string, w: number) => src.replace(/=[whs]\d+[^/?#]*$/, `=w${w}`);

export async function download(url: string, base: string): Promise<string | null> {
  const res = await fetch(url);
  if (!res.ok) return null;
  const type = res.headers.get('content-type') ?? '';
  const ext = type.includes('png') ? 'png' : type.includes('webp') ? 'webp' : 'jpg';
  const file = `${base}.${ext}`;
  writeFileSync(file, Buffer.from(await res.arrayBuffer()));
  return file;
}

/**
 * Scroll the results feed until `want` new places are listed or the list ends.
 * "New" = no folder of that name AND no live/local listing with the same
 * name + pin (the duplicate key) — the pin is in the result link, so a known
 * place is skipped before it is ever opened.
 */
async function collectPlaces(page: Page, want: number, folders: Set<string>, known: KnownListing[], skipped: string[]) {
  const found = new Map<string, string>();
  const seen = new Set<string>();
  for (let i = 0; i < 60 && found.size < want; i++) {
    const links = await page.$$eval('div[role=feed] a[href*="/maps/place/"]', (as) =>
      as.map((a) => [a.getAttribute('aria-label') ?? '', (a as HTMLAnchorElement).href]),
    );
    for (const [name, href] of links) {
      if (!name || found.has(name) || seen.has(href)) continue;
      seen.add(href);
      if (folders.has(folderName(name).toLowerCase())) continue;
      const pin = /!3d(-?\d+\.\d+)!4d(-?\d+\.\d+)/.exec(href);
      const dup = findDuplicate(name, pin ? { latitude: Number(pin[1]), longitude: Number(pin[2]) } : undefined, known);
      if (dup?.kind === 'duplicate') {
        skipped.push(`${name} — ${describeDuplicate(dup)}`);
        continue;
      }
      found.set(name, href);
      if (found.size >= want) break;
    }
    const end = await page.$eval('div[role=feed]', (f) => /reached the end of the list/i.test(f.textContent ?? ''));
    if (end) break;
    await page.$eval('div[role=feed]', (f) => f.scrollBy(0, 2500));
    await sleep(1500 + Math.random() * 1000);
  }
  return [...found.entries()].map(([name, href]) => ({ name, href }));
}

/** Google's typed menu (sub-tabs under Menu) → menu.json shape. */
async function typedMenu(page: Page, panel: string) {
  const tabs = await page.$$eval(`${panel} [role=tab]`, (ts) => ts.map((t) => t.textContent?.trim() ?? ''));
  const headings = tabs.slice(tabs.indexOf('About') + 1).filter((t) => t && t !== 'Overview');
  const menu: Record<string, Record<string, Record<string, { price?: number; description?: string }>>> = {};
  for (const heading of headings) {
    await page.locator(`${panel} [role=tab]`, { hasText: heading }).last().click().catch(() => {});
    await sleep(1500);
    const text: string = await page.$eval(panel, (e) => (e as HTMLElement).innerText).catch(() => '');
    const lines = text.split('\n').map((l) => l.trim()).filter(Boolean);
    let start = lines.lastIndexOf('Order online') + 1;
    let pending: string[] = [];
    for (const line of lines.slice(start)) {
      const price = /^₹\s?([\d,]+(?:\.\d+)?)$/.exec(line);
      if (!price) {
        pending.push(line);
        continue;
      }
      const [name, ...desc] = pending;
      pending = [];
      if (!name) continue;
      const section = sectionFor(heading);
      ((menu[section] ??= {})[heading] ??= {})[name] = {
        price: Number(price[1].replace(/,/g, '')),
        ...(desc.length ? { description: desc.join(' ') } : {}),
      };
    }
  }
  return Object.keys(menu).length ? menu : null;
}

/* ───────────────────────────── one place ────────────────────────────────── */

async function scrapePlace(page: Page, place: { name: string; href: string }, root: string, type: string) {
  await page.$$eval(
    'div[role=feed] a[href*="/maps/place/"]',
    (as, href) => (as.find((a) => (a as HTMLAnchorElement).href === href) as HTMLElement | undefined)?.click(),
    place.href,
  );
  await page.waitForFunction(
    (n) => [...document.querySelectorAll('div[role=main] h1')].some((h) => h.textContent?.trim() === n),
    place.name,
    { timeout: 30000 },
  );
  const panel = `div[role=main][aria-label=${JSON.stringify(place.name)}]`;
  // The name paints first; the tabs (Overview/Menu/…) and the rest arrive ~2 s
  // later. Reading before they land is how a place with a menu looks menu-less.
  await page.waitForSelector(`${panel} [role=tab]`, { timeout: 15000 }).catch(() => {});
  // A full place page has Overview / (Menu) / Reviews / About. Automated
  // browsers now usually get a REDUCED page (Overview / Reviews only): every
  // fact we list is still there, only the menu photos are missing, so the menu
  // comes from Zomato / the web instead. A page is only BAD when the basics
  // (address, pin) are missing — that's what counts toward Google's throttle.
  const tabNames = await page
    .$$eval(`${panel} [role=tab]`, (ts) => ts.map((t) => t.textContent?.trim() ?? ''))
    .catch(() => [] as string[]);
  const reduced = !tabNames.includes('About');
  await sleep(1500);

  const name = place.name.trim();
  const dir = join(root, folderName(name));
  if (existsSync(dir)) return { text: 'skipped (folder exists)', healthy: true, made: false };
  mkdirSync(dir, { recursive: true });
  const review: string[] = [];

  // Facts.
  const items = await page.$$eval(`${panel} [data-item-id]`, (bs) =>
    bs.map((b) => [b.getAttribute('data-item-id') ?? '', b.getAttribute('aria-label') ?? '']),
  );
  const category = await page.$eval(`${panel} button[jsaction*="category"]`, (b) => b.textContent?.trim() ?? '').catch(() => '');
  const address = (items.find(([id]) => id === 'address')?.[1] ?? '').replace(/^Address:\s*/, '').trim();
  const phoneId = items.find(([id]) => id.startsWith('phone:tel:'))?.[0];
  const phoneDigits = phoneId?.replace('phone:tel:', '').replace(/\D/g, '').replace(/^0/, '');

  // Pin: the place's own !3d<lat>!4d<lng>, from the result link.
  const pin = /!3d(-?\d+\.\d+)!4d(-?\d+\.\d+)/.exec(place.href);

  // Address "…, Indore, Madhya Pradesh 452001" → line / city / region (+PIN on the line).
  const parts = address.split(/,\s*/).filter(Boolean);
  const last = parts.pop() ?? '';
  const pinCode = /\b(\d{6})\b/.exec(last)?.[1];
  const region = last.replace(/\b\d{6}\b/, '').trim() || undefined;
  const city = parts.pop();
  const addressLine = [...parts, pinCode].filter(Boolean).join(', ') || undefined;
  if (!address) review.push('no address on Google');

  // Hours from the per-day aria-labels: "Wednesday, 6:30 am to 11 pm, Copy open hours".
  // Today's row lands first and the rest of the week a moment later — wait for all 7.
  await page
    .waitForFunction(
      (sel) => document.querySelectorAll(`${sel} [aria-label$="Copy open hours"]`).length >= 7,
      panel,
      { timeout: 8000 },
    )
    .catch(() => {});
  const readLabels = () => page.$$eval(`${panel} [aria-label]`, (els) => els.map((e) => e.getAttribute('aria-label') ?? ''));
  const dayCount = (ls: string[]) => ls.filter((l) => /^\w+day,.*Copy open hours$/i.test(l)).length;
  const parseDays = (ls: string[], notes: string[]) => {
    const out: Record<string, string> = {};
    for (const label of ls) {
      const m = /^(\w+day),\s*(.+?)(?:,\s*Copy open hours)?$/i.exec(label);
      const i = m ? DAYS.indexOf(m[1].toLowerCase()) : -1;
      if (!m || i < 0 || out[DAY_KEYS[i]]) continue;
      const parsed = googleHours(m[2]);
      if (parsed) out[DAY_KEYS[i]] = parsed;
      else notes.push(`hours: couldn't read ${m[1]} "${m[2]}" — left out`);
    }
    return out;
  };
  const hours = parseDays(await readLabels(), review);
  // Fewer than 7 days is retried at the very END (the retry clicks, and a click
  // here could swap the panel and lose the Menu tab). Until then, partial hours
  // are never written: 1 of 7 days would mark the place CLOSED on the other six.
  const partialDays = Object.keys(hours).length;
  if (partialDays < 7) for (const k of Object.keys(hours)) delete hours[k];

  const tags = new Set<string>(type === 'cafe' ? ['Cafe'] : []);
  for (const [re, t] of CATEGORY_TAGS) if (re.test(category)) t.forEach((x) => tags.add(x));

  const listing = {
    name,
    type: 'shop',
    tags: [...tags],
    phone: phoneDigits ? `+91 ${phoneDigits}` : undefined,
    location: {
      addressLine,
      city,
      region,
      country: 'India',
      point: pin ? { latitude: Number(pin[1]), longitude: Number(pin[2]) } : undefined,
    },
    hours: Object.keys(hours).length ? (hours as Record<string, string>) : undefined,
    source: { googleMaps: place.href.split('?')[0], category },
  };
  if (!pin) review.push('no map pin found');
  writeFileSync(join(dir, 'listing.json'), JSON.stringify(listing, null, 2));

  // Cover: the hero photo at the top of the Overview.
  const hero = await page
    .$$eval(`${panel} img[src*="googleusercontent"]`, (is) => (is[0] as HTMLImageElement | undefined)?.src ?? null)
    .catch(() => null);
  if (hero && (await download(sized(hero, 1600), join(dir, 'cover')))) {
    // ok
  } else review.push('no cover photo found — add cover.jpg by hand');

  // Menu tab: printed-menu photos, plus Google's typed menu if any.
  let menuPhotos = 0;
  const menuTab = page.locator(`${panel} [role=tab]`, { hasText: /^Menu$/ });
  if (!(await menuTab.count())) {
    review.push(`no Menu tab on Google (tabs: ${tabNames.join(' / ') || 'none'})`);
  }
  else {
    await menuTab.first().click();
    // Menu-section photos are the ones labelled "Photo N of M" on this tab.
    await page.waitForSelector(`${panel} [aria-label^="Photo "] img`, { timeout: 10000 }).catch(() => {});
    await sleep(1500);
    const srcs = await page.$$eval(`${panel} [aria-label^="Photo "] img[src*="googleusercontent"]`, (is) =>
      is.map((i) => (i as HTMLImageElement).src),
    );
    for (const src of [...new Set(srcs)].slice(0, MAX_MENU_PHOTOS)) {
      if (await download(sized(src, 2000), join(dir, `menu ${menuPhotos + 1}`))) menuPhotos++;
    }
    const online = await typedMenu(page, panel);
    if (online) writeFileSync(join(dir, 'menu.online.json'), JSON.stringify(online, null, 2));
  }

  if (partialDays < 7) {
    // Google shows hours three ways: the full week inline (read above), a
    // collapsed list behind a dropdown, or one "Open · Closes 11 pm · See more
    // hours" line that opens a separate hours page. Expand whichever is there.
    // On that hours page the panel loses its name, so read page-wide; the FIRST
    // week listed is opening hours (later tables are delivery/takeaway hours).
    await page.locator(`${panel} [role=tab]`, { hasText: /^Overview$/ }).first().click().catch(() => {});
    await sleep(1500);
    const opener = page
      .locator(`${panel} [aria-label*="See more hours"], ${panel} [jsaction*="openhours"][jsaction*="dropdown"]`)
      .first();
    const hasHours = (await opener.count()) > 0;
    let retry: Record<string, string> = {};
    if (hasHours) {
      await opener.click().catch(() => {});
      await page
        .waitForFunction(() => document.querySelectorAll('[aria-label$="Copy open hours"]').length >= 7, undefined, { timeout: 8000 })
        .catch(() => {});
      const all = await page.$$eval('[aria-label$="Copy open hours"]', (els) => els.map((e) => e.getAttribute('aria-label') ?? ''));
      retry = parseDays(all, []);
    }
    if (Object.keys(retry).length === 7) {
      Object.assign(hours, retry);
      listing.hours = hours;
      writeFileSync(join(dir, 'listing.json'), JSON.stringify(listing, null, 2));
    } else if (hasHours || partialDays > 0) {
      // Google HAS hours we couldn't read: hold rather than publish without them.
      review.push(`hours incomplete — only ${Math.max(partialDays, Object.keys(retry).length)}/7 days read; hours left out`);
    } else review.push('no opening hours on Google');
  }
  const dayTotal = Object.keys(hours).length;

  const basics = !!address && !!pin;
  if (!basics) review.push(`basics missing (address/pin) — page didn't load; re-collect later`);
  if (review.length) appendFileSync(join(dir, 'review.txt'), review.map((r) => `${r}\n`).join(''));
  const text = `${listing.tags.join(', ')} · ${dayTotal}/7 days · ${menuPhotos} menu photo(s)${existsSync(join(dir, 'menu.online.json')) ? ' + typed menu' : ''}${reduced ? ' · reduced page' : ''}${basics ? '' : ' · NOT LOADED'}`;
  return { text, healthy: basics, made: true };
}

/* ───────────────────────────── collect ──────────────────────────────────── */

export interface CollectOptions {
  query: string;
  type: string;
  limit: number;
  /** Parent folder; places land in <root>/<type>/. */
  root: string;
  headful?: boolean;
  /** Build each place's menu after collecting (default true). */
  menuAi?: boolean;
  /** Claude model for menu photos (default sonnet). */
  menuModel?: string;
  log?: (line: string) => void;
}

export interface CollectResult {
  /** Folders created this run. */
  made: string[];
  /** Google slowed or blocked us — the caller should back off. */
  throttled: boolean;
  /** The search has fewer new places left than were asked for — move to the next query. */
  exhausted: boolean;
}

/** One collection run: search → open each new place → folder. Never publishes. */
export async function collect(opts: CollectOptions): Promise<CollectResult> {
  const log = opts.log ?? ((l: string) => console.log(l));
  const { query, type, limit } = opts;
  const root = join(opts.root, type);
  mkdirSync(root, { recursive: true });
  const folders = new Set(readdirSync(root).map((d) => d.toLowerCase()));
  // The duplicate key's reference set: everything live in the app (any owner),
  // the published-keys file, and every collected folder — by name + pin.
  const known = [...(await loadLiveListings(anonClient())), ...loadKeyFile(), ...loadLocalListings(root)];
  const skipped: string[] = [];

  const browser = await chromium.launch({ executablePath: EDGE, headless: !opts.headful });
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 }, locale: 'en-US' });
  const made: string[] = [];
  let throttled = false;
  let exhausted = false;
  try {
    await page.goto(`https://www.google.com/maps/search/${encodeURIComponent(query)}?hl=en`, { waitUntil: 'domcontentloaded' });
    if (await blocked(page)) {
      log('Google showed a consent/captcha page — backing off.');
      return { made, throttled: true, exhausted: false };
    }
    const listed = await page
      .waitForSelector('div[role=feed] a[href*="/maps/place/"]', { timeout: 30000 })
      .then(() => true)
      .catch(() => false);
    if (!listed) {
      // No list can mean three things. One match: Maps opens that place
      // directly. No match: it says so. Neither: the page never loaded, which
      // is the throttle. Only the last should make the caller back off.
      const body = await page.locator('body').innerText().catch(() => '');
      const singlePlace = (await page.locator('div[role=main] h1').count()) > 0;
      if (singlePlace || /can't find|No results/i.test(body)) {
        log(`"${query}" has no results list (${singlePlace ? 'one match' : 'no matches'}) — next search`);
        return { made, throttled: false, exhausted: true };
      }
      log(`No results list for "${query}" — Google slow; backing off.`);
      return { made, throttled: true, exhausted: false };
    }

    const places = await collectPlaces(page, limit, folders, known, skipped);
    exhausted = places.length < limit;
    log(`${places.length} new place(s) for "${query}" (checked against ${known.length} known listing(s) and ${folders.size} folder(s))`);
    for (const s of skipped) log(`   skip: ${s}`);

    // Google's quiet throttle doesn't show a captcha — the place panel just stops
    // loading. Three of those in a row and we back off instead of making it worse.
    let unhealthy = 0;
    for (const [i, place] of places.entries()) {
      try {
        const result = await scrapePlace(page, place, root, type);
        log(`[${i + 1}/${places.length}] ${place.name} … ${result.text}`);
        if (result.made) made.push(join(root, folderName(place.name)));
        unhealthy = result.healthy ? 0 : unhealthy + 1;
      } catch (e) {
        log(`[${i + 1}/${places.length}] ${place.name} … failed: ${e instanceof Error ? e.message.split('\n')[0] : e}`);
        unhealthy++;
        if (await blocked(page)) {
          log('Google is blocking — stopping here; finished folders are kept.');
          throttled = true;
          break;
        }
      }
      if (unhealthy >= MAX_UNHEALTHY) {
        log(`${MAX_UNHEALTHY} places in a row didn't load properly — Google is slowing us down. Stopping this run.`);
        throttled = true;
        exhausted = false;
        break;
      }
      await pause();
    }
  } finally {
    await browser.close();
  }

  // Menus, after the browser is closed: photos → Google's typed menu → the
  // web (Zomato, Swiggy, own site) → none. See ensureMenu in menu-from-photos.ts.
  if (opts.menuAi !== false) {
    for (const dir of made) {
      log(`menu: ${dir.split(/[\\/]/).pop()}`);
      await ensureMenu(dir, log, opts.menuModel);
    }
  }
  return { made, throttled, exhausted };
}

/* ───────────────────────────── CLI ──────────────────────────────────────── */

async function main() {
  const type = arg('type', 'cafe')!;
  const root = arg('root', 'E:/listing')!;
  const result = await collect({
    query: arg('query', 'cafes in Indore')!,
    type,
    limit: Number(arg('limit', '20')),
    root,
    headful: flag('headful'),
    menuAi: !flag('no-menu-ai'),
  });
  console.log(
    `\nDone: ${result.made.length} folder(s)${result.throttled ? ' — Google slowed us down, wait a few hours' : ''}${result.exhausted ? ' — this search has no more new places' : ''}.`,
  );
  console.log(`Next: npx tsx scripts/list-business.ts "${join(root, type)}" --summary`);
}

if (process.argv[1] && /maps-bot/.test(process.argv[1])) {
  main().catch((e) => {
    console.error(e instanceof Error ? e.message : e);
    process.exit(1);
  });
}

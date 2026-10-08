/// <reference types="node" />
/**
 * ZOMATO BOT — collect cafés / restaurants from Zomato into folders that
 * scripts/list-business.ts can publish. It never publishes anything itself.
 * Replaces maps-bot for food places (Sagar, 8 Oct 2026): Google now serves
 * automated browsers a reduced page with no menu, while every Zomato page
 * carries the whole listing as data.
 *
 *   npx tsx scripts/zomato-bot.ts --query "restaurants/cafes" --type cafe --limit 20 [--headful] [--list-only]
 *
 * --query is a Zomato list page under the city, e.g. "restaurants/cafes"
 * (https://www.zomato.com/indore/restaurants/cafes) or "vijay-nagar-restaurants".
 *
 * Each restaurant page embeds its data (window.__PRELOADED_STATE__), so nothing
 * is read off the screen:
 *   SECTION_BASIC_INFO   name, cuisines, the week's opening hours, closed / delivery-only flags
 *   SECTION_RES_CONTACT  address, exact pin (latitude/longitude), phone
 *   res_thumb            the featured photo → cover
 *   order.menuList       the full menu: sections, dishes, prices, descriptions, veg mark, dish photos
 * A place that takes no online orders has no menuList; its printed-menu photos
 * are saved as "menu N.jpg" and read by Claude (ensureMenu, menu-from-photos.ts).
 *
 * For each new place it creates <root>\<type>\<Place name>\ with:
 *   listing.json   name, tags, address, pin, hours, phone, source URL
 *   cover.jpg      the featured photo
 *   menu.json      the menu, in the register wizard's paste format
 *   dishes\N.jpg   dish photos — OFF for now (MAX_DISH_PHOTOS = 0); when on, the ones the menu points at ("photo": "dishes/N.jpg"); the
 *                  publisher uploads them to Cloudinary — nothing links to Zomato
 *   menu N.jpg     printed-menu photos, only when there is no order menu
 *   review.txt     anything a person should look at before publishing
 *
 * Known places are skipped: the same DUPLICATE KEY as maps-bot (normalised name
 * + pin within 150 m against live listings, published-keys.json and local
 * folders), plus <root>\zomato-seen.json — every Zomato page already opened, so
 * a re-run never opens it again. Permanently/temporarily closed and
 * delivery-only kitchens are skipped (a cloud kitchen has no place to visit).
 *
 * NOT GETTING BLOCKED (Sagar, 8 Oct 2026) — behave like one person browsing:
 *   - one tab, one page at a time, never in parallel;
 *   - 8–20 s between places, plus a 1–2 minute break every 8–12 places;
 *   - a persistent browser profile (<root>\.zomato-profile), so Zomato sees a
 *     returning visitor with its own cookies, not a brand-new one every cycle;
 *   - the user agent is the real installed Edge's version, minus "Headless";
 *   - zomato-seen.json: a page is never opened twice;
 *   - a block page (403/429/503, "Access Denied", a captcha) stops the run AT
 *     ONCE — no retrying into it — and the loop rests 2 slots (1 h); two blocks
 *     in a row end the run. 3 pages in a row without data count the same way.
 */
import { chromium, type Page } from 'playwright-core';
import { appendFileSync, existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  anonClient,
  describeDuplicate,
  findDuplicate,
  folderName,
  loadKeyFile,
  loadLiveListings,
  loadLocalListings,
  normName,
  sectionFor,
  sleep,
} from './listing-lib';
import { download, googleHours, type CollectOptions, type CollectResult } from './maps-bot';
import { ensureMenu } from './menu-from-photos';

const EDGE = 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe';
const DAY_KEYS = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'] as const;
const MAX_MENU_PHOTOS = 8;
/**
 * Dish photos are OFF (Sagar, 8 Oct 2026): 40,000 of them is ~3 GB of Cloudinary
 * and, worse, a resize per photo per size viewed. Set this above 0 to bring them
 * back — orderMenu saves them as dishes/N.jpg and the publisher uploads them.
 */
const MAX_DISH_PHOTOS = 0;
const MAX_UNHEALTHY = 3;
/**
 * Zomato cuisines → Localo tags (TAG_CATALOG names). Stricter than maps-bot's
 * Google-category map: "Desserts" on a café's cuisine list doesn't make it a
 * sweet shop, but a full meal menu does make it a restaurant too.
 */
const ZOMATO_TAGS: [RegExp, string[]][] = [
  [/\bcafe\b|coffee|\btea\b/i, ['Cafe']],
  [/bakery/i, ['Bakery']],
  [/mithai/i, ['Sweet Shop']],
  [/north indian|south indian|chinese|biryani|mughlai|thali|continental|italian|asian|rajasthani|gujarati|maharashtrian/i, ['Restaurant']],
];
/** Zomato gives the city, not the state. */
const CITY_REGION: Record<string, string> = { indore: 'Madhya Pradesh', bhopal: 'Madhya Pradesh', ujjain: 'Madhya Pradesh' };

function arg(name: string, fallback?: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : fallback;
}
const flag = (name: string) => process.argv.includes(`--${name}`);
/** Between places: 8–20 s, like someone reading each page. */
const pause = () => sleep(8000 + Math.random() * 12000);
/** Every 8–12 places, a 1–2 minute break. */
const nextBreak = () => 8 + Math.floor(Math.random() * 5);
const longBreak = () => sleep(60000 + Math.random() * 60000);

/** Zomato's "go away" pages: Akamai's Access Denied, a captcha, rate limiting. */
async function blockedPage(page: Page, status?: number): Promise<string | null> {
  if (status === 403 || status === 429 || status === 503) return `HTTP ${status}`;
  const head = await page
    .locator('body')
    .innerText({ timeout: 5000 })
    .then((t) => t.slice(0, 1500))
    .catch(() => '');
  const m = /access denied|unusual traffic|are you a robot|captcha|too many requests|verify you are human/i.exec(head);
  return m ? `"${m[0]}" page` : null;
}

class Blocked extends Error {}

/* ───────────────────────────── page data ────────────────────────────────── */

type Json = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any

/** The JSON Zomato embeds in every page (`window.__PRELOADED_STATE__ = JSON.parse("…")`). */
async function pageState(page: Page): Promise<Json | null> {
  const html = await page.content();
  const m = /__PRELOADED_STATE__\s*=\s*JSON\.parse\(("(?:[^"\\]|\\.)*")\)/.exec(html);
  if (!m) return null;
  try {
    return JSON.parse(JSON.parse(m[1]));
  } catch {
    return null;
  }
}

/* ───────────────────────────── hours ────────────────────────────────────── */

const DAY_INDEX: Record<string, number> = { mon: 0, tue: 1, wed: 2, thu: 3, fri: 4, sat: 5, sun: 6 };

/** "Mon-Sun" / "Mon, Wed-Sun" / "Monday" → day indexes (ranges may wrap: "Fri-Mon"). */
function zomatoDays(text: string): number[] | null {
  const out: number[] = [];
  for (const part of text.split(/\s*,\s*/).filter(Boolean)) {
    const [a, b] = part.split(/\s*[-–]\s*/).map((d) => DAY_INDEX[d.trim().slice(0, 3).toLowerCase()]);
    if (a === undefined || (part.match(/[-–]/) && b === undefined)) return null;
    if (b === undefined) out.push(a);
    else for (let i = a; ; i = (i + 1) % 7) {
      out.push(i);
      if (i === b) break;
    }
  }
  return out;
}

/** "10am – 11:30pm", "12noon – 3pm, 7pm – 12midnight", "24 Hours", "Closed" → googleHours's "HH:MM-HH:MM". */
export function zomatoTiming(text: string): string | null {
  const t = text
    .replace(/\u202f|\u00a0/g, ' ')
    .replace(/(\d)\s*noon/gi, '$1pm')
    .replace(/(\d)\s*midnight/gi, '$1am')
    .replace(/\bnoon\b/gi, '12pm')
    .replace(/\bmidnight\b/gi, '12am')
    .trim();
  if (/24\s*hours/i.test(t)) return '00:00-23:59';
  return googleHours(t);
}

/** customised_timings.opening_hours → listing.json hours; `missing` lists days it couldn't fill. */
function weekHours(basic: Json, notes: string[]): Partial<Record<(typeof DAY_KEYS)[number], string>> {
  const rows: Json[] = basic?.timing?.customised_timings?.opening_hours ?? [];
  const hours: Partial<Record<(typeof DAY_KEYS)[number], string>> = {};
  for (const r of rows) {
    const days = zomatoDays(String(r.days ?? ''));
    const time = zomatoTiming(String(r.timing ?? ''));
    if (!days || !time) {
      notes.push(`hours: couldn't read "${r.days}: ${r.timing}" — left out`);
      continue;
    }
    for (const d of days) hours[DAY_KEYS[d]] = time;
  }
  const filled = Object.keys(hours).length;
  if (filled && filled < 7) {
    // Zomato lists only open days; a day missing from a full schedule is closed.
    for (const k of DAY_KEYS) hours[k] ??= 'closed';
  }
  if (!filled) {
    if (basic?.timing?.timing_desc) notes.push(`hours incomplete — Zomato shows only "${basic.timing.timing_desc}"; hours left out`);
    else notes.push('no opening hours on Zomato');
  }
  return hours;
}

/* ───────────────────────────── menu ─────────────────────────────────────── */

interface MenuEntry {
  price?: number;
  description?: string;
  veg?: boolean;
  photo?: string;
}

const dishPhoto = (item: Json): string | undefined =>
  /https:\/\/b\.zmtcdn\.com\/data\/dish_photos\/[^"?\s]+\.(?:jpe?g|png|webp)/i.exec(JSON.stringify(item.media ?? []))?.[0];

/** Zomato's order menu → the paste format: { Section: { Folder: { Dish: {price, description, veg, photo} } } }. */
async function orderMenu(state: Json, resId: string, dir: string, log: (l: string) => void) {
  const menus: Json[] = state?.pages?.restaurant?.[resId]?.order?.menuList?.menus ?? [];
  const out: Record<string, Record<string, unknown>> = {};
  let count = 0;
  let photos = 0;
  for (const { menu } of menus) {
    const heading = String(menu?.name ?? '').trim() || 'Menu';
    const section = sectionFor(heading);
    for (const { category } of menu?.categories ?? []) {
      const folder = String(category?.name ?? '').trim() || heading;
      for (const { item } of category?.items ?? []) {
        const name = String(item?.name ?? '').trim();
        if (!name) continue;
        const price = Number(item.price || item.min_price || item.default_price) || undefined;
        const diet: string[] = item.dietary_slugs ?? [];
        const entry: MenuEntry = {
          ...(price ? { price } : {}),
          ...(String(item.desc ?? '').trim() ? { description: String(item.desc).trim() } : {}),
          ...(diet.includes('veg') ? { veg: true } : diet.includes('non-veg') ? { veg: false } : {}),
        };
        const src = photos < MAX_DISH_PHOTOS ? dishPhoto(item) : undefined;
        if (src) {
          mkdirSync(join(dir, 'dishes'), { recursive: true });
          const file = await download(`${src}?fit=around%7C600%3A600`, join(dir, 'dishes', String(photos + 1))).catch(() => null);
          if (file) {
            photos++;
            entry.photo = `dishes/${file.split(/[\\/]/).pop()}`;
          }
        }
        // Section › Zomato's heading › its sub-category, as nested folders — skipping a
        // level that only repeats the one above ("Main Course" › "Main Course").
        const path = [heading, folder].filter((p, i, all) => normName(p) !== normName(i ? all[i - 1] : section));
        let node: Record<string, unknown> = (out[section] ??= {});
        for (const p of path) node = (node[p] ??= {}) as Record<string, unknown>;
        node[name] = entry;
        count++;
      }
    }
  }
  if (photos) log(`   ${photos} dish photo(s)`);
  return count ? { menu: out, count } : null;
}

/** A place with no order menu: its printed-menu photos from the /menu page. */
async function menuPhotoUrls(page: Page, url: string): Promise<string[]> {
  await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 }).catch(() => null);
  await page.waitForTimeout(2500);
  const html = (await page.content()).replace(/\\u002F/g, '/').replace(/\\\//g, '/');
  const urls = html.match(/https:\/\/b\.zmtcdn\.com\/data\/menus\/[^"?\s\\]+\.(?:jpe?g|png|webp)/gi) ?? [];
  return [...new Set(urls)].slice(0, MAX_MENU_PHOTOS);
}

/* ───────────────────────────── the list ─────────────────────────────────── */

const SLUG = /zomato\.com\/([a-z-]+)\/([a-z0-9-]+)\/(?:info|order)(?:[?#]|$)/;

/** Scroll a Zomato list page until `want` unseen restaurant slugs are listed or the list stops growing. */
async function listSlugs(page: Page, url: string, want: number, seen: Set<string>): Promise<string[]> {
  const res = await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 });
  await page.waitForTimeout(3500 + Math.random() * 2000);
  const block = await blockedPage(page, res?.status());
  if (block) throw new Blocked(block);
  const found: string[] = [];
  let still = 0;
  for (let round = 0; round < 60 && found.length < want && still < 4; round++) {
    const hrefs = await page.$$eval('a[href]', (as) => as.map((a) => (a as HTMLAnchorElement).href));
    const before = found.length;
    for (const h of hrefs) {
      const slug = SLUG.exec(h)?.[2];
      if (slug && !seen.has(slug) && !found.includes(slug)) found.push(slug);
    }
    still = found.length === before ? still + 1 : 0;
    await page.mouse.wheel(0, 1500 + Math.random() * 2000);
    await page.waitForTimeout(1500 + Math.random() * 1500);
  }
  return found.slice(0, want);
}

/* ───────────────────────────── one place ────────────────────────────────── */

interface PlaceResult {
  text: string;
  healthy: boolean;
  dir?: string;
}

async function scrapePlace(
  page: Page,
  city: string,
  slug: string,
  root: string,
  type: string,
  known: ReturnType<typeof loadKeyFile>,
  log: (l: string) => void,
): Promise<PlaceResult> {
  const base = `https://www.zomato.com/${city}/${slug}`;
  const res = await page.goto(`${base}/order`, { waitUntil: 'domcontentloaded', timeout: 30000 });
  await page.waitForTimeout(2000 + Math.random() * 2000);
  const block = await blockedPage(page, res?.status());
  if (block) throw new Blocked(block);
  const state = await pageState(page);
  const resId = Object.keys(state?.pages?.restaurant ?? {})[0];
  const sections: Json | undefined = resId ? state!.pages.restaurant[resId].sections : undefined;
  const basic: Json | undefined = sections?.SECTION_BASIC_INFO;
  const contact: Json | undefined = sections?.SECTION_RES_CONTACT;
  if (!basic?.name || !contact) return { text: 'no page data', healthy: false };

  const name = String(basic.name).trim();
  if (basic.is_perm_closed || basic.is_temp_closed) return { text: 'skipped (closed)', healthy: true };
  if (basic.is_delivery_only || contact.is_dark_kitchen) return { text: 'skipped (delivery-only kitchen)', healthy: true };
  const lat = Number(contact.latitude);
  const lng = Number(contact.longitude);
  if (!lat || !lng) return { text: 'skipped (no pin on Zomato)', healthy: true };
  const point = { latitude: lat, longitude: lng };

  const dup = findDuplicate(name, point, known);
  if (dup?.kind === 'duplicate') return { text: `skipped — ${describeDuplicate(dup)}`, healthy: true };

  // Folder: the name, or name + locality when another branch already has the name.
  const locality = String(contact.locality_verbose ?? '').split(',')[0].trim();
  let dir = join(root, folderName(name));
  if (existsSync(dir)) dir = join(root, folderName(`${name} ${locality}`));
  if (existsSync(dir)) return { text: 'skipped (folder exists)', healthy: true };
  mkdirSync(dir, { recursive: true });
  const review: string[] = [];
  if (dup?.kind === 'near') review.push(describeDuplicate(dup));

  // Facts.
  const cityName = String(contact.city_name ?? city);
  const address = String(contact.address ?? '')
    .replace(new RegExp(`,\\s*${cityName}\\s*$`, 'i'), '')
    .trim();
  const zip = /^\d{6}$/.test(String(contact.zipcode ?? '').trim()) ? String(contact.zipcode).trim() : '';
  const phone = /\+?\d[\d\s-]{8,}\d/.exec(String(contact.phoneDetails?.phoneStr ?? ''))?.[0].replace(/\D/g, '').slice(-10);
  const cuisines = String(basic.cuisine_string ?? '');
  const tags = new Set<string>(type === 'cafe' ? ['Cafe'] : type === 'restaurant' ? ['Restaurant'] : []);
  for (const [re, t] of ZOMATO_TAGS) if (re.test(cuisines)) t.forEach((x) => tags.add(x));
  const hours = weekHours(basic, review);
  if (!address) review.push('no address on Zomato');

  const listing = {
    name,
    type: 'shop',
    tags: [...tags],
    phone: phone ? `+91 ${phone}` : undefined,
    location: {
      addressLine: [address, zip].filter(Boolean).join(', ') || undefined,
      city: cityName,
      region: CITY_REGION[cityName.toLowerCase()],
      country: 'India',
      point,
    },
    hours: Object.keys(hours).length ? hours : undefined,
    source: { zomato: base, cuisines },
  };
  writeFileSync(join(dir, 'listing.json'), JSON.stringify(listing, null, 2));

  // Cover: the featured photo, at full size (the query string only asks for webp).
  const thumb = String(basic.res_thumb ?? '').split('?')[0];
  if (!(thumb && (await download(thumb, join(dir, 'cover')).catch(() => null)))) review.push('no cover photo found — add cover.jpg by hand');

  // Menu: the order menu as data; otherwise the printed-menu photos.
  let menuText = 'no menu';
  const typed = await orderMenu(state!, resId!, dir, log);
  if (typed) {
    writeFileSync(join(dir, 'menu.json'), JSON.stringify(typed.menu, null, 2));
    review.push(`menu source: Zomato order menu (${base}/order), ${typed.count} items`);
    menuText = `${typed.count} dishes`;
  } else {
    await sleep(3000 + Math.random() * 4000);
    const urls = await menuPhotoUrls(page, `${base}/menu`);
    let n = 0;
    for (const u of urls) if (await download(u, join(dir, `menu ${n + 1}`)).catch(() => null)) n++;
    menuText = n ? `${n} menu photo(s)` : 'no menu on Zomato';
    if (!n) review.push('no menu on Zomato (no order menu, no menu photos)');
  }

  if (review.length) appendFileSync(join(dir, 'review.txt'), review.map((r) => `${r}\n`).join(''));
  return { text: `${listing.tags.join(', ')} · ${Object.keys(hours).length}/7 days · ${menuText}`, healthy: true, dir };
}

/* ───────────────────────────── collect ──────────────────────────────────── */

const seenFile = (root: string) => join(root, 'zomato-seen.json');
const readSeen = (root: string): string[] => {
  try {
    return JSON.parse(readFileSync(seenFile(root), 'utf8'));
  } catch {
    return [];
  }
};

/** One collection run: list page → open each unseen place → folder. Never publishes. */
export async function collect(opts: CollectOptions & { city?: string; listOnly?: boolean }): Promise<CollectResult> {
  const log = opts.log ?? ((l: string) => console.log(l));
  const city = (opts.city ?? 'indore').toLowerCase();
  const typeRoot = join(opts.root, opts.type);
  mkdirSync(typeRoot, { recursive: true });
  const seen = new Set(readSeen(opts.root));
  const remember = (slug: string) => {
    seen.add(slug);
    writeFileSync(seenFile(opts.root), JSON.stringify([...seen], null, 0));
  };
  const known = [...(await loadLiveListings(anonClient())), ...loadKeyFile(), ...loadLocalListings(typeRoot)];

  // A persistent profile keeps Zomato's cookies between cycles and runs: a
  // returning visitor, not a fresh one every half hour.
  const profile = join(opts.root, '.zomato-profile');
  const probe = await chromium.launch({ executablePath: EDGE, headless: true });
  const version = probe.version();
  await probe.close();
  const userAgent = `Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/${version} Safari/537.36 Edg/${version}`;
  const browser = await chromium.launchPersistentContext(profile, {
    executablePath: EDGE,
    headless: !opts.headful,
    viewport: { width: 1366, height: 768 },
    locale: 'en-IN',
    timezoneId: 'Asia/Kolkata',
    userAgent,
  });
  const page = browser.pages()[0] ?? (await browser.newPage());
  const made: string[] = [];
  let throttled = false;
  let exhausted = false;
  try {
    const listUrl = /^https?:/.test(opts.query) ? opts.query : `https://www.zomato.com/${city}/${opts.query.replace(/^\//, '')}`;
    // Ask the list for extra: some places turn out known, closed or delivery-only.
    let slugs: string[];
    try {
      slugs = await listSlugs(page, listUrl, opts.limit * 3, seen);
    } catch (e) {
      if (!(e instanceof Blocked)) throw e;
      log(`Zomato blocked the list page (${e.message}) — stopping; the loop will rest.`);
      return { made, throttled: true, exhausted: false };
    }
    log(`${slugs.length} unseen place(s) on ${listUrl} (${seen.size} opened before, ${known.length} known listing(s))`);
    if (opts.listOnly) {
      slugs.forEach((s) => log(`   ${s}`));
      return { made, throttled, exhausted: false };
    }
    if (!slugs.length) return { made, throttled: false, exhausted: true };

    let unhealthy = 0;
    let opened = 0;
    let breakAt = nextBreak();
    for (const slug of slugs) {
      if (made.length >= opts.limit) break;
      opened++;
      if (opened > 1 && opened % breakAt === 0) {
        log('   (short break, like a person would)');
        await longBreak();
        breakAt = nextBreak();
      }
      try {
        const r = await scrapePlace(page, city, slug, typeRoot, opts.type, known, log);
        log(`[${made.length + (r.dir ? 1 : 0)}/${opts.limit}] ${slug} … ${r.text}`);
        if (r.healthy) remember(slug);
        if (r.dir) {
          made.push(r.dir);
          known.push(...loadLocalListings(typeRoot).filter((k) => !known.some((x) => x.ref === k.ref)));
        }
        unhealthy = r.healthy ? 0 : unhealthy + 1;
      } catch (e) {
        if (e instanceof Blocked) {
          // Never push into a block: stop now; the loop rests and tries later.
          log(`${slug} … Zomato blocked us (${e.message}) — stopping this run at once.`);
          throttled = true;
          break;
        }
        log(`${slug} … failed: ${e instanceof Error ? e.message.split('\n')[0] : e}`);
        unhealthy++;
      }
      if (unhealthy >= MAX_UNHEALTHY) {
        log(`${MAX_UNHEALTHY} pages in a row came back without data — Zomato is slowing us down. Stopping this run.`);
        throttled = true;
        break;
      }
      await pause();
    }
    // The list ran out before we had enough new places → the caller moves to the next list.
    exhausted = !throttled && made.length < opts.limit && opened >= slugs.length;
  } finally {
    await browser.close();
  }

  // Printed-menu photos (places without an order menu) are read by Claude.
  if (opts.menuAi !== false) {
    for (const dir of made) {
      if (!existsSync(join(dir, 'menu.json')) && readdirSync(dir).some((f) => /^menu \d+\./i.test(f))) {
        log(`menu: ${dir.split(/[\\/]/).pop()}`);
        await ensureMenu(dir, log, opts.menuModel);
      }
    }
  }
  return { made, throttled, exhausted };
}

/* ───────────────────────────── CLI ──────────────────────────────────────── */

async function main() {
  const type = arg('type', 'cafe')!;
  const root = arg('root', 'E:/listing')!;
  const result = await collect({
    query: arg('query', 'restaurants/cafes')!,
    type,
    limit: Number(arg('limit', '20')),
    root,
    city: arg('city', 'indore'),
    headful: flag('headful'),
    menuAi: !flag('no-menu-ai'),
    listOnly: flag('list-only'),
  });
  console.log(
    `\nDone: ${result.made.length} folder(s)${result.throttled ? ' — Zomato slowed us down, wait a while' : ''}${result.exhausted ? ' — this list has no more new places' : ''}.`,
  );
  console.log(`Next: npx tsx scripts/list-business.ts "${join(root, type)}" --summary`);
}

if (process.argv[1] && /zomato-bot/.test(process.argv[1])) {
  main().catch((e) => {
    console.error(e instanceof Error ? e.message : e);
    process.exit(1);
  });
}

/// <reference types="node" />
/**
 * ZOMATO — find a place's Zomato order page and return the menu as text.
 * Step 3 of the menu ladder in scripts/menu-from-photos.ts.
 *
 * Claude's own web tools can't read Zomato (it times out for them) or Swiggy
 * (a JavaScript app that renders nothing without a browser), but a real browser
 * gets Zomato fine: type the name into Zomato's search, click the suggestion,
 * land on /order, read the page. Swiggy shows an error page to automated
 * browsers, so it is not used.
 *
 * Google's names often carry extras Zomato doesn't ("Habit - Coffee Lounge",
 * "Nothing Before Coffee Sapna Sangeeta"), so the search tries the full name,
 * then the name cut at " - " / "(" / "|", then the name without trailing words
 * that are part of the address. A chain lists every branch under the same name,
 * so EVERY matching suggestion (up to MAX_CANDIDATES) is opened until one is
 * this place.
 *
 * THE MATCH MUST BE THIS PLACE. A page is accepted only when its phone number
 * matches the one Google gave us, or the name matches exactly AND at least two
 * address words agree, or one name contains the other ("Rare Cafe" / "RARE cafe
 * & resto") AND at least three address words agree. Anything else is rejected:
 * a same-named café across town is worse than no menu.
 */
import { chromium, type Browser } from 'playwright-core';
import { normName } from './listing-lib';

const EDGE = 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe';
const MAX_CANDIDATES = 4;

/** Zomato blocked us this run (captcha / 403) — stop asking until the process restarts. */
let zomatoBlocked = false;

export interface ZomatoFacts {
  name: string;
  phone?: string;
  addressLine?: string;
  city?: string;
}

const digits = (s?: string) => (s ?? '').replace(/\D/g, '').slice(-10);
const words = (s?: string) =>
  new Set(
    (s ?? '')
      .toLowerCase()
      .replace(/centre/g, 'center')
      .split(/[^a-z0-9]+/)
      .filter((w) => w.length >= 4 && !/^(indore|road|nagar|madhya|pradesh|near|opposite|shop)$/.test(w)),
  );

/** The names worth typing into Zomato's search, best first. */
export function searchNames(name: string, addressLine?: string): string[] {
  const out = [name.trim()];
  const cut = name.split(/\s+[-–|]\s+|\s*[(|]/)[0].trim();
  if (cut.length >= 3) out.push(cut);
  // Drop trailing words that are part of the address ("… Sapna Sangeeta", "… Indore").
  const addr = new Set((addressLine ?? '').toLowerCase().split(/[^a-z0-9]+/).concat(['indore']));
  const ws = cut.split(/\s+/);
  while (ws.length > 1 && addr.has(ws[ws.length - 1].toLowerCase().replace(/[^a-z0-9]/g, ''))) ws.pop();
  if (ws.length) out.push(ws.join(' '));
  return [...new Set(out.filter(Boolean))];
}

type Try = { text: string; url: string } | 'blocked' | null;

/** One search on Zomato: type `query`, then open each matching suggestion until one is this place. */
async function trySearch(browser: Browser, query: string, facts: ZomatoFacts, log: (l: string) => void): Promise<Try> {
  const city = (facts.city ?? 'Indore').toLowerCase().replace(/\s+/g, '-');
  const v = browser.version();
  const userAgent = `Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/${v} Safari/537.36 Edg/${v}`;
  const page = await browser.newPage({ viewport: { width: 1366, height: 768 }, locale: 'en-IN', timezoneId: 'Asia/Kolkata', userAgent });
  try {
    const open = async (): Promise<'ok' | 'blocked' | 'nobox'> => {
      const res = await page.goto(`https://www.zomato.com/${city}`, { waitUntil: 'domcontentloaded', timeout: 30000 });
      if (!res || res.status() === 403 || res.status() === 429) return 'blocked';
      const box = page.locator('input[placeholder*="restaurant"]').first();
      if (!(await box.count())) return 'nobox';
      await box.click();
      await box.type(query, { delay: 60 });
      await page.waitForTimeout(3500);
      return 'ok';
    };
    const first = await open();
    if (first !== 'ok') return first === 'blocked' ? 'blocked' : null;

    // Suggestions are <p> names; every one whose name matches ours is a candidate.
    const key = normName(query);
    const names = await page.$$eval('p', (ps) => ps.map((p) => p.textContent?.trim() ?? ''));
    const exact = names.filter((n) => normName(n) === key);
    const close = names.filter((n) => n && normName(n) !== key && normName(n).length > 4 && (normName(n).includes(key) || key.includes(normName(n))));
    const picks = [...exact, ...close].slice(0, MAX_CANDIDATES);
    if (!picks.length) {
      log(`   Zomato: no suggestion for "${query}"`);
      return null;
    }

    // The same name can appear several times (one per branch): open each by position.
    const seen = new Map<string, number>();
    for (const [i, pick] of picks.entries()) {
      const nth = seen.get(pick) ?? 0;
      seen.set(pick, nth + 1);
      if (i > 0) {
        const again = await open();
        if (again !== 'ok') return again === 'blocked' ? 'blocked' : null;
      }
      const hits = page.getByText(pick, { exact: true });
      if ((await hits.count()) <= nth) continue;
      // A hidden duplicate of the text can't be clicked — move on to the next one.
      if (!(await hits.nth(nth).click({ timeout: 8000 }).then(() => true, () => false))) continue;
      await page.waitForURL(/zomato\.com\/.+\/order/, { timeout: 15000 }).catch(() => {});
      if (!/\/order/.test(page.url())) {
        log(`   Zomato: "${pick}" has no order page`);
        continue;
      }
      // The menu renders as you scroll.
      for (let s = 0; s < 25; s++) {
        await page.mouse.wheel(0, 2500);
        await page.waitForTimeout(400);
      }
      const text = (await page.locator('body').innerText()).replace(/[ \t]+\n/g, '\n');

      // Is it THIS place?
      const ourPhone = digits(facts.phone);
      const pagePhones = (text.match(/\+?\d[\d\s-]{8,}\d/g) ?? []).map(digits);
      const phoneMatch = !!ourPhone && pagePhones.includes(ourPhone);
      const header = text.slice(0, 600);
      const shared = [...words(facts.addressLine)].filter((w) => words(header).has(w));
      const nameMatch = normName(pick) === normName(facts.name) || normName(pick) === key;
      // A close name ("Rare Cafe" for "RARE cafe & resto") needs more address
      // agreement than an exact one.
      if (!(phoneMatch || (nameMatch && shared.length >= 2) || shared.length >= 3)) {
        log(`   Zomato: "${pick}" (${page.url()}) doesn't look like this place (phone ${phoneMatch ? 'matches' : 'differs'}, ${shared.length} address word(s) shared) — not used`);
        continue;
      }
      const prices = (text.match(/₹\s?\d+/g) ?? []).length;
      if (prices < 3) {
        log(`   Zomato: page for "${pick}" has no menu prices`);
        continue;
      }
      log(`   Zomato: matched "${pick}" by ${phoneMatch ? 'phone' : 'name + address'} — ${prices} prices on ${page.url()}`);
      return { text, url: page.url() };
    }
    return null;
  } finally {
    await page.close();
  }
}

/** The menu page text, or null when Zomato has no page that is clearly this place. */
export async function zomatoMenuText(facts: ZomatoFacts, log: (l: string) => void = console.log): Promise<{ text: string; url: string } | null> {
  if (zomatoBlocked) return null;
  const browser = await chromium.launch({ executablePath: EDGE, headless: true });
  try {
    for (const query of searchNames(facts.name, facts.addressLine)) {
      const r = await trySearch(browser, query, facts, log).catch((e) => {
        log(`   Zomato: search "${query}" failed: ${e instanceof Error ? e.message.split('\n')[0] : e}`);
        return null;
      });
      if (r === 'blocked') {
        zomatoBlocked = true;
        log('   Zomato refused us — not used again this run');
        return null;
      }
      if (r) return r;
    }
    return null;
  } catch (e) {
    log(`   Zomato lookup failed: ${e instanceof Error ? e.message.split('\n')[0] : e}`);
    return null;
  } finally {
    await browser.close();
  }
}

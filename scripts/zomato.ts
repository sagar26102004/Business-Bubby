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
 * THE MATCH MUST BE THIS PLACE. A page is accepted only when its phone number
 * matches the one Google gave us, or the name matches exactly AND at least two
 * address words agree, or one name contains the other ("Rare Cafe" / "RARE cafe
 * & resto") AND at least three address words agree. Anything else is rejected:
 * a same-named café across town is worse than no menu.
 */
import { chromium } from 'playwright-core';
import { normName } from './listing-lib';

const EDGE = 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe';
const UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36 Edg/140.0.0.0';

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

/** The menu page text, or null when Zomato has no page that is clearly this place. */
export async function zomatoMenuText(facts: ZomatoFacts, log: (l: string) => void = console.log): Promise<{ text: string; url: string } | null> {
  if (zomatoBlocked) return null;
  const city = (facts.city ?? 'Indore').toLowerCase().replace(/\s+/g, '-');
  const browser = await chromium.launch({ executablePath: EDGE, headless: true });
  try {
    const page = await browser.newPage({ viewport: { width: 1280, height: 900 }, locale: 'en-US', userAgent: UA });
    const res = await page.goto(`https://www.zomato.com/${city}`, { waitUntil: 'domcontentloaded', timeout: 30000 });
    if (!res || res.status() === 403 || res.status() === 429) {
      zomatoBlocked = true;
      log(`   Zomato refused us (${res?.status()}) — not used again this run`);
      return null;
    }
    const box = page.locator('input[placeholder*="restaurant"]').first();
    if (!(await box.count())) return null;
    await box.click();
    await box.type(facts.name, { delay: 60 });
    await page.waitForTimeout(3500);

    // Suggestions are <p> names; take one whose name matches ours.
    const key = normName(facts.name);
    const names = await page.$$eval('p', (ps) => ps.map((p) => p.textContent?.trim() ?? ''));
    const pick = names.find((n) => normName(n) === key) ?? names.find((n) => n && (normName(n).includes(key) || key.includes(normName(n))) && normName(n).length > 4);
    if (!pick) {
      log(`   Zomato: no suggestion for "${facts.name}"`);
      return null;
    }
    await page.getByText(pick, { exact: true }).last().click();
    await page.waitForURL(/zomato\.com\/.+\/order/, { timeout: 15000 }).catch(() => {});
    if (!/\/order/.test(page.url())) {
      log(`   Zomato: "${pick}" has no order page`);
      return null;
    }
    // The menu renders as you scroll.
    for (let i = 0; i < 25; i++) {
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
    const nameMatch = normName(pick) === key;
    // A close name ("Rare Cafe" for "RARE cafe & resto") needs more address
    // agreement than an exact one.
    const closeName = normName(pick).includes(key) || key.includes(normName(pick));
    if (!(phoneMatch || (nameMatch && shared.length >= 2) || (closeName && shared.length >= 3))) {
      log(`   Zomato: "${pick}" doesn't look like this place (phone ${phoneMatch ? 'matches' : 'differs'}, ${shared.length} address word(s) shared) — not used`);
      return null;
    }
    const prices = (text.match(/₹\s?\d+/g) ?? []).length;
    if (prices < 3) {
      log(`   Zomato: page for "${pick}" has no menu prices`);
      return null;
    }
    log(`   Zomato: matched "${pick}" by ${phoneMatch ? 'phone' : 'name + address'} — ${prices} prices on ${page.url()}`);
    return { text, url: page.url() };
  } catch (e) {
    log(`   Zomato lookup failed: ${e instanceof Error ? e.message.split('\n')[0] : e}`);
    return null;
  } finally {
    await browser.close();
  }
}

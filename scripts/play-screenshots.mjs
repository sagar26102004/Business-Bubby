/**
 * Capture the Play Store phone screenshots from the running web app.
 *
 * Play wants 2–8 phone screenshots and `docs/play-store/store-listing.md` names
 * the six that should be there, in order. Shooting them by hand means redoing
 * all six every time the listing data changes, so this drives the real app
 * instead: a 540×960 viewport at 2× produces exactly the recommended
 * 1080×1920 portrait PNG.
 *
 * Prerequisites:
 *   1. `npx expo start --web` running on http://localhost:8081
 *   2. Microsoft Edge installed at the default path (override with EDGE_PATH)
 *   3. `playwright-core` — already a devDependency
 *
 * Usage:
 *   node scripts/play-screenshots.mjs
 *   OP_USER=aarav_mehta OP_PASS=localo123 node scripts/play-screenshots.mjs
 *
 * Output: docs/play-store/screenshots/0X-*.png
 *
 * ⚠️ NAVIGATION IS CLICK-ONLY, ON PURPOSE. On the Expo web dev server a direct
 * `page.goto('/orders')` bounces back to `/` — deep links do not resolve before
 * the router mounts. Every step below therefore taps its way there exactly as a
 * user would. Do not "simplify" this back into goto() calls; you get six copies
 * of the home screen and they look convincing at a glance.
 *
 * ⚠️ Re-run this AFTER the production data cleanup in `production-setup.md`.
 * Whatever listings are in the database at capture time are what the Play
 * listing will show, and a screenshot full of "Stall #633" test rows reads as
 * an unfinished app.
 */
import { chromium } from 'playwright-core';
import { mkdir } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const OUT = join(ROOT, 'docs', 'play-store', 'screenshots');

const BASE = process.env.OP_BASE_URL ?? 'http://localhost:8081';
const USER = process.env.OP_USER ?? 'aarav_mehta';
const PASS = process.env.OP_PASS ?? 'localo123';
const EDGE =
  process.env.EDGE_PATH ??
  'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';

// Indore — the app sorts by distance, so a plausible position is what makes the
// "10.4 km" labels in the screenshots read as real.
const GEO = { latitude: 22.7196, longitude: 75.8577 };

async function main() {
  await mkdir(OUT, { recursive: true });
  const browser = await chromium.launch({ executablePath: EDGE, headless: true });
  const ctx = await browser.newContext({
    viewport: { width: 540, height: 960 },
    deviceScaleFactor: 2, // → 1080×1920, the size store-listing.md recommends
    permissions: ['geolocation'],
    geolocation: GEO,
    locale: 'en-IN',
  });
  const page = await ctx.newPage();
  const wait = (ms) => page.waitForTimeout(ms);

  /**
   * Tap the first VISIBLE element carrying this text.
   *
   * The visibility filter is load-bearing: React Navigation keeps every tab
   * screen mounted, so the tab bar's "Home" also exists underneath any stack
   * screen pushed on top of it. Without the filter Playwright picks the buried
   * copy and waits 8s for it to become clickable.
   */
  const tap = async (text, { exact = true, which = 'first' } = {}) => {
    const all = page.getByText(text, { exact }).filter({ visible: true });
    const n = await all.count();
    if (n === 0) {
      console.log(`  · no visible "${text}" to tap`);
      return false;
    }
    const loc = which === 'last' ? all.last() : all.first();
    await loc
      .click({ timeout: 8000 })
      .catch((e) => console.log(`  · tap "${text}": ${e.message.split('\n')[0]}`));
    await wait(3500);
    return true;
  };

  /** Leave a pushed stack screen the way the back arrow would. */
  const back = async () => {
    await page.goBack().catch(() => {});
    await wait(3500);
  };

  const shoot = async (name) => {
    await page.screenshot({ path: join(OUT, `${name}.png`) });
    console.log(`  ✓ ${name}.png`);
  };

  // Cold load. This is the ONLY navigation by URL in the script.
  await page.goto(`${BASE}/`, { waitUntil: 'load', timeout: 120000 });
  await wait(8000);

  // --- sign in ---------------------------------------------------------
  // Orders, subscriptions and chat are all behind an account.
  console.log(`signing in as ${USER}`);
  await tap('Account');
  await tap('Sign in');
  await page.getByPlaceholder('Your username').fill(USER).catch(() => console.log('  · username field missing'));
  await page.getByPlaceholder('••••••••').first().fill(PASS).catch(() => console.log('  · password field missing'));
  await tap('Sign in', { which: 'last' });
  await wait(5000);

  // --- 1. home ---------------------------------------------------------
  await tap('Home');
  await wait(3000);
  await shoot('01-home');

  // --- 2. a business page ----------------------------------------------
  // Enter through the deal carousel's "View" — a stable affordance that lands
  // on a real business page without hardcoding an id that the data cleanup
  // would invalidate.
  await tap('View →');
  await shoot('02-business');

  // --- 3. the full menu -------------------------------------------------
  await tap('Full menu ›');
  await shoot('03-menu');

  // --- 4. stalls --------------------------------------------------------
  // Exactly two screens were pushed (business, then menu). Going back a third
  // time leaves the app and screenshots a blank page, which is easy to miss
  // because the file is still written.
  await back();
  await back();
  // The Explore/Stalls/My Business segmented control resists getByText — the
  // pill intercepts the pointer — so it is driven by coordinate.
  await page.mouse.click(270, 36); // Stalls
  await wait(4000);
  await shoot('04-stalls');

  // --- 5. the map -------------------------------------------------------
  await page.mouse.click(103, 36); // Explore
  await wait(4000);
  // The map button is the icon right of the location row. It has no text, and
  // it only exists on the Explore segment — on Stalls the same spot is the QR
  // scanner, which is how this shot silently became a scan screen once.
  await page.mouse.click(503, 96);
  await wait(9000); // Leaflet tiles come over the network
  await shoot('05-map');

  // Five shots, which clears Play's minimum of two. Three more are worth adding
  // once the data supports them — see the "not captured yet" note in
  // docs/play-store/screenshots/README.md before extending this script.

  await browser.close();
  console.log(`\ndone → ${OUT}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

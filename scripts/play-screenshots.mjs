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
 *   OP_USER=<username> OP_PASS=<password> node scripts/play-screenshots.mjs   # optional
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
const USER = process.env.OP_USER ?? '';   // guest by default — see the sign-in note below
const PASS = process.env.OP_PASS ?? '';
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

  // --- sign in (OPTIONAL) ------------------------------------------
  // The ten seeded test accounts were deleted in the production cleanup
  // (production-setup.md §2.4), so there is no default login any more. Every
  // shot below is reachable as a GUEST, which is also the more honest capture:
  // it is exactly what a reviewer sees on first launch. Set OP_USER/OP_PASS
  // only if you have an account whose Orders/Chat tabs are worth shooting.
  if (USER) {
    console.log(`signing in as ${USER}`);
    await tap('Account');
    await tap('Sign in');
    await page.getByPlaceholder('Your username').fill(USER).catch(() => console.log('  · username field missing'));
    await page.getByPlaceholder('••••••••').first().fill(PASS).catch(() => console.log('  · password field missing'));
    await tap('Sign in', { which: 'last' });
    await wait(5000);
    await tap('Home');
    await wait(3000);
  }

  // --- 1. home ---------------------------------------------------------
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

  // --- 4. a real order ---------------------------------------------------
  // The gap README.md documented: proof that transactions happen. Built by
  // tapping ADD on real dishes, which is PURELY LOCAL — CartContext is a
  // useState map with no repository call in it, and we stop at the review
  // screen. Nothing is written and no business is notified, so this does NOT
  // violate the README's "don't place test orders for a screenshot" rule.
  //
  // ⚠️ The button reads "ADD ＋" with a FULLWIDTH PLUS (U+FF0B). An exact
  // match on "ADD +" finds nothing and the whole step silently no-ops.
  const adds = page.getByText(/^ADD/).filter({ visible: true });
  const addCount = await adds.count();
  console.log(`  · ${addCount} dishes addable`);
  for (const i of [0, 2, 4]) {
    if (i < addCount) {
      await adds.nth(i).click({ timeout: 6000 }).catch((e) => console.log(`  · add ${i}: ${e.message.split(String.fromCharCode(10))[0]}`));
      await wait(1200);
    }
  }
  await wait(1500);
  await tap('Place order ›');
  // Pick a fulfilment mode so the shot shows a complete order rather than the
  // "Choose dine-in or takeaway" validation hint.
  await tap('Dine-in');
  await shoot('04-order');

  // --- 5. the map -------------------------------------------------------
  // Three screens are now stacked (business, menu, order review).
  await back();
  await back();
  await back();
  await page.mouse.click(103, 36); // Explore
  await wait(4000);
  // The map button is the icon right of the location row. It has no text, and
  // it only exists on the Explore segment — on Stalls the same spot is the QR
  // scanner, which is how this shot silently became a scan screen once.
  await page.mouse.click(503, 96);
  await wait(9000); // Leaflet tiles come over the network
  await shoot('05-map');

  // --- 6. stalls ---------------------------------------------------------
  // ⚠️ CAPTURED BUT NOT UPLOAD-READY. See README.md — the live stalls are two
  // test rows ("Bottel", "iPhone 90" at ₹5 marked SOLD, 643 km away) against a
  // mostly empty grid. Shot anyway so the set is complete the moment the data
  // is real; check it by eye before putting it in the Console.
  await back();
  await wait(2000);
  // The Explore/Stalls/My Business segmented control resists getByText — the
  // pill intercepts the pointer — so it is driven by coordinate.
  await page.mouse.click(270, 36); // Stalls
  await wait(4000);
  await shoot('06-stalls');

  await browser.close();
  console.log(`\ndone → ${OUT}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

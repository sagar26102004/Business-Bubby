/**
 * Features put ON HOLD by the One Place redesign (2026-10).
 *
 * Their code is kept and still type-checked, but nothing in the app links to
 * them and their routes redirect home. Every place that was hidden carries an
 * `ON HOLD (redesign 2026-10)` comment — `grep -rn "ON HOLD" src` lists all of
 * them. To bring a feature back: flip its flag here, then restore those spots.
 *
 *  - `stalls`      — personal stalls (listing type 'item'): the Stalls feed,
 *                    stall console, product threads, "Selling my own stuff".
 *  - `businessQr`  — the printable QR that opens a business page, and scanning
 *                    one. Order handover / scan-to-pay QR is NOT affected.
 */
export const ON_HOLD = {
  stalls: true,
  businessQr: true,
} as const;

/**
 * DEMO LISTINGS (`Business.demo`) — sample businesses made by
 * scripts/demo-listings.ts to show owners what the Deals feed looks like.
 * They are NOT real businesses, so they never reach a real customer: every
 * public list hides them unless the signed-in viewer is a platform admin or a
 * `bot…` demo account (set by DataProvider via `setDemoViewer`).
 */
let demoViewer = false;

export function setDemoViewer(on: boolean) {
  demoViewer = on;
}

export function isDemoViewer(): boolean {
  return demoViewer;
}

/**
 * Stall listings stay in the database but are hidden from every list, and so
 * are demo listings for anyone who isn't a demo viewer.
 */
export function isListedPublicly(b: { type: string; demo?: boolean }): boolean {
  if (ON_HOLD.stalls && b.type === 'item') return false;
  if (b.demo && !demoViewer) return false;
  return true;
}

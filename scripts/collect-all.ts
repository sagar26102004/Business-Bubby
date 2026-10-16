/// <reference types="node" />
/**
 * COLLECT ALL — run every collector bot, then merge.
 *
 *   npx tsx scripts/collect-all.ts                                  every bot, then merge
 *   npx tsx scripts/collect-all.ts --bots osm,practo                some bots
 *   npx tsx scripts/collect-all.ts --group health --no-merge        Google: one group only; skip the merge
 *   npx tsx scripts/collect-all.ts --hours 15                       stop on time (bots, then merge + photo fill)
 *
 * The bots run AT THE SAME TIME: each talks to a different site and writes
 * only its own E:\listing\<bot>\ folder, so they never get in each other's
 * way. Each one stops by itself when it's done, when its site blocks it, or
 * when E:\listing\STOP (all bots) or E:\listing\<bot>\STOP (one bot) appears,
 * and remembers where it was, so running this again continues.
 * Then scripts/merge-listings.ts builds E:\listing\merged\businesses.json, the photo
 * fill finds a Google photo for every business that has none (--no-photo-fill
 * skips it), and the merge runs once more.
 * --hours H: the bots collect until H minus the photo-fill share (a fifth of H,
 * at most 2 h), are stopped through the STOP file, and the merge + photo fill
 * use the rest. Nothing is published: build-ready.ts + list-business.ts do that, after a look.
 */
import { existsSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { LISTING_ROOT } from './listing-lib';
import { loadPlan, pickCategories, runGoogleMaps, runPhotoFill } from './collect/google-maps';
import { runMagicpin } from './collect/magicpin';
import { runOsm } from './collect/osm';
import { runPracto } from './collect/practo';
import { merge } from './merge-listings';

function arg(name: string, fallback?: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : fallback;
}

const ALL = ['google-maps', 'osm', 'magicpin', 'practo'];

async function main() {
  const root = arg('root', LISTING_ROOT)!;
  const bots = (arg('bots')?.split(',').map((b) => b.trim()) ?? ALL).filter(Boolean);
  const unknown = bots.filter((b) => !ALL.includes(b));
  if (unknown.length) throw new Error(`Unknown bot(s): ${unknown.join(', ')} (have: ${ALL.join(', ')})`);
  const plan = loadPlan();
  const t0 = Date.now();
  const hours = Number(arg('hours', '0'));
  const end = hours > 0 ? t0 + hours * 3_600_000 : 0;
  const fillShare = Math.min(2 * 3_600_000, hours * 3_600_000 * 0.2);
  const stopFile = join(root, 'STOP');
  // Time's up for the bots: the shared STOP file makes each finish its page and exit.
  const timer = end ? setTimeout(() => writeFileSync(stopFile, 'written by collect-all --hours'), end - fillShare - t0) : undefined;

  const jobs: Record<string, () => Promise<unknown>> = {
    'google-maps': () => runGoogleMaps(plan, { categories: pickCategories(plan, arg('categories'), arg('group')), root, headful: process.argv.includes('--headful') }),
    osm: () => runOsm({ root }),
    magicpin: () => runMagicpin({ root }),
    practo: () => runPracto({ root }),
  };
  console.log(`collect-all: ${bots.join(', ')} → ${root}`);
  const results = await Promise.allSettled(bots.map((b) => jobs[b]()));
  if (timer) clearTimeout(timer);
  // Our own time-up STOP is cleared so the photo fill can run; a STOP you made is respected.
  const stoppedByTimer = end && Date.now() >= end - fillShare;
  if (stoppedByTimer && existsSync(stopFile)) rmSync(stopFile);
  else if (existsSync(stopFile)) {
    console.log('STOP file found — skipping the photo fill (the merge still runs).');
  }
  results.forEach((r, i) => {
    console.log(`  ${bots[i]}: ${r.status === 'fulfilled' ? 'finished' : `FAILED — ${r.reason instanceof Error ? r.reason.message : r.reason}`}`);
  });
  console.log(`bots done in ${Math.round((Date.now() - t0) / 60000)} min`);

  if (process.argv.includes('--no-merge')) return;
  const includeFood = process.argv.includes('--include-food');
  await merge({ root, includeFood });
  // Every business still missing only a photo is looked up on Google by name, then merged again.
  if (!process.argv.includes('--no-photo-fill')) {
    const { found } = await runPhotoFill({ root, until: end ? end - 5 * 60_000 : undefined });
    if (found) await merge({ root, includeFood });
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

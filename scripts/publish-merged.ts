/// <reference types="node" />
/**
 * PUBLISH MERGED — list everything publishable in E:\listing\merged\businesses.json,
 * a batch at a time.
 *
 *   npx tsx scripts/publish-merged.ts [--batch 100] [--max 500] [--tags "Gym,Clinic"]
 *
 * Each round: build-ready.ts makes the next `batch` ready folders (phone-first,
 * skipping anything already in the published-keys file), then list-business.ts
 * publishes them with --auto — its own checks still run on every folder
 * (duplicate key against every live listing, owner account, "Listing inactive").
 * A published folder is deleted and its key saved, so stopping and running this
 * again simply continues. Held folders stay in E:\listing\ready\ for a person.
 *
 * Stops when everything is done, after --max published, or when E:\listing\STOP
 * (or E:\listing\ready\STOP) appears. Progress: E:\listing\ready\publish-log.txt.
 */
import { appendFileSync, existsSync, mkdirSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { buildReady, readMerged } from './build-ready';
import { publish } from './list-business';
import { LISTING_ROOT, folderName } from './listing-lib';

function arg(name: string, fallback?: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : fallback;
}

async function main() {
  const root = arg('root', LISTING_ROOT)!;
  const readyDir = join(root, 'ready');
  mkdirSync(readyDir, { recursive: true });
  const logFile = join(readyDir, 'publish-log.txt');
  const log = (l: string) => {
    console.log(l);
    appendFileSync(logFile, `${new Date().toLocaleString('en-IN', { hour12: false })}  ${l}\n`);
  };
  const stop = () => existsSync(join(root, 'STOP')) || existsSync(join(readyDir, 'STOP'));
  const batch = Number(arg('batch', '100'));
  const max = Number(arg('max', '0')) || Infinity;
  const tags = arg('tags')?.split(',').map((t) => t.trim()).filter(Boolean);

  const all = readMerged(root);
  const skipIds = new Set<string>();
  const total = all.filter((m) => m.publishable).length;
  log(`publish-merged: ${total} publishable in the merged file, batches of ${batch}`);
  const sum = { published: 0, duplicate: 0, held: 0, failed: 0 };

  for (let round = 1; sum.published < max; round++) {
    if (stop()) {
      log('STOP file found — stopping');
      break;
    }
    const ids = await buildReady({ root, all, tags, limit: Math.min(batch, max - sum.published), skipIds });
    if (!ids.length) {
      log('nothing left to publish');
      break;
    }
    // Publish every tag folder this round touched.
    const touched = new Set(ids.map((id) => folderName(all.find((m) => m.id === id)!.tags[0])));
    for (const group of touched) {
      const dir = join(readyDir, group);
      if (!existsSync(dir) || !statSync(dir).isDirectory()) continue;
      // A network blip or a Supabase hiccup must not end a 30-hour run: log it,
      // wait, carry on (the folders stay and are retried next round).
      const r = await publish(dir, { auto: true }).catch(async (e) => {
        log(`!! publishing ${group} failed: ${e instanceof Error ? e.message : e} — waiting 60 s, then carrying on`);
        await new Promise((res) => setTimeout(res, 60_000));
        return { published: 0, duplicate: 0, held: 0, failed: 0 };
      });
      sum.published += r.published;
      sum.duplicate += r.duplicate;
      sum.held += r.held;
      sum.failed += r.failed;
    }
    log(`round ${round}: total so far — published ${sum.published} · duplicates ${sum.duplicate} · held ${sum.held} · failed ${sum.failed} · ${skipIds.size}/${total} handled`);
  }
  const waiting = readdirSync(readyDir).filter((d) => statSync(join(readyDir, d)).isDirectory());
  log(`publish-merged done: published ${sum.published} · duplicates ${sum.duplicate} · held ${sum.held} · failed ${sum.failed}. Folders left in ready\\: ${waiting.join(', ') || 'none'}`);
}

main().catch((e) => {
  console.error(e);
  // Leave the reason where a person (or Claude) can read it — the window may be gone.
  appendFileSync(join(LISTING_ROOT, 'ready', 'publish-log.txt'), `${new Date().toLocaleString('en-IN', { hour12: false })}  !! CRASHED: ${e instanceof Error ? e.stack : e}\n`);
  process.exit(1);
});

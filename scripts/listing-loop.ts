/// <reference types="node" />
/**
 * LISTING LOOP — the unattended run behind /start-listing. See LISTING-PLAN.md.
 *
 *   npx tsx scripts/listing-loop.ts [--source maps|zomato] [--cities indore,bhopal] [--hours 10] [--interval 30] [--per-cycle 20] [--dry-publish] [--root E:/listing] [--plan file]
 *
 * --source picks the collector: maps (Google Maps, /start-listing) or zomato (/start-listing-zomato).
 * --cities (Zomato only; default the plan's `cities`, else indore): the cities to collect from, in order.
 *   Each city walks the whole `zomatoQueries` list before the run moves to the next city, and each
 *   city's position is remembered on its own (loop-state.json → zomatoCities), so a city that is
 *   already used up is skipped in seconds.
 *   TESTS ONLY: --simulate ok|throttle replaces the collector (no Google) to exercise the schedule, STOP and back-off.
 *
 * Every `intervalMinutes` (a "slot") it runs one cycle:
 *   1. stop if E:\listing\STOP exists
 *   2. retry menus still pending (photos Claude couldn't read yet)
 *   3. collect up to `perCycle` new places (maps-bot), walking the query list
 *   4. publish what is safe without a person (list-business --auto); the rest is HELD
 *
 * If the site slows the collector down, the next slot (Google) or two (Zomato) are skipped; two
 * throttles in a row end the run. The query position and running totals live
 * in E:\listing\loop-state.json, so the next run picks up where this one ended.
 * Everything is logged to E:\listing\logs\run-<timestamp>.log.
 */
import { appendFileSync, existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { collect as collectMaps } from './maps-bot';
import { collect as collectZomato, zomatoCity } from './zomato-bot';
import { ensureMenu, menuPhotos } from './menu-from-photos';
import { publish } from './list-business';
import { sleep } from './listing-lib';

interface Plan {
  type: string;
  root: string;
  perCycle: number;
  intervalMinutes: number;
  hours: number;
  /** Claude model that reads menu photos (sonnet / opus / haiku). */
  menuModel?: string;
  /** Where places come from when --source isn't given: "maps" (default) or "zomato". */
  source?: 'zomato' | 'maps';
  /** Google Maps searches (source "maps"). */
  queries: string[];
  /** Zomato list pages under the city, e.g. "restaurants/cafes" (source "zomato"). */
  zomatoQueries?: string[];
  /** Cities for source "zomato" when --cities isn't given (default ["indore"]). */
  cities?: string[];
}

interface LoopState {
  queryIndex: number;
  /** Before there were cities: Indore's position in plan.zomatoQueries. Moved into zomatoCities on load. */
  zomatoQueryIndex?: number;
  /** Each city's position in plan.zomatoQueries (queryIndex is the Google Maps list's). */
  zomatoCities?: Record<string, number>;
  cycles: number;
  collected: number;
  published: number;
  duplicates: number;
  lastRun?: string;
}

/** Slots to rest after a slowdown: Google 1 (30 min), Zomato 2 (1 h) — a Zomato block is a real block page. */
const SKIP_SLOTS_AFTER_THROTTLE = { maps: 1, zomato: 2 } as const;
const MAX_THROTTLES_IN_A_ROW = 2;

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

async function main() {
  const plan = JSON.parse(readFileSync(arg('plan') ?? 'scripts/listing-plan.json', 'utf8')) as Plan;
  const hours = Number(arg('hours') ?? plan.hours);
  const intervalMs = Number(arg('interval') ?? plan.intervalMinutes) * 60_000;
  const perCycle = Number(arg('per-cycle') ?? plan.perCycle);
  const root = arg('root') ?? plan.root;
  const dryPublish = process.argv.includes('--dry-publish');
  const simulate = arg('simulate'); // 'ok' | 'throttle' — tests only
  const typeDir = join(root, plan.type);
  const source = (arg('source') ?? plan.source ?? 'maps') as 'maps' | 'zomato';
  if (source !== 'maps' && source !== 'zomato') throw new Error(`--source must be maps or zomato, not "${source}"`);
  const queries = source === 'zomato' ? (plan.zomatoQueries ?? []) : plan.queries;
  // Google searches name their own area, so maps runs have one unnamed "city".
  const cities =
    source === 'zomato'
      ? [...new Set((arg('cities')?.split(',') ?? plan.cities ?? ['indore']).map((c) => zomatoCity(c)).filter(Boolean))]
      : [''];
  if (!cities.length) throw new Error('--cities is empty');
  const collect = source === 'zomato' ? collectZomato : collectMaps;
  const site = source === 'zomato' ? 'Zomato' : 'Google';

  mkdirSync(join(root, 'logs'), { recursive: true });
  const logFile = join(root, 'logs', `run-${new Date().toISOString().slice(0, 16).replace(/[:T]/g, '-')}.log`);
  // The publisher prints with console.log; mirror that into the log file too.
  const rawLog = console.log.bind(console);
  const rawErr = console.error.bind(console);
  const log = (line: string) => {
    const stamped = `${new Date().toLocaleTimeString('en-IN', { hour12: false })}  ${line}`;
    rawLog(stamped);
    appendFileSync(logFile, `${stamped}\n`);
  };
  console.log = (...a: unknown[]) => {
    rawLog(...a);
    appendFileSync(logFile, `${a.join(' ')}\n`);
  };
  console.error = (...a: unknown[]) => {
    rawErr(...a);
    appendFileSync(logFile, `${a.join(' ')}\n`);
  };

  const stateFile = join(root, 'loop-state.json');
  const state: LoopState = existsSync(stateFile)
    ? JSON.parse(readFileSync(stateFile, 'utf8'))
    : { queryIndex: 0, cycles: 0, collected: 0, published: 0, duplicates: 0 };
  const saveState = () => writeFileSync(stateFile, JSON.stringify({ ...state, lastRun: new Date().toISOString() }, null, 2));

  const stopFile = join(root, 'STOP');
  const start = Date.now();
  const deadline = start + hours * 3_600_000;
  const run = { collected: 0, published: 0, held: 0, duplicates: 0, cycles: 0 };
  let skipSlots = 0;
  let throttlesInARow = 0;
  let endReason = 'time is up';

  if (state.zomatoQueryIndex !== undefined) {
    state.zomatoCities = { indore: state.zomatoQueryIndex, ...state.zomatoCities };
    delete state.zomatoQueryIndex;
  }
  state.zomatoCities ??= {};
  const posOf = (city: string) => (source === 'zomato' ? (state.zomatoCities![city] ?? 0) : state.queryIndex);
  const setPos = (city: string, i: number) => {
    if (source === 'zomato') state.zomatoCities![city] = i;
    else state.queryIndex = i;
  };
  /** The first city in the list that still has searches left. */
  const currentCity = () => cities.find((c) => posOf(c) < queries.length);
  const cityLabel = (c: string) => (c ? ` in ${c}` : '');

  log(`START — ${hours} h, ${perCycle} per ${intervalMs / 60_000} min, type "${plan.type}", source ${site}, ${dryPublish ? 'DRY publish' : 'publishing live'}`);
  for (const c of cities) {
    const left = queries.length - posOf(c);
    log(`${c ? `${c}: ` : ''}${left > 0 ? `queries ${posOf(c) + 1}–${queries.length} remaining` : 'every search already used up — skipped'}`);
  }
  log(`log: ${logFile}`);

  for (let slot = 0; ; slot++) {
    const slotStart = start + slot * intervalMs;
    if (slotStart >= deadline) break;
    const wait = slotStart - Date.now();
    if (wait > 0) await sleep(wait);
    if (existsSync(stopFile)) {
      endReason = 'STOP file found';
      break;
    }
    if (skipSlots > 0) {
      skipSlots--;
      log(`slot ${slot + 1}: resting after a ${site} slowdown (${skipSlots} more to skip)`);
      continue;
    }
    if (!currentCity()) {
      endReason = `every search in the plan is used up${source === 'zomato' ? ` in ${cities.join(', ')} — add more cities or queries` : ' — add more queries to scripts/listing-plan.json'}`;
      break;
    }

    run.cycles++;
    state.cycles++;
    log(`── cycle ${run.cycles} (slot ${slot + 1})`);

    // 1. Menus that couldn't be read last time.
    if (existsSync(typeDir)) {
      for (const d of readdirSync(typeDir)) {
        const dir = join(typeDir, d);
        if (menuPhotos(dir).length && !existsSync(join(dir, 'menu.json'))) {
          log(`retry menu: ${d}`);
          await ensureMenu(dir, log, plan.menuModel).catch((e) => log(`   menu retry failed: ${e}`));
        }
      }
    }

    // 2. Collect, moving down the query list as searches run dry, then on to the next city.
    let got = 0;
    let throttled = false;
    for (let city = currentCity(); got < perCycle && city !== undefined; city = currentCity()) {
      const query = queries[posOf(city)];
      if (simulate) log(`(simulated collector: ${simulate})`);
      const r = await (simulate
        ? Promise.resolve({ made: [] as string[], throttled: simulate === 'throttle', exhausted: false })
        : collect({ query, type: plan.type, limit: perCycle - got, root, log, menuModel: plan.menuModel, ...(city ? { city } : {}) })
      ).catch((e) => {
        log(`collector error: ${e instanceof Error ? e.message : e}`);
        return { made: [] as string[], throttled: true, exhausted: false };
      });
      got += r.made.length;
      if (r.throttled) {
        throttled = true;
        break;
      }
      if (simulate === 'ok') break;
      if (r.exhausted) {
        setPos(city, posOf(city) + 1);
        const next = currentCity();
        log(`search "${query}"${cityLabel(city)} has nothing new left — ${next === city ? 'next search' : next ? `${city} is done, moving to ${next}` : 'every city is done'}`);
      }
    }
    run.collected += got;
    state.collected += got;
    saveState();

    // 3. Publish whatever is safe.
    const p = await publish(typeDir, { auto: true, dryRun: dryPublish }).catch((e) => {
      log(`publisher error: ${e instanceof Error ? e.message : e}`);
      return { published: 0, duplicate: 0, held: 0, failed: 1 };
    });
    run.published += p.published;
    run.duplicates += p.duplicate;
    run.held = p.held; // held is a standing count, not a running total
    state.published += p.published;
    state.duplicates += p.duplicate;
    saveState();
    log(`cycle ${run.cycles}: collected ${got} · published ${p.published} · duplicates ${p.duplicate} · held ${p.held} · failed ${p.failed}`);

    if (throttled) {
      throttlesInARow++;
      if (throttlesInARow >= MAX_THROTTLES_IN_A_ROW) {
        endReason = `${site} slowed us down twice in a row — ending the run; try again tomorrow`;
        break;
      }
      skipSlots = SKIP_SLOTS_AFTER_THROTTLE[source];
      log(`${site} slowed us down — resting for ${SKIP_SLOTS_AFTER_THROTTLE[source]} slot(s)`);
    } else throttlesInARow = 0;
  }

  saveState();
  log(`END (${endReason}) — this run: ${run.cycles} cycle(s), collected ${run.collected}, published ${run.published}, duplicates ${run.duplicates}, held now ${run.held}`);
  if (run.held) log(`held cafés are still in ${typeDir} — ask Claude to "check the held listings"`);
}

main().catch((e) => {
  console.error(e instanceof Error ? e.stack ?? e.message : e);
  process.exit(1);
});

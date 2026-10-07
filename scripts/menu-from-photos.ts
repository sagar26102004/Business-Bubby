/// <reference types="node" />
/**
 * MENU FROM PHOTOS — read a café's `menu N.jpg` photos with Claude Code
 * (headless `claude -p`, on Sagar's own Claude plan) and write `menu.json`
 * beside them, in the register wizard's paste format.
 *
 *   npx tsx scripts/menu-from-photos.ts "E:\listing\cafe"            (every folder still missing a menu.json)
 *   npx tsx scripts/menu-from-photos.ts "E:\listing\cafe\Some Cafe"  (just that one)
 *   …add --model opus|sonnet|haiku   (default: sonnet — light on plan usage, reads menus well)
 *
 * Claude may only READ (its only allowed tool, scoped to that one folder); it
 * replies with the menu as JSON, and this script checks it with the
 * publisher's own parser before writing anything. Prices it can't read come
 * back null and are listed in review.txt.
 *
 * The photos are never deleted. If Claude is unavailable (a usage limit, no
 * network), the folder keeps its photos and no menu.json — a later cycle, or a
 * person asking Claude in a session, picks it up. (Gemini was used before
 * 2026-10-07 and dropped: it was overloaded for hours at a time.)
 */
import { spawnSync } from 'node:child_process';
import { appendFileSync, existsSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { basename, join } from 'node:path';
import { parseOfferings } from '@/features/offerings/importOfferings';

const DEFAULT_MODEL = 'sonnet';
/** One café's photos take ~1–2 min; anything past this is stuck. */
const CALL_TIMEOUT_MS = 8 * 60_000;
/** After a failed call (usage limit, outage), don't try again for this long. */
const COOLDOWN_MS = 60 * 60_000;
let claudeDownUntil = 0;

const PROMPT = [
  'Read every image file named like "menu 1.jpg" / "menu 2.png" in the current folder — they are pages of one cafe/restaurant menu — and transcribe EVERY dish.',
  'Reply with ONLY a JSON object (no prose, no code fences) shaped as',
  '{ "<Section>": { "<Heading as printed on the menu>": { "<Dish name>": { "price": <number or null>, "veg": <true|false|null>, "description": "<omit if none>" } } } }.',
  'For <Section> use the closest of: Appetizers, Soups, Salads, Main Course, Breads, Rice, Noodles, Pasta, Pizza, Burger, Sandwich, Desserts, Beverages.',
  'When one dish has several prices (sizes or variants like Regular/Large, Half/Full), make one entry per variant, e.g. "Margherita (Regular)".',
  'veg: true for a printed green/veg mark, false for a red/brown/non-veg mark or an obvious meat/egg/fish dish, otherwise null.',
  'Write dish names in normal Title Case and fix obvious typos only. Never guess: a price you cannot read is null; a dish name you cannot read is left out.',
].join('\n');

export const menuPhotos = (dir: string) =>
  existsSync(dir)
    ? readdirSync(dir)
        .filter((f) => /^menu \d+\.(jpe?g|png|webp)$/i.test(f))
        .sort((a, b) => parseInt(a.slice(5), 10) - parseInt(b.slice(5), 10))
    : [];

/** Every leaf with a null/missing price, as "Section › … › Dish". */
function unpriced(node: any, path: string[] = []): string[] {
  const out: string[] = [];
  for (const [k, v] of Object.entries(node ?? {})) {
    if (v && typeof v === 'object' && !('price' in (v as object))) out.push(...unpriced(v, [...path, k]));
    else if (v && typeof v === 'object' && (v as any).price == null) out.push([...path, k].join(' › '));
  }
  return out;
}

/** Run `claude -p` in the café's folder; returns its reply text or throws. */
function askClaude(dir: string, model: string): string {
  // One command string: `claude` is a .cmd shim on Windows, so it needs a shell.
  // The prompt goes in on stdin, so only the folder path needs quoting.
  const res = spawnSync(
    `claude -p --allowedTools Read --add-dir "${dir}" --output-format json --model ${model}`,
    {
      cwd: dir,
      shell: true,
      input: PROMPT,
      encoding: 'utf8',
      timeout: CALL_TIMEOUT_MS,
      maxBuffer: 64 * 1024 * 1024,
      windowsHide: true,
    },
  );
  if (res.error) throw res.error;
  const out = (res.stdout ?? '').trim();
  let parsed: any;
  try {
    parsed = JSON.parse(out);
  } catch {
    throw new Error(`claude exit ${res.status}: ${(res.stderr || out).trim().slice(0, 160)}`);
  }
  if (parsed.is_error) throw new Error(`claude: ${String(parsed.result ?? parsed.subtype).slice(0, 160)}`);
  return String(parsed.result ?? '');
}

/**
 * Read one folder's menu photos into menu.json. Returns true when written.
 * Never throws — a failed read reports and leaves the photos waiting.
 */
export async function menuFromPhotos(dir: string, log = console.log, model = DEFAULT_MODEL): Promise<boolean> {
  const photos = menuPhotos(dir);
  if (!photos.length || existsSync(join(dir, 'menu.json'))) return false;
  if (Date.now() < claudeDownUntil) {
    log(`   menu pending — Claude was unavailable a moment ago; photos kept, retried later`);
    return false;
  }

  for (let attempt = 1; attempt <= 2; attempt++) {
    try {
      const reply = askClaude(dir, model);
      const json = reply.slice(reply.indexOf('{'), reply.lastIndexOf('}') + 1);
      const menu = JSON.parse(json);
      const pretty = JSON.stringify(menu, null, 2);
      const summary = parseOfferings(pretty); // the publisher's own check
      writeFileSync(join(dir, 'menu.json'), pretty);

      // An earlier "menu pending" note is now stale.
      const reviewFile = join(dir, 'review.txt');
      if (existsSync(reviewFile)) {
        const kept = readFileSync(reviewFile, 'utf8').split(/\r?\n/).filter((l) => l && !/^menu pending/.test(l));
        writeFileSync(reviewFile, kept.length ? `${kept.join('\n')}\n` : '');
      }
      const missing = unpriced(menu);
      if (missing.length) {
        appendFileSync(join(dir, 'review.txt'), `menu: ${missing.length} item(s) with no readable price — ${missing.join('; ')}\n`);
      }
      log(`   menu.json ← ${photos.length} photo(s) via Claude (${model}): ${summary.rows.length} items${missing.length ? `, ${missing.length} unpriced` : ''}`);
      return true;
    } catch (e) {
      log(`   Claude read failed (try ${attempt}): ${e instanceof Error ? e.message : e}`);
    }
  }
  claudeDownUntil = Date.now() + COOLDOWN_MS;
  log(`   menu pending — photos kept; Claude reads paused for ${COOLDOWN_MS / 60_000} min`);
  return false;
}

async function main() {
  const args = process.argv.slice(2);
  const target = args.find((a, i) => !a.startsWith('--') && args[i - 1] !== '--model');
  if (!target) throw new Error('Usage: npx tsx scripts/menu-from-photos.ts <folder> [--model sonnet]');
  const model = args.includes('--model') ? args[args.indexOf('--model') + 1] : DEFAULT_MODEL;
  const dirs = menuPhotos(target).length
    ? [target]
    : readdirSync(target).map((d) => join(target, d)).filter((d) => statSync(d).isDirectory());
  let pending = 0;
  for (const dir of dirs) {
    if (!menuPhotos(dir).length || existsSync(join(dir, 'menu.json'))) continue;
    console.log(`━━ ${basename(dir)}`);
    if (!(await menuFromPhotos(dir, console.log, model))) pending++;
  }
  if (pending) console.log(`\n${pending} folder(s) still waiting for a menu — run again later.`);
}

if (process.argv[1] && /menu-from-photos/.test(process.argv[1])) {
  main().catch((e) => {
    console.error(e instanceof Error ? e.message : e);
    process.exit(1);
  });
}

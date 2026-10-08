/// <reference types="node" />
/**
 * MENU — get a café's menu into `menu.json` by WHATEVER source works, best first.
 *
 *   npx tsx scripts/menu-from-photos.ts "E:\listing\cafe"            (every folder still missing a menu.json)
 *   npx tsx scripts/menu-from-photos.ts "E:\listing\cafe\Some Cafe"  (just that one)
 *   …add --model opus|sonnet|haiku   (default: sonnet — light on plan usage, reads menus well)
 *
 * Sagar's rule (2026-10-08): a menu from ANY source beats no menu. The ladder:
 *   1. PHOTOS   `menu N.jpg` read by Claude — the in-café prices, so best.
 *   2. TYPED    `menu.online.json`, Google's typed menu (delivery-app prices,
 *               often a little higher). Used when there are no photos, or when
 *               Claude couldn't read them.
 *   3. ZOMATO   our browser finds the café's Zomato order page (scripts/zomato.ts),
 *               accepted only when the phone (or name + address) matches; Claude
 *               turns the page text into the menu.
 *   4. WEB      Claude searches the café's own site, Magicpin, Swiggy… (its web
 *               tools can't open Zomato or Swiggy themselves, so this rarely hits)
 *               and accepts only a page that is clearly THIS café.
 *   5. none     the café is published without a menu.
 * Wherever it came from is noted in review.txt ("menu source: …").
 *
 * Claude runs headless (`claude -p`, on Sagar's own plan) with only the tools
 * a step needs — Read for photos, WebSearch/WebFetch for the web — and replies
 * with JSON that this script checks with the publisher's own parser before
 * anything is written. If Claude is unavailable (a usage limit, no network),
 * its steps pause for an hour and the ladder falls through to what's left.
 * (Gemini was used before 2026-10-07 and dropped: overloaded for hours, and it
 * read 123 dishes where Claude read ~200.)
 */
import { spawnSync } from 'node:child_process';
import { appendFileSync, existsSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { basename, join } from 'node:path';
import { parseOfferings } from '@/features/offerings/importOfferings';
import { zomatoMenuText } from './zomato';

const DEFAULT_MODEL = 'sonnet';
/** One café takes ~1–2 min (photos) or a few (web); anything past this is stuck. */
const CALL_TIMEOUT_MS = 8 * 60_000;
/** After a failed call (usage limit, outage), don't try Claude again for this long. */
const COOLDOWN_MS = 60 * 60_000;
let claudeDownUntil = 0;

const SHAPE = [
  'Reply with ONLY a JSON object (no prose, no code fences) shaped as',
  '{ "<Section>": { "<Heading as on the menu>": { "<Dish name>": { "price": <number or null>, "veg": <true|false|null>, "description": "<omit if none>" } } } }.',
  'For <Section> use the closest of: Appetizers, Soups, Salads, Main Course, Breads, Rice, Noodles, Pasta, Pizza, Burger, Sandwich, Desserts, Beverages.',
  'When one dish has several prices (sizes or variants like Regular/Large, Half/Full), make one entry per variant, e.g. "Margherita (Regular)".',
  'veg: true for a veg mark, false for a non-veg mark or an obvious meat/egg/fish dish, otherwise null.',
  'Write dish names in normal Title Case and fix obvious typos only. Never guess: a price you cannot read is null; a dish you cannot read is left out.',
].join('\n');

const PHOTO_PROMPT = [
  'Read every image file named like "menu 1.jpg" / "menu 2.png" in the current folder — they are pages of one cafe/restaurant menu — and transcribe EVERY dish.',
  SHAPE,
].join('\n');

const ZOMATO_PROMPT = [
  'Read the file zomato.txt in the current folder. It is the text of one cafe/restaurant\'s Zomato order page.',
  'Transcribe EVERY dish of its menu with its price. Ignore reviews, offers/coupons, ratings, "similar restaurants" and anything that is not a menu item.',
  'When an item shows two prices (a discounted one and the original), use the ORIGINAL (higher) price, as a whole number of rupees.',
  'Leave out any description that is cut off with "..." — keep only complete ones (e.g. "5 Pcs", "350 ml").',
  SHAPE,
].join('\n');

const webPrompt = (name: string, where: string) =>
  [
    `Find the current food menu of the cafe/restaurant "${name}" at ${where}, India.`,
    'Search Zomato, Swiggy, the place\'s own website or Instagram, Magicpin, EazyDiner, Dineout or any other menu listing.',
    'Use ONLY a page that is clearly this exact place (same name AND same area/address) — never a same-named place elsewhere, never a generic or sample menu.',
    'Transcribe every dish with its price from that page.',
    SHAPE,
    'If you cannot find a menu for this exact place, reply with exactly {} and nothing else.',
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

/** Run `claude -p` in the café's folder with only `tools`; returns its reply text or throws. */
function askClaude(dir: string, model: string, prompt: string, tools: string): string {
  // One command string: `claude` is a .cmd shim on Windows, so it needs a shell.
  // The prompt goes in on stdin, so only the folder path needs quoting.
  const res = spawnSync(
    `claude -p --allowedTools ${tools} --add-dir "${dir}" --output-format json --model ${model}`,
    {
      cwd: dir,
      shell: true,
      input: prompt,
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

/** A reply → a checked menu object, or null when it holds no dishes. Throws on a malformed reply. */
function toMenu(reply: string): Record<string, unknown> | null {
  const start = reply.indexOf('{');
  if (start < 0) return null;
  const menu = JSON.parse(reply.slice(start, reply.lastIndexOf('}') + 1));
  if (!menu || typeof menu !== 'object' || !Object.keys(menu).length) return null;
  parseOfferings(JSON.stringify(menu)); // the publisher's own check — throws if it won't import
  return menu;
}

/** Write menu.json + its notes; drop a stale "menu pending" line. */
function saveMenu(dir: string, menu: Record<string, unknown>, source: string, log: (l: string) => void) {
  const pretty = JSON.stringify(menu, null, 2);
  const rows = parseOfferings(pretty).rows.length;
  writeFileSync(join(dir, 'menu.json'), pretty);
  const reviewFile = join(dir, 'review.txt');
  const kept = existsSync(reviewFile)
    ? readFileSync(reviewFile, 'utf8').split(/\r?\n/).filter((l) => l && !/^menu pending|^no menu on Google/.test(l))
    : [];
  kept.push(`menu source: ${source} (${rows} items)`);
  const missing = unpriced(menu);
  if (missing.length) kept.push(`menu: ${missing.length} item(s) with no readable price — ${missing.join('; ')}`);
  writeFileSync(reviewFile, `${kept.join('\n')}\n`);
  log(`   menu.json ← ${source}: ${rows} items${missing.length ? `, ${missing.length} unpriced` : ''}`);
}

/** Ask Claude (twice at most); on failure pause Claude for COOLDOWN_MS. */
function claudeMenu(dir: string, model: string, prompt: string, tools: string, what: string, log: (l: string) => void) {
  if (Date.now() < claudeDownUntil) {
    log(`   ${what}: skipped — Claude was unavailable a moment ago`);
    return { menu: null, failed: true };
  }
  for (let attempt = 1; attempt <= 2; attempt++) {
    try {
      return { menu: toMenu(askClaude(dir, model, prompt, tools)), failed: false };
    } catch (e) {
      log(`   ${what} failed (try ${attempt}): ${e instanceof Error ? e.message : e}`);
    }
  }
  claudeDownUntil = Date.now() + COOLDOWN_MS;
  log(`   Claude paused for ${COOLDOWN_MS / 60_000} min`);
  return { menu: null, failed: true };
}

export type MenuOutcome = 'photos' | 'typed' | 'zomato' | 'web' | 'none' | 'pending' | 'exists';

/**
 * Get this folder a menu.json by the ladder above. Never throws.
 * 'pending' = there ARE menu photos, Claude couldn't read them and nothing
 * else worked — the folder is held and retried; 'none' = no source has one.
 */
export async function ensureMenu(dir: string, log: (l: string) => void = console.log, model = DEFAULT_MODEL): Promise<MenuOutcome> {
  if (existsSync(join(dir, 'menu.json'))) return 'exists';
  const photos = menuPhotos(dir);

  // 1. Photos.
  let photosFailed = false;
  if (photos.length) {
    const r = claudeMenu(dir, model, PHOTO_PROMPT, 'Read', `reading ${photos.length} menu photo(s)`, log);
    if (r.menu) {
      saveMenu(dir, r.menu, `${photos.length} menu photo(s), read by Claude`, log);
      return 'photos';
    }
    photosFailed = r.failed;
  }

  // 2. Google's typed menu.
  const typedFile = join(dir, 'menu.online.json');
  if (existsSync(typedFile)) {
    try {
      const typed = toMenu(readFileSync(typedFile, 'utf8'));
      if (typed) {
        saveMenu(dir, typed, "Google's typed menu (delivery-app prices)", log);
        return 'typed';
      }
    } catch (e) {
      log(`   typed menu unusable: ${e instanceof Error ? e.message : e}`);
    }
  }

  // 3. Zomato, through our own browser.
  const factsFile = join(dir, 'listing.json');
  const facts = existsSync(factsFile) ? JSON.parse(readFileSync(factsFile, 'utf8')) : null;
  if (facts && Date.now() >= claudeDownUntil) {
    const z = await zomatoMenuText(
      { name: facts.name ?? basename(dir), phone: facts.phone, addressLine: facts.location?.addressLine, city: facts.location?.city },
      log,
    );
    if (z) {
      writeFileSync(join(dir, 'zomato.txt'), `${z.url}\n\n${z.text}`);
      const r = claudeMenu(dir, model, ZOMATO_PROMPT, 'Read', 'reading the Zomato page', log);
      if (r.menu) {
        saveMenu(dir, r.menu, `Zomato (${z.url}), read by Claude`, log);
        return 'zomato';
      }
    }
  }

  // 4. The wider web (own site, Magicpin, …).
  if (facts) {
    const where = [facts.location?.addressLine, facts.location?.city ?? 'Indore', facts.location?.region].filter(Boolean).join(', ');
    const r = claudeMenu(dir, model, webPrompt(facts.name ?? basename(dir), where), 'WebSearch,WebFetch', 'searching the web for the menu', log);
    if (r.menu) {
      saveMenu(dir, r.menu, 'the web (own site / Magicpin / …), found by Claude', log);
      return 'web';
    }
    if (!r.failed) log('   no menu found on the web for this exact place');
  }

  // 5. Nothing. Photos we couldn't read yet are worth waiting for; otherwise go without.
  if (photos.length && photosFailed) {
    const reviewFile = join(dir, 'review.txt');
    const note = 'menu pending — Claude could not read the photos yet; retried next cycle';
    const text = existsSync(reviewFile) ? readFileSync(reviewFile, 'utf8') : '';
    if (!text.includes(note)) appendFileSync(reviewFile, `${note}\n`);
    log(`   ${note}`);
    return 'pending';
  }
  appendFileSync(join(dir, 'review.txt'), 'menu source: none found (photos, Google, Zomato, web) — listed without a menu\n');
  log('   no menu from any source — will be listed without one');
  return 'none';
}

/** @deprecated name kept for callers from before the ladder; same as ensureMenu. */
export const menuFromPhotos = async (dir: string, log: (l: string) => void = console.log, model = DEFAULT_MODEL) =>
  ['photos', 'typed', 'zomato', 'web'].includes(await ensureMenu(dir, log, model));

async function main() {
  const args = process.argv.slice(2);
  const target = args.find((a, i) => !a.startsWith('--') && args[i - 1] !== '--model');
  if (!target) throw new Error('Usage: npx tsx scripts/menu-from-photos.ts <folder> [--model sonnet]');
  const model = args.includes('--model') ? args[args.indexOf('--model') + 1] : DEFAULT_MODEL;
  const dirs = existsSync(join(target, 'listing.json'))
    ? [target]
    : readdirSync(target).map((d) => join(target, d)).filter((d) => statSync(d).isDirectory());
  const tally: Record<string, number> = {};
  for (const dir of dirs) {
    if (existsSync(join(dir, 'menu.json'))) continue;
    console.log(`━━ ${basename(dir)}`);
    const o = await ensureMenu(dir, console.log, model);
    tally[o] = (tally[o] ?? 0) + 1;
  }
  console.log(`\n${Object.entries(tally).map(([k, n]) => `${k}: ${n}`).join(' · ') || 'nothing to do'}`);
}

if (process.argv[1] && /menu-from-photos/.test(process.argv[1])) {
  main().catch((e) => {
    console.error(e instanceof Error ? e.message : e);
    process.exit(1);
  });
}

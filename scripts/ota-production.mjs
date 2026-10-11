#!/usr/bin/env node
/**
 * Push a JavaScript-only update (OTA) to the Play build:
 *
 *     npm run ota -- "Show demo listings to everyone"
 *
 * WHY A SCRIPT, not a bare `eas update`: the update's JS bundle is built on
 * THIS machine, and Metro inlines every EXPO_PUBLIC_* variable it finds —
 * including the ones in the local `.env` (call diagnostics, dev tools, the seed
 * password). Shipped to customers, that would put a testing card in front of
 * them. So this turns `.env` loading off and passes ONLY the production
 * profile's env from eas.json — the same three values the GitHub Actions AAB
 * build uses.
 *
 * What reaches phones: only builds whose runtimeVersion matches (app.json
 * `version`, policy `appVersion`) and which ask for the `production` channel
 * (app.json `updates.requestHeaders`). Anything native — a new library, a
 * permission, a plugin — still needs a new AAB, AND a bumped `version` so old
 * builds never pick up JS they can't run.
 */
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';

const isWin = process.platform === 'win32';
const message = process.argv.slice(2).join(' ').trim();
if (!message) {
  console.error('Usage: npm run ota -- "what changed"');
  process.exit(1);
}

const eas = JSON.parse(readFileSync(new URL('../eas.json', import.meta.url), 'utf8'));
const prodEnv = eas.build?.production?.env ?? {};

// Drop every EXPO_PUBLIC_* already in the shell, then add production's own.
const env = Object.fromEntries(Object.entries(process.env).filter(([k]) => !k.startsWith('EXPO_PUBLIC_')));
Object.assign(env, prodEnv, { EXPO_NO_DOTENV: '1', NODE_ENV: 'production' });

console.log('Publishing to channel "production" with:');
for (const [k, v] of Object.entries(prodEnv)) console.log(`  ${k}=${v}`);

const result = spawnSync(
  'npx',
  // On Windows npx is a .cmd and needs a shell, which would split the message
  // on spaces — so quote it there, and only there.
  ['eas-cli', 'update', '--channel', 'production', '--platform', 'android', '--message', isWin ? JSON.stringify(message) : message],
  { stdio: 'inherit', env, shell: isWin },
);
process.exit(result.status ?? 1);

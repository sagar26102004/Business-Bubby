/// <reference types="node" />
/**
 * ADD MENUS — give LIVE food listings that have no menu one, by the menu rule.
 *
 *   npx tsx scripts/add-menus.ts [--dry-run]            (every live food listing with an empty menu)
 *   npx tsx scripts/add-menus.ts --ids <id>,<id> [--dry-run]
 *
 * For listings published before a menu could be found (or before the menu rule
 * existed). Their Google photos are gone with their folders, so this runs the
 * later rungs of ensureMenu — Zomato, then the wider web — in a work folder
 * per listing under E:\listing\_menus\, then writes the menu onto the live row
 * as the super-admin (the same MenuItem shape the publisher writes). Work
 * folders are removed once a menu is saved; a listing nothing is found for
 * stays menu-less and is reported.
 */
import { createClient } from '@supabase/supabase-js';
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { Business } from '@/domain/types';
import { isFoodShop } from '@/domain/tags';
import { parseOfferings, toMenuItem } from '@/features/offerings/importOfferings';
import { folderName, need } from './listing-lib';
import { ensureMenu } from './menu-from-photos';

const WORK = 'E:/listing/_menus';

async function main() {
  const args = process.argv.slice(2);
  const dryRun = args.includes('--dry-run');
  const ids = args.includes('--ids') ? args[args.indexOf('--ids') + 1].split(',') : null;

  const sb = createClient(need('EXPO_PUBLIC_SUPABASE_URL'), need('EXPO_PUBLIC_SUPABASE_ANON_KEY'), {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const login = need('LISTING_LOGIN').trim().toLowerCase();
  const password = need('LISTING_PASSWORD');
  let auth = await sb.auth.signInWithPassword({ email: `${login}@localo.app`, password });
  if (auth.error && /^\d+$/.test(login)) {
    const { data: email } = await sb.rpc('resolve_login_email', { p_phone: login, p_password: password });
    if (typeof email === 'string' && email) auth = await sb.auth.signInWithPassword({ email, password });
  }
  if (auth.error || !auth.data.user) throw new Error(`Sign-in failed: ${auth.error?.message ?? 'no user'}`);

  let q = sb.from('businesses').select('id, data');
  if (ids) q = q.in('id', ids);
  const { data: rows, error } = await q;
  if (error) throw error;
  const targets = (rows ?? [])
    .map((r) => r.data as Business)
    .filter((b) => isFoodShop(b.tags ?? []) && !(b.menu?.length));
  console.log(`${targets.length} live food listing(s) without a menu${dryRun ? ' (dry run)' : ''}`);

  const results: string[] = [];
  for (const b of targets) {
    console.log(`\n━━ ${b.name}`);
    const dir = join(WORK, folderName(b.name));
    mkdirSync(dir, { recursive: true });
    writeFileSync(
      join(dir, 'listing.json'),
      JSON.stringify({ name: b.name, phone: b.phone, location: { addressLine: b.location.addressLine, city: b.location.city ?? 'Indore', region: b.location.region } }, null, 2),
    );
    const outcome = await ensureMenu(dir, (l) => console.log(l));
    const menuFile = join(dir, 'menu.json');
    if (!existsSync(menuFile)) {
      results.push(`✖ ${b.name} — no menu found anywhere`);
      continue;
    }
    const menu = parseOfferings(readFileSync(menuFile, 'utf8')).rows.map(toMenuItem);
    if (dryRun) {
      results.push(`• ${b.name} — would get ${menu.length} items (${outcome}); kept in ${dir}`);
      continue;
    }
    const next = JSON.parse(JSON.stringify({ ...b, menu }));
    const { error: uErr } = await sb.from('businesses').update({ data: next }).eq('id', b.id);
    if (uErr) {
      results.push(`✖ ${b.name} — save failed: ${uErr.message}`);
      continue;
    }
    rmSync(dir, { recursive: true, force: true });
    results.push(`✔ ${b.name} — ${menu.length} items from ${outcome}`);
  }
  await sb.auth.signOut({ scope: 'local' });
  console.log(`\n${results.join('\n') || 'nothing to do'}`);
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});

/**
 * OWNER ACCOUNTS — give every listing still under the super-admin its own
 * account, so the real owner can sign in straight away.
 *
 *   npx tsx scripts/owner-accounts.ts --dry-run   print the handle each would get
 *   npx tsx scripts/owner-accounts.ts --limit 2   do at most N this run
 *   npx tsx scripts/owner-accounts.ts             do every one left
 *
 * For each listing owned by LISTING_LOGIN (never demo listings — those have
 * their own bot accounts):
 *   1. sign up `<handle>` / OWNER_PASSWORD (listing-lib: ownerHandle, createOwnerAccount),
 *   2. move the listing to it as the super-admin, `listingActive: false`.
 * It turns active the first time anyone signs in to that account (migration 0028).
 *
 * Progress + credentials: E:\listing\owner-accounts.json — a re-run skips what
 * is done, and an account made by an interrupted run is reused, not remade.
 */
/// <reference types="node" />
import type { Business } from '@/domain/types';
import {
  OWNER_PASSWORD,
  anonClient,
  createOwnerAccount,
  ownerHandle,
  readOwnerAccounts,
  signIn,
  sleep,
  transferListing,
  writeOwnerAccounts,
} from './listing-lib';

async function main() {
  const args = process.argv.slice(2);
  const dryRun = args.includes('--dry-run');
  const limitAt = args.indexOf('--limit');
  const limit = limitAt >= 0 ? Number(args[limitAt + 1]) : Infinity;

  const admin = anonClient();
  const adminId = await signIn(admin);

  const listings: Business[] = [];
  for (let from = 0; ; from += 1000) {
    const { data, error } = await admin
      .from('businesses')
      .select('data')
      .eq('owner_id', adminId)
      .order('id')
      .range(from, from + 999);
    if (error) throw error;
    for (const r of data ?? []) listings.push(r.data as Business);
    if (!data || data.length < 1000) break;
  }
  const todo = listings.filter((b) => !b.demo).sort((a, b) => a.name.localeCompare(b.name));

  const done = readOwnerAccounts();
  const taken = new Set(Object.values(done).map((a) => a.username));
  console.log(`${todo.length} listing(s) under the super-admin${dryRun ? ' (dry run)' : ''}\n`);

  if (dryRun) {
    // Same suffix rule as the real run, against handles used so far. A handle a
    // stranger already registered would get the next suffix at run time.
    let suffixed = 0;
    for (const b of todo) {
      const known = done[b.id];
      let n = 1;
      while (!known && taken.has(ownerHandle(b.name, n))) n++;
      const handle = known?.username ?? ownerHandle(b.name, n);
      taken.add(handle);
      if (n > 1) suffixed++;
      console.log(`${handle.padEnd(21)} ${b.name}${n > 1 ? '   ← suffixed' : ''}`);
    }
    console.log(`\n${todo.length} handles, ${suffixed} suffixed. Password for all: ${OWNER_PASSWORD}`);
    return;
  }

  let count = 0;
  for (const b of todo) {
    if (count >= limit) break;
    try {
      let account = done[b.id];
      if (!account) {
        const made = await createOwnerAccount(b.name, taken);
        account = { ...made, name: b.name, createdAt: new Date().toISOString() };
        done[b.id] = account;
        writeOwnerAccounts(done);
      }
      await transferListing(admin, b.id, account.userId);
      console.log(`✓ ${account.username.padEnd(21)} ${b.name}`);
      count++;
      await sleep(1500);
    } catch (e) {
      console.log(`✖ ${b.name} — ${(e as Error).message}`);
    }
  }
  console.log(`\n${count} listing(s) handed to their own account. Password for all: ${OWNER_PASSWORD}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

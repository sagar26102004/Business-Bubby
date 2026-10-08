/**
 * DEMO LISTINGS — sample businesses whose only job is to fill the Deals feed
 * when showing the concept to business owners.
 *
 *   npx tsx scripts/demo-listings.ts            publish everything not yet done
 *   npx tsx scripts/demo-listings.ts --dry-run  show what would be made
 *   npx tsx scripts/demo-listings.ts --limit 1  publish at most N this run
 *   npx tsx scripts/demo-listings.ts --remove   delete every demo listing again
 *
 * Reads scripts/demo-listings.json. Each entry becomes:
 *   - an account `bot<name>` (no spaces, ≤20 chars) with the shared password,
 *   - ONE business owned by it, marked `demo: true`,
 *   - ONE live offer carrying the poster (or the reel + a still from it).
 *
 * `demo: true` is what keeps them away from real customers: every public list,
 * Home's ad slot and the Deals feed drop demo listings unless the signed-in
 * viewer is a platform admin or a `bot…` account (`isListedPublicly` in
 * src/lib/onHold.ts). Don't publish anything here without that flag.
 *
 * Progress lives in E:\listing\demo\results.json, so a re-run picks up where
 * an interrupted one stopped.
 */
/// <reference types="node" />
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { randomUUID } from 'node:crypto';
import { existsSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { basename, extname, isAbsolute, join } from 'node:path';
import type { Business, BusinessLocation, Offer } from '@/domain/types';
import { suggestModules } from '@/domain/modules';
import { storedUrl } from '@/lib/media';
import type { MediaKind } from '@/lib/upload';
import { need, sleep } from './listing-lib';

interface Entry {
  name: string;
  tags: string[];
  area: string;
  point: [number, number];
  image?: string;
  reel?: string;
  offer: { tag: string; title: string; description?: string; price?: string };
}
interface Manifest {
  posterDir: string;
  reelDir: string;
  password: string;
  listings: Entry[];
}
interface Result {
  username: string;
  userId: string;
  businessId: string;
}

const MANIFEST = join(process.cwd(), 'scripts', 'demo-listings.json');
const RESULTS = 'E:\\listing\\demo\\results.json';
const USERNAME_MAX = 20;

const usernameFor = (name: string) => `bot${name.toLowerCase().replace(/[^a-z0-9]/g, '')}`.slice(0, USERNAME_MAX);

const client = () =>
  createClient(need('EXPO_PUBLIC_SUPABASE_URL'), need('EXPO_PUBLIC_SUPABASE_ANON_KEY'), {
    auth: { persistSession: false, autoRefreshToken: false },
  });

function loadResults(): Record<string, Result> {
  return existsSync(RESULTS) ? JSON.parse(readFileSync(RESULTS, 'utf8')) : {};
}
function saveResults(r: Record<string, Result>) {
  writeFileSync(RESULTS, JSON.stringify(r, null, 2));
}

/** Sign in as the bot, creating the account first if it doesn't exist. */
async function signInBot(sb: SupabaseClient, username: string, name: string, password: string): Promise<string> {
  const email = `${username}@localo.app`;
  let res = await sb.auth.signInWithPassword({ email, password });
  if (res.error) {
    const up = await sb.auth.signUp({ email, password, options: { data: { name, username } } });
    if (up.error) throw new Error(`sign-up ${username}: ${up.error.message}`);
    res = await sb.auth.signInWithPassword({ email, password });
  }
  if (res.error || !res.data.user) throw new Error(`sign-in ${username}: ${res.error?.message ?? 'no user'}`);
  return res.data.user.id;
}

/** Node twin of src/lib/cloudinary.ts — sign at the edge function, POST straight to Cloudinary. */
async function upload(sb: SupabaseClient, file: string, kind: MediaKind): Promise<string> {
  const bytes = statSync(file).size;
  const ext = extname(file).slice(1).toLowerCase().replace('jpeg', 'jpg');
  const contentType = kind === 'video' ? `video/${ext}` : ext === 'jpg' ? 'image/jpeg' : `image/${ext}`;
  const { data, error } = await sb.functions.invoke('cloudinary-sign', { body: { kind, ext, bytes } });
  if (error) {
    const body = await (error as { context?: Response }).context?.json?.().catch(() => null);
    throw new Error(`cloudinary-sign: ${body?.error ?? error.message}`);
  }
  const sig = data as {
    apiKey: string; timestamp: string; signature: string; publicId: string;
    uploadPreset: string; transformation?: string; uploadUrl: string;
  };
  const form = new FormData();
  form.append('file', new Blob([readFileSync(file)], { type: contentType }), `${sig.publicId.split('/').pop()}.${ext}`);
  form.append('api_key', sig.apiKey);
  form.append('timestamp', sig.timestamp);
  form.append('signature', sig.signature);
  form.append('public_id', sig.publicId);
  form.append('upload_preset', sig.uploadPreset);
  if (sig.transformation) form.append('transformation', sig.transformation);
  const res = await fetch(sig.uploadUrl, { method: 'POST', body: form });
  const body = (await res.json().catch(() => null)) as { secure_url?: string; error?: { message?: string } } | null;
  if (!res.ok || !body?.secure_url) throw new Error(`Cloudinary refused ${basename(file)}: ${body?.error?.message ?? res.status}`);
  return storedUrl(body.secure_url, kind);
}

function mediaFor(m: Manifest, e: Entry): { image: string; video?: string } {
  if (e.reel) return { image: join(m.reelDir, `${e.reel}.jpg`), video: join(m.reelDir, `${e.reel}.mp4`) };
  if (!e.image) throw new Error(`${e.name}: no image or reel`);
  return { image: isAbsolute(e.image) ? e.image : join(m.posterDir, e.image) };
}

async function publish(m: Manifest, e: Entry, username: string): Promise<Result> {
  const sb = client();
  const userId = await signInBot(sb, username, e.name, m.password);
  const media = mediaFor(m, e);
  const imageUrl = await upload(sb, media.image, 'image');
  const videoUrl = media.video ? await upload(sb, media.video, 'video') : undefined;

  const now = new Date().toISOString();
  const offer: Offer = {
    id: randomUUID(),
    title: e.offer.title,
    description: e.offer.description,
    tag: e.offer.tag,
    imageUrl,
    videoUrl,
    lines: [],
    price: e.offer.price,
    active: true,
    createdAt: now,
  };
  const location: BusinessLocation = {
    kind: 'office',
    isHome: false,
    hidePreciseLocation: false,
    addressLine: e.area,
    city: 'Indore',
    region: 'Madhya Pradesh',
    country: 'India',
    point: { latitude: e.point[0], longitude: e.point[1] },
  };
  const id = randomUUID();
  const business: Business = {
    id,
    ownerId: userId,
    name: e.name,
    type: 'shop',
    tags: e.tags,
    location,
    modules: suggestModules({ type: 'shop', tags: e.tags, hasMenu: false }),
    offers: [offer],
    demo: true,
    employeeIds: [],
    callHandlerIds: [],
    ownerHandlesCalls: true,
    chatRecipientIds: [],
    createdAt: now,
  };
  const data = JSON.parse(JSON.stringify(business));
  const { error } = await sb.from('businesses').insert({ id, owner_id: userId, type: 'shop', data });
  if (error) throw error;
  await sb.auth.signOut();
  return { username, userId, businessId: id };
}

async function remove(m: Manifest) {
  const results = loadResults();
  for (const [name, r] of Object.entries(results)) {
    const sb = client();
    await signInBot(sb, r.username, name, m.password);
    const { error } = await sb.from('businesses').delete().eq('id', r.businessId);
    console.log(error ? `✖ ${name}: ${error.message}` : `🗑 ${name}`);
    if (!error) delete results[name];
    saveResults(results);
    await sb.auth.signOut();
  }
  console.log('\nListings removed. The bot accounts still exist — delete them in the Supabase dashboard if wanted.');
}

async function main() {
  const m = JSON.parse(readFileSync(MANIFEST, 'utf8')) as Manifest;
  const dryRun = process.argv.includes('--dry-run');
  if (process.argv.includes('--remove')) return remove(m);

  const results = loadResults();
  const taken = new Set(Object.values(results).map((r) => r.username));
  const li = process.argv.indexOf('--limit');
  const limit = li > 0 ? Number(process.argv[li + 1]) : Infinity;
  let done = 0;
  for (const e of m.listings) {
    if (results[e.name]) continue;
    if (done >= limit) break;
    let username = usernameFor(e.name);
    for (let n = 2; taken.has(username); n++) username = `${usernameFor(e.name).slice(0, USERNAME_MAX - 1)}${n}`;
    taken.add(username);
    const media = mediaFor(m, e);
    for (const f of [media.image, media.video]) if (f && !existsSync(f)) throw new Error(`${e.name}: missing ${f}`);
    console.log(`━━ ${e.name}  @${username}  ${e.area}  [${e.offer.tag}] ${e.offer.title}${media.video ? '  🎬' : ''}`);
    if (dryRun) continue;
    try {
      results[e.name] = await publish(m, e, username);
      saveResults(results);
      done++;
      console.log(`   ✔ /business/${results[e.name].businessId}`);
    } catch (err) {
      console.log(`   ✖ ${err instanceof Error ? err.message : JSON.stringify(err)}`);
      if (/rate limit/i.test(String(err))) {
        console.log('   rate-limited — waiting 5 minutes');
        await sleep(300_000);
      }
    }
    await sleep(4000); // stay well under Supabase's auth rate limits
  }
  console.log(`\n${dryRun ? 'dry run' : `${done} published`} — ${Object.keys(results).length}/${m.listings.length} done in total`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

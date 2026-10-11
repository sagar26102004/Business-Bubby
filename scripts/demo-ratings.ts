/**
 * DEMO RATINGS — fills the 57 DEMO listings (`demo: true`, see demo-listings.ts)
 * with a believable rating history, so an owner being pitched sees what a busy
 * listing looks like: 250–300 ratings each, about 10 of them written, mostly
 * 4–5 stars.
 *
 *   npx tsx scripts/demo-ratings.ts --dry-run   plan + print the star spread, write nothing
 *   npx tsx scripts/demo-ratings.ts             create the raters and post their ratings
 *   npx tsx scripts/demo-ratings.ts --limit 20  process at most N raters this run
 *
 * ONLY `demo: true` businesses are rated — real listings are never touched.
 *
 * 500 rater accounts `botr…` (Indian names, password from the demo manifest)
 * are made through ordinary sign-up, and each posts its own ratings under RLS,
 * exactly as the app would. Sign-up is rate limited by Supabase, so the run
 * backs off and retries; progress lives in E:\listing\demo\raters.json and a
 * re-run picks up where it stopped.
 *
 * Undo (reviews only; the accounts stay, like the demo-listing bots):
 *   npx supabase db query "delete from reviews where customer_id in
 *     (select id from profiles where data->>'username' like 'botr%')" --linked
 */
/// <reference types="node" />
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { randomUUID } from 'node:crypto';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { Business, Review } from '@/domain/types';
import { isFoodShop } from '@/domain/tags';
import { need, sleep } from './listing-lib';

const RATERS = 500;
const MIN_RATINGS = 250;
const MAX_RATINGS = 300;
const WRITTEN = 10;
const PROGRESS = 'E:\\listing\\demo\\raters.json';
const USERNAME_MAX = 20;
const DRY = process.argv.includes('--dry-run');
const LIMIT = (() => {
  const i = process.argv.indexOf('--limit');
  return i > 0 ? Number(process.argv[i + 1]) : Infinity;
})();

// ---- deterministic randomness, so a re-run plans the same thing ----
let seed = 20261009;
const rand = () => {
  seed = (seed * 1664525 + 1013904223) % 4294967296;
  return seed / 4294967296;
};
const pick = <T>(xs: readonly T[]) => xs[Math.floor(rand() * xs.length)];
const shuffle = <T>(xs: T[]) => {
  for (let i = xs.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [xs[i], xs[j]] = [xs[j], xs[i]];
  }
  return xs;
};

// ---- names ----
const MALE = [
  'Aarav', 'Aditya', 'Akash', 'Alok', 'Amit', 'Anand', 'Ankit', 'Anuj', 'Arjun', 'Ashish', 'Ayush', 'Bhavesh',
  'Chetan', 'Darshan', 'Deepak', 'Dev', 'Dhruv', 'Gaurav', 'Harsh', 'Hemant', 'Himanshu', 'Ishaan', 'Jatin',
  'Kabir', 'Kamal', 'Kartik', 'Kunal', 'Lokesh', 'Mahesh', 'Manish', 'Mayank', 'Mohit', 'Naveen', 'Nikhil',
  'Nitin', 'Pankaj', 'Paras', 'Pradeep', 'Pranav', 'Prateek', 'Rahul', 'Rajat', 'Rajesh', 'Rakesh', 'Ravi',
  'Rohan', 'Rohit', 'Sachin', 'Sahil', 'Sandeep', 'Sanjay', 'Saurabh', 'Shivam', 'Shubham', 'Siddharth',
  'Sumit', 'Sunil', 'Suresh', 'Tarun', 'Tushar', 'Umesh', 'Varun', 'Vikas', 'Vinay', 'Vishal', 'Vivek',
  'Yash', 'Yogesh', 'Imran', 'Faizan', 'Arif', 'Sameer', 'Harpreet', 'Gurpreet', 'Abhishek', 'Krishna',
];
const FEMALE = [
  'Aaradhya', 'Aditi', 'Akanksha', 'Ananya', 'Anjali', 'Ankita', 'Anushka', 'Archana', 'Bhavna', 'Deepika',
  'Divya', 'Ekta', 'Garima', 'Isha', 'Jyoti', 'Kavya', 'Khushi', 'Kirti', 'Komal', 'Kritika', 'Laxmi',
  'Megha', 'Meenal', 'Neha', 'Nidhi', 'Nikita', 'Pallavi', 'Payal', 'Pooja', 'Prachi', 'Priya', 'Radhika',
  'Rashmi', 'Riya', 'Ruchi', 'Sakshi', 'Saloni', 'Sapna', 'Shikha', 'Shivani', 'Shreya', 'Shruti', 'Simran',
  'Sneha', 'Sonal', 'Sonam', 'Swati', 'Tanvi', 'Tanya', 'Trisha', 'Vaishali', 'Vandana', 'Varsha', 'Yamini',
  'Ayesha', 'Sana', 'Zoya', 'Mansi', 'Muskan', 'Palak', 'Rupali', 'Srishti',
];
const SURNAMES = [
  'Sharma', 'Verma', 'Jain', 'Patel', 'Rathore', 'Chouhan', 'Agrawal', 'Malviya', 'Yadav', 'Gupta', 'Joshi',
  'Tiwari', 'Mishra', 'Dubey', 'Pandey', 'Solanki', 'Parmar', 'Thakur', 'Singh', 'Khandelwal', 'Maheshwari',
  'Choudhary', 'Rajput', 'Saxena', 'Shrivastava', 'Trivedi', 'Vyas', 'Bhatia', 'Mehta', 'Shah', 'Kushwaha',
  'Sen', 'Nagar', 'Dixit', 'Goyal', 'Bansal', 'Mittal', 'Soni', 'Rao', 'Nair', 'Iyer', 'Kulkarni', 'Deshmukh',
  'Patil', 'Kapoor', 'Malhotra', 'Arora', 'Khan', 'Qureshi', 'Sheikh', 'Gill', 'Bais', 'Tomar', 'Bhadoriya',
];

function makeRaters(): { name: string; username: string }[] {
  const seen = new Set<string>();
  const out: { name: string; username: string }[] = [];
  while (out.length < RATERS) {
    const first = rand() < 0.55 ? pick(MALE) : pick(FEMALE);
    const name = `${first} ${pick(SURNAMES)}`;
    if (seen.has(name)) continue;
    seen.add(name);
    const base = `botr${name.toLowerCase().replace(/[^a-z]/g, '')}`.slice(0, USERNAME_MAX - 3);
    out.push({ name, username: `${base}${out.length}` });
  }
  return out;
}

// ---- stars: no more than ~1.5% 1–2★, so a low rating is rare but present ----
function stars(): number {
  const r = rand();
  if (r < 0.005) return 1;
  if (r < 0.015) return 2;
  if (r < 0.12) return 3;
  if (r < 0.43) return 4;
  return 5;
}

const FOOD_GOOD = [
  'Taste is consistently good and the portions are generous. Our regular weekend spot now.',
  'Coffee was fresh and the staff were very polite. Will definitely come again.',
  'Ordered for a family get-together, everything arrived hot and on time. Paneer was excellent.',
  'Value for money. The combo offer is genuinely worth it.',
  'Clean place, quick service and the food tastes homemade. Highly recommended.',
  'Bahut accha khana, especially the snacks. Price bhi reasonable hai.',
  'Loved the ambience and the cold coffee. Good place to sit with friends.',
  'Fresh ingredients, nothing oily. My kids loved it.',
  'Tried the deal from the app, got exactly what was shown. Happy with the service.',
  'Fast service even on a busy Sunday evening. Food quality is top notch.',
  'Staff remembered our order from last time, small things like that matter.',
  'Best in the area for the price. The desserts are a must try.',
];
const OTHER_GOOD = [
  'Very professional and on time. Explained everything clearly before starting.',
  'Good quality and honest pricing. Did not try to upsell anything.',
  'Quick response on chat and the work was finished the same day.',
  'Have been coming here for a while, always a good experience.',
  'Staff is friendly and helpful. Got exactly what I was looking for.',
  'Kaam bahut accha kiya, time pe aaye aur saaf safai se kaam kiya.',
  'Fair rates compared to others nearby. Would recommend to friends.',
  'Booked through the app, everything went smoothly.',
  'Good collection and reasonable prices. Owner is very cooperative.',
  'Trustworthy people. Second time using them and still very satisfied.',
  'Neat work and good after-service support.',
  'Took the offer shown on the app and it was honoured without any fuss.',
];
const MEH = [
  'Decent overall, but had to wait a bit longer than expected.',
  'Good, though prices have gone up slightly since my last visit.',
  'Okay experience. Quality is fine, service can be a little faster.',
  'Average this time, previous visit was better.',
];
const LOW = [
  'Had to wait too long and nobody updated us on the delay.',
  'Not as good as the photos suggested. Hope they improve.',
  'Order was missing an item, they did apologise but it was disappointing.',
];

interface PlannedReview {
  businessId: string;
  businessName: string;
  rating: number;
  comment?: string;
  createdAt: string;
}

/** A timestamp spread over the last year, denser towards recent months. */
function pastDate(): string {
  const days = Math.floor(Math.pow(rand(), 1.6) * 365);
  const t = Date.now() - days * 86400000 - Math.floor(rand() * 86400000);
  return new Date(t).toISOString();
}

function plan(businesses: Business[], raterCount: number): Map<number, PlannedReview[]> {
  const byRater = new Map<number, PlannedReview[]>();
  for (const b of businesses) {
    const n = MIN_RATINGS + Math.floor(rand() * (MAX_RATINGS - MIN_RATINGS + 1));
    const raters = shuffle([...Array(raterCount).keys()]).slice(0, n);
    const food = isFoodShop(b.tags ?? []);
    const good = shuffle([...(food ? FOOD_GOOD : OTHER_GOOD)]);
    const meh = shuffle([...MEH]);
    const low = shuffle([...LOW]);
    const rows = raters.map((rater) => ({ rater, rating: stars(), comment: undefined as string | undefined }));
    // Every 1–2★ must say why (the app's rule); the rest of the written ones go to 3–5★.
    let written = 0;
    for (const r of rows) if (r.rating <= 2) { r.comment = low.pop() ?? pick(LOW); written++; }
    for (const r of rows) {
      if (written >= WRITTEN) break;
      if (r.rating <= 2) continue;
      const text = r.rating === 3 ? meh.pop() : good.pop();
      if (!text) continue;
      r.comment = text;
      written++;
    }
    for (const r of rows) {
      const list = byRater.get(r.rater) ?? [];
      list.push({ businessId: b.id, businessName: b.name, rating: r.rating, comment: r.comment, createdAt: pastDate() });
      byRater.set(r.rater, list);
    }
  }
  return byRater;
}

// ---- progress ----
interface Done { userId: string; posted: boolean }
const load = (): Record<string, Done> => (existsSync(PROGRESS) ? JSON.parse(readFileSync(PROGRESS, 'utf8')) : {});
const save = (p: Record<string, Done>) => writeFileSync(PROGRESS, JSON.stringify(p, null, 2));

const client = () =>
  createClient(need('EXPO_PUBLIC_SUPABASE_URL'), need('EXPO_PUBLIC_SUPABASE_ANON_KEY'), {
    auth: { persistSession: false, autoRefreshToken: false },
  });

const isRateLimit = (msg: string) => /rate limit|too many|429/i.test(msg);

/** Sign in (or sign up) as the rater, waiting out Supabase's auth rate limit. */
async function session(sb: SupabaseClient, username: string, name: string, password: string): Promise<string> {
  const email = `${username}@localo.app`;
  for (let attempt = 0; ; attempt++) {
    let res = await sb.auth.signInWithPassword({ email, password });
    if (!res.error && res.data.user) return res.data.user.id;
    if (res.error && isRateLimit(res.error.message)) { await backoff(attempt); continue; }
    const up = await sb.auth.signUp({ email, password, options: { data: { name, username } } });
    if (up.error) {
      if (isRateLimit(up.error.message)) { await backoff(attempt); continue; }
      throw new Error(`sign-up ${username}: ${up.error.message}`);
    }
    if (up.data.session && up.data.user) return up.data.user.id;
    res = await sb.auth.signInWithPassword({ email, password });
    if (!res.error && res.data.user) return res.data.user.id;
    if (res.error && isRateLimit(res.error.message)) { await backoff(attempt); continue; }
    throw new Error(`sign-in ${username}: ${res.error?.message ?? 'no user'}`);
  }
}
async function backoff(attempt: number) {
  const s = Math.min(60 * (attempt + 1), 300);
  console.log(`  rate limited — waiting ${s}s`);
  await sleep(s * 1000);
}

async function main() {
  const manifest = JSON.parse(readFileSync(join(process.cwd(), 'scripts', 'demo-listings.json'), 'utf8')) as { password: string };
  const sb0 = client();
  const { data, error } = await sb0.from('businesses').select('data').eq('data->>demo', 'true');
  if (error) throw error;
  const businesses = (data ?? []).map((r) => r.data as Business).filter((b) => b.demo === true);
  if (!businesses.length) throw new Error('No demo listings found.');

  const raters = makeRaters();
  const byRater = plan(businesses, raters.length);

  const all = [...byRater.values()].flat();
  const spread = [1, 2, 3, 4, 5].map((s) => all.filter((r) => r.rating === s).length);
  console.log(`${businesses.length} demo listings · ${raters.length} raters · ${all.length} ratings`);
  console.log(`stars 1–5: ${spread.join(' / ')} · avg ${(all.reduce((a, r) => a + r.rating, 0) / all.length).toFixed(2)}`);
  console.log(`written: ${all.filter((r) => r.comment).length}`);
  if (DRY) {
    for (const [i, r] of raters.slice(0, 10).entries()) console.log(`  ${r.username} — ${r.name} — ${byRater.get(i)?.length ?? 0} ratings`);
    return;
  }

  const progress = load();
  let handled = 0;
  for (const [i, r] of raters.entries()) {
    if (progress[r.username]?.posted) continue;
    if (handled++ >= LIMIT) break;
    const sb = client();
    const userId = await session(sb, r.username, r.name, manifest.password);
    progress[r.username] = { userId, posted: false };
    save(progress);

    const mine = (byRater.get(i) ?? []).filter((p) => businesses.find((b) => b.id === p.businessId)?.ownerId !== userId);
    // Skip any already posted (a re-run after a crash mid-insert).
    const { data: existing } = await sb.from('reviews').select('business_id').eq('customer_id', userId);
    const have = new Set((existing ?? []).map((e) => e.business_id as string));
    const rows = mine
      .filter((p) => !have.has(p.businessId))
      .map((p) => {
        const review: Review = {
          id: randomUUID(),
          businessId: p.businessId,
          customerId: userId,
          customerName: r.name,
          rating: p.rating,
          comment: p.comment,
          createdAt: p.createdAt,
        };
        return { id: review.id, business_id: p.businessId, customer_id: userId, data: review, created_at: p.createdAt };
      });
    if (rows.length) {
      const { error: insErr } = await sb.from('reviews').insert(rows);
      if (insErr) throw new Error(`${r.username}: ${insErr.message}`);
    }
    await sb.auth.signOut();
    progress[r.username] = { userId, posted: true };
    save(progress);
    console.log(`✓ ${r.username} (${r.name}) — ${rows.length} ratings`);
  }
  const posted = Object.values(progress).filter((p) => p.posted).length;
  console.log(`done: ${posted}/${raters.length} raters posted`);
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});

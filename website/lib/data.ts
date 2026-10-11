/**
 * Reading the live One Place database.
 *
 * Straight to Supabase's REST endpoint with the public anon key — no SDK, no
 * session. `businesses` and `reviews` are world-readable by RLS
 * (supabase/migrations/0002_policies.sql), which is exactly what a public
 * website needs and nothing more: the anon key can't see anyone's phone, email
 * or orders.
 *
 * Every fetch is cached by Next for REVALIDATE seconds, so a business page is
 * served static-fast and still picks up an owner's edits within minutes.
 */
import type { Business, Offer, Review } from './types';
import { slugify } from './slug';

export const REVALIDATE = 600;

function env(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`Missing ${name} — copy website/.env.example to .env.local`);
  return v;
}

async function rest<T>(path: string, tags: string[] = []): Promise<T> {
  const key = env('SUPABASE_ANON_KEY');
  const res = await fetch(`${env('SUPABASE_URL')}/rest/v1/${path}`, {
    headers: { apikey: key, Authorization: `Bearer ${key}` },
    next: { revalidate: REVALIDATE, tags },
  });
  if (!res.ok) throw new Error(`Supabase ${res.status} on ${path.split('?')[0]}`);
  return (await res.json()) as T;
}

/**
 * Should this listing have a public page? Mirrors `isListedPublicly` in the
 * app's `src/lib/onHold.ts`: personal stalls (type 'item') are on hold since the
 * One Place redesign. Demo listings ARE shown (the app shows them to everyone
 * too) but are kept out of search engines — see `isIndexable`.
 */
export function isPublic(b: { type: string }): boolean {
  return b.type !== 'item';
}

/** Search engines get real businesses only — never the demo samples. */
export function isIndexable(b: { demo?: boolean | null }): boolean {
  return !b.demo;
}

/** One row of the directory — just enough for slugs, the sitemap and cards. */
export interface DirectoryEntry {
  id: string;
  slug: string;
  name: string;
  city?: string;
  type: string;
  demo: boolean;
  providerType?: string;
  tagline?: string;
  coverImageUrl?: string;
  tags: string[];
  createdAt: string;
}

interface DirectoryRow {
  id: string;
  type: string;
  created_at: string;
  name: string | null;
  city: string | null;
  demo: boolean | null;
  provider_type: string | null;
  tagline: string | null;
  cover: string | null;
  tags: string[] | null;
}

const PAGE = 1000;

/** Top-level paths the site itself uses; no business slug may take one. */
const RESERVED_SLUGS = ['explore', 'search', 'deals', 'in', 'b', 'list-your-business', 'business', 'menu', 'api'];

/**
 * Every public business with a stable, readable slug.
 *
 * Slugs are DERIVED, not stored (a `slug` column is Phase 2): the plain name
 * where it's unique, name + city where two places share a name, and name +
 * a piece of the id as a last resort. Rows are walked oldest-first, so the
 * first business to take a name keeps the plain slug forever — a newcomer with
 * the same name gets the suffix, and no existing link ever changes.
 */
export async function listDirectory(): Promise<DirectoryEntry[]> {
  const select =
    'id,type,created_at,name:data->>name,city:data->location->>city,demo:data->demo,' +
    'provider_type:data->>providerType,tagline:data->>tagline,cover:data->>coverImageUrl,tags:data->tags';
  const rows: DirectoryRow[] = [];
  for (let offset = 0; ; offset += PAGE) {
    const page = await rest<DirectoryRow[]>(
      `businesses?select=${select}&order=created_at.asc,id.asc&limit=${PAGE}&offset=${offset}`,
      ['directory'],
    );
    rows.push(...page);
    if (page.length < PAGE) break;
  }

  // The site's own routes — a business called "Explore" gets explore-indore.
  const taken = new Set<string>(RESERVED_SLUGS);
  const entries: DirectoryEntry[] = [];
  for (const r of rows) {
    if (!isPublic(r) || !r.name?.trim()) continue;
    const base = slugify(r.name) || 'business';
    const city = r.city ? slugify(r.city) : '';
    const candidates = [base, city ? `${base}-${city}` : '', `${base}-${r.id.slice(0, 6)}`, `${base}-${r.id}`];
    const slug = candidates.find((c) => c && !taken.has(c))!;
    taken.add(slug);
    entries.push({
      id: r.id,
      slug,
      name: r.name.trim(),
      city: r.city?.trim() || undefined,
      type: r.type,
      demo: !!r.demo,
      providerType: r.provider_type ?? undefined,
      tagline: r.tagline ?? undefined,
      coverImageUrl: r.cover ?? undefined,
      tags: Array.isArray(r.tags) ? r.tags : [],
      createdAt: r.created_at,
    });
  }
  return entries;
}

/**
 * Every listing's offers, only rows that have any — the deals feed. One small
 * read (two columns), joined to `listDirectory()` in `lib/deals.ts`.
 */
export async function listOfferRows(): Promise<{ id: string; type: string; offers: Offer[] | null }[]> {
  const rows: { id: string; type: string; offers: Offer[] | null }[] = [];
  for (let offset = 0; ; offset += PAGE) {
    const page = await rest<typeof rows>(
      `businesses?select=id,type,offers:data->offers&data->offers=not.is.null&order=id.asc&limit=${PAGE}&offset=${offset}`,
      ['deals'],
    );
    rows.push(...page);
    if (page.length < PAGE) break;
  }
  return rows.filter(isPublic);
}

export async function findBySlug(slug: string): Promise<DirectoryEntry | undefined> {
  const all = await listDirectory();
  return all.find((e) => e.slug === slug.toLowerCase());
}

export async function findById(id: string): Promise<DirectoryEntry | undefined> {
  const all = await listDirectory();
  return all.find((e) => e.id === id);
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** The full listing. The table is a document model: `data` IS the Business. */
export async function getBusiness(id: string): Promise<Business | undefined> {
  if (!UUID.test(id)) return undefined;
  const rows = await rest<{ id: string; type: string; data: Business }[]>(
    `businesses?id=eq.${id}&select=id,type,data&limit=1`,
    [`business:${id}`],
  );
  const row = rows[0];
  if (!row || !isPublic(row)) return undefined;
  return { ...row.data, id: row.id, type: row.data.type ?? (row.type as Business['type']) };
}

export interface ReviewSummary {
  avg?: number;
  count: number;
  /** Newest first, written reviews only. */
  latest: Review[];
}

/**
 * Ratings are computed live from `reviews`, exactly as the app's Supabase
 * backend does (a customer can't write to a business row, so there is no
 * stored average to trust).
 */
export async function getReviews(businessId: string): Promise<ReviewSummary> {
  if (!UUID.test(businessId)) return { count: 0, latest: [] };
  const rows = await rest<{ data: Review }[]>(
    `reviews?business_id=eq.${businessId}&select=data&order=created_at.desc&limit=1000`,
    [`business:${businessId}`],
  );
  const reviews = rows.map((r) => r.data).filter((r) => r && typeof r.rating === 'number');
  const count = reviews.length;
  const avg = count ? reviews.reduce((s, r) => s + r.rating, 0) / count : undefined;
  return {
    avg,
    count,
    latest: reviews.filter((r) => r.comment?.trim()).slice(0, 8),
  };
}

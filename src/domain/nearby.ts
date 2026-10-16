/**
 * Explore's feed — "what's around me", one page at a time.
 *
 * The rules (a TS twin of supabase/migrations/0029_nearby_feed.sql — keep the
 * two in step; the mock and Path B's client run these, Supabase runs the SQL):
 *
 *  - THE RING: every listing within `radiusKm` of `near` — unless that's fewer
 *    than `minCount`, then the `minCount` nearest. A dense city stays in the
 *    neighbourhood; a thin town never stares at "No results" with a perfectly
 *    good shop 22 km away. No `near` yet (GPS pending) → `minCount` of them.
 *  - THE CATEGORY: a browse category (domain/intents.ts) admits a listing by
 *    any of its tags or listing types.
 *  - THE ORDER: 'shuffle' (a stable random deal for one `seed`, so the list
 *    doesn't reshuffle on every refetch but a fresh app open deals anew),
 *    'nearest' (to the 10 m) or 'popular' (rating × log10(1 + count), so one
 *    5★ review doesn't beat a hundred 4.7s). Ties fall back to the shuffle.
 *
 * Paged by `offset`/`limit`, so the phone never downloads the whole directory.
 */
import { haversineKm } from '@/lib/geo';
import type { IntentCategory } from './intents';
import type { Business, GeoPoint, ListingType } from './types';

export type NearbySort = 'shuffle' | 'nearest' | 'popular';

/** The pool every page and the summary are drawn from. */
export interface NearbyScope {
  near?: GeoPoint;
  /** The ring. Undefined = no ring: every listing (the category pages). */
  radiusKm?: number;
  /** 0 = only what's inside the ring (the map's visible area). */
  minCount: number;
  /** Listing types never shown (stalls while on hold — lib/onHold). */
  excludeTypes?: ListingType[];
}

export interface NearbyQuery extends NearbyScope {
  /** Narrow to one browse category. */
  intent?: Pick<IntentCategory, 'tags' | 'types'>;
  sort: NearbySort;
  seed: number;
  offset: number;
  /** At most 100 per page. */
  limit: number;
}

/** The numbers the header needs from the WHOLE feed, not just the loaded pages. */
export interface NearbySummary {
  total: number;
  /** How far the furthest listing in the pool is, in km (undefined without `near`). */
  reachKm?: number;
  /** Browse-category id → how many listings in the pool it holds. */
  counts: Record<string, number>;
}

export const MAX_NEARBY_PAGE = 100;

export function nearbyIntentMatches(b: Pick<Business, 'tags' | 'type'>, intent: Pick<IntentCategory, 'tags' | 'types'>): boolean {
  if (intent.types?.includes(b.type)) return true;
  const tags = new Set((b.tags ?? []).map((t) => t.trim().toLowerCase()));
  return intent.tags.some((t) => tags.has(t.toLowerCase()));
}

/** A stable pseudo-random rank for an id under a seed (FNV-1a + seed). */
export function shuffleRank(id: string, seed: number): number {
  let h = 2166136261 ^ seed;
  for (let i = 0; i < id.length; i++) {
    h ^= id.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

/** The ring, applied to a full list (businesses get `distanceKm` set). */
export function nearbyPool(all: Business[], scope: NearbyScope): Business[] {
  const { near } = scope;
  const placed = all
    .filter((b) => !scope.excludeTypes?.includes(b.type))
    .map((b) => ({
      ...b,
      distanceKm: near && b.location?.point ? haversineKm(near, b.location.point) : undefined,
    }));
  const radius = scope.radiusKm;
  const inRing =
    radius === undefined ? placed : placed.filter((b) => typeof b.distanceKm === 'number' && b.distanceKm <= radius);
  if (inRing.length >= scope.minCount) return inRing;
  return placed
    .sort((a, b) => (a.distanceKm ?? Infinity) - (b.distanceKm ?? Infinity) || a.id.localeCompare(b.id))
    .slice(0, Math.max(scope.minCount, 0));
}

/** One page of the feed, from a full list (the mock / Path B's client). */
export function nearbyPage(all: Business[], q: NearbyQuery): Business[] {
  const pool = nearbyPool(all, q).filter((b) => !q.intent || nearbyIntentMatches(b, q.intent));
  const shuffle = (b: Business) => shuffleRank(b.id, q.seed);
  const dist = (b: Business) => Math.round((b.distanceKm ?? 1e9) * 100);
  const score = (b: Business) => (b.ratingAvg ?? 0) * Math.log10(1 + (b.ratingCount ?? 0));
  pool.sort((a, b) =>
    q.sort === 'nearest'
      ? dist(a) - dist(b) || shuffle(a) - shuffle(b)
      : q.sort === 'popular'
        ? score(b) - score(a) || shuffle(a) - shuffle(b)
        : shuffle(a) - shuffle(b),
  );
  const limit = Math.min(Math.max(q.limit, 0), MAX_NEARBY_PAGE);
  return pool.slice(Math.max(q.offset, 0), Math.max(q.offset, 0) + limit);
}

/** The header numbers, from a full list (the mock / Path B's client). */
export function nearbySummary(all: Business[], scope: NearbyScope, intents: IntentCategory[]): NearbySummary {
  const pool = nearbyPool(all, scope);
  const far = pool.reduce((m, b) => Math.max(m, b.distanceKm ?? 0), 0);
  return {
    total: pool.length,
    reachKm: scope.near && pool.length ? far : undefined,
    counts: Object.fromEntries(intents.map((i) => [i.id, pool.filter((b) => nearbyIntentMatches(b, i)).length])),
  };
}

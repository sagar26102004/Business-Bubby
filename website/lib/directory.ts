/**
 * Browsing the directory: cities, categories and search — all computed from
 * the one cached `listDirectory()` read, so no page costs an extra query.
 */
import { isIndexable, listDirectory, type DirectoryEntry } from './data';
import { INTENT_CATEGORIES, intentMatches, type Intent } from './intents';
import { slugify } from './slug';

/**
 * A city earns its own page once this many real listings name it. Bulk-listed
 * addresses sometimes carry a locality or a shop number in the city field;
 * those stay reachable through search but don't get a page of their own.
 */
export const MIN_CITY_LISTINGS = 3;

export interface City {
  name: string;
  slug: string;
  count: number;
}

/** The real (non-demo) listings — what the directory pages are built from. */
export async function realEntries(): Promise<DirectoryEntry[]> {
  return (await listDirectory()).filter(isIndexable);
}

export function cityOf(e: DirectoryEntry): string | undefined {
  return e.city ? slugify(e.city) || undefined : undefined;
}

/** Cities with enough listings for a page, biggest first. */
export function cities(entries: DirectoryEntry[]): City[] {
  const by = new Map<string, City>();
  for (const e of entries) {
    const slug = cityOf(e);
    if (!slug) continue;
    const c = by.get(slug) ?? { name: e.city!.trim(), slug, count: 0 };
    c.count += 1;
    by.set(slug, c);
  }
  return [...by.values()]
    .filter((c) => c.count >= MIN_CITY_LISTINGS)
    .sort((a, b) => b.count - a.count || a.name.localeCompare(b.name));
}

export function inCity(entries: DirectoryEntry[], citySlug: string): DirectoryEntry[] {
  return entries.filter((e) => cityOf(e) === citySlug);
}

export function inIntent(entries: DirectoryEntry[], intent: Intent): DirectoryEntry[] {
  return entries.filter((e) => intentMatches(e, intent));
}

/** Categories that have at least one listing among `entries`, with counts. */
export function intentsWithCounts(entries: DirectoryEntry[]) {
  return INTENT_CATEGORIES.map((intent) => ({ intent, count: inIntent(entries, intent).length })).filter(
    (x) => x.count > 0,
  );
}

/** The category's tags that actually appear among `entries` — the filter chips. */
export function presentTags(entries: DirectoryEntry[], intent: Intent): { tag: string; count: number }[] {
  const wanted = new Map(intent.tags.map((t) => [t.toLowerCase(), t]));
  const counts = new Map<string, number>();
  for (const e of entries) {
    for (const raw of new Set(e.tags.map((t) => t.trim().toLowerCase()))) {
      const tag = wanted.get(raw);
      if (tag) counts.set(tag, (counts.get(tag) ?? 0) + 1);
    }
  }
  return [...counts].map(([tag, count]) => ({ tag, count })).sort((a, b) => b.count - a.count);
}

export function hasTag(e: DirectoryEntry, tag: string): boolean {
  const t = tag.trim().toLowerCase();
  return e.tags.some((x) => x.trim().toLowerCase() === t);
}

/**
 * Plain-words search over names, tags, profession, tagline and city. Every
 * word must match somewhere; a name match ranks above a tag match.
 */
export function search(entries: DirectoryEntry[], query: string): DirectoryEntry[] {
  const words = query.toLowerCase().split(/\s+/).filter(Boolean);
  if (!words.length) return [];
  const scored: { e: DirectoryEntry; score: number }[] = [];
  for (const e of entries) {
    const name = e.name.toLowerCase();
    const rest = [e.providerType, e.tagline, e.city, ...e.tags].filter(Boolean).join(' ').toLowerCase();
    let score = 0;
    let all = true;
    for (const w of words) {
      if (name.includes(w)) score += name.startsWith(w) ? 3 : 2;
      else if (rest.includes(w)) score += 1;
      else {
        all = false;
        break;
      }
    }
    if (all) scored.push({ e, score });
  }
  return scored.sort((a, b) => b.score - a.score || a.e.name.localeCompare(b.e.name)).map((s) => s.e);
}

/** Photos first, then newest — the order every grid uses. */
export function showcaseOrder(entries: DirectoryEntry[]): DirectoryEntry[] {
  return [...entries].sort(
    (a, b) =>
      Number(!!b.coverImageUrl) - Number(!!a.coverImageUrl) || b.createdAt.localeCompare(a.createdAt),
  );
}

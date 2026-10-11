/**
 * The deals feed — the website's take on the app's `/deals` screen: every live
 * offer from every public listing, each joined to its business's directory
 * entry for the name, city, tags and link.
 *
 * The app sorts by distance from the customer; a web page has no location, so
 * here real businesses come before the demo samples, then newest first.
 *
 * Demo listings are INCLUDED, as in the app (they're public to everyone there),
 * but a page made only of demo deals is kept out of search engines — see
 * `hasRealDeals`.
 */
import { listDirectory, listOfferRows, type DirectoryEntry } from './data';
import { cityOf } from './directory';
import { liveOffers } from './offers';
import type { Offer } from './types';

export interface Deal {
  offer: Offer;
  entry: DirectoryEntry;
}

export async function listDeals(now: number = Date.now()): Promise<Deal[]> {
  const [rows, directory] = await Promise.all([listOfferRows(), listDirectory()]);
  const byId = new Map(directory.map((e) => [e.id, e]));
  const deals: Deal[] = [];
  for (const row of rows) {
    const entry = byId.get(row.id);
    if (!entry) continue;
    for (const offer of liveOffers({ offers: row.offers ?? undefined }, now)) deals.push({ offer, entry });
  }
  return deals.sort(
    (a, b) =>
      Number(a.entry.demo) - Number(b.entry.demo) || b.offer.createdAt.localeCompare(a.offer.createdAt),
  );
}

export function dealsInCity(deals: Deal[], citySlug: string): Deal[] {
  return deals.filter((d) => cityOf(d.entry) === citySlug);
}

/** The cities that have deals, most first — the feed's city chips. */
export function dealCities(deals: Deal[]): { name: string; slug: string; count: number }[] {
  const by = new Map<string, { name: string; slug: string; count: number }>();
  for (const d of deals) {
    const slug = cityOf(d.entry);
    if (!slug) continue;
    const c = by.get(slug) ?? { name: d.entry.city!.trim(), slug, count: 0 };
    c.count += 1;
    by.set(slug, c);
  }
  return [...by.values()].sort((a, b) => b.count - a.count || a.name.localeCompare(b.name));
}

/** Worth a search engine's time only once a real business has posted a deal. */
export function hasRealDeals(deals: Deal[]): boolean {
  return deals.some((d) => !d.entry.demo);
}

/**
 * A preview row: at most one deal per business, so one shop with ten offers
 * can't fill the strip.
 */
export function previewDeals(deals: Deal[], limit: number): Deal[] {
  const seen = new Set<string>();
  const out: Deal[] = [];
  for (const d of deals) {
    if (seen.has(d.entry.id)) continue;
    seen.add(d.entry.id);
    out.push(d);
    if (out.length === limit) break;
  }
  return out;
}

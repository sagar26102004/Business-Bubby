/**
 * The glue between stored `CatalogEntry` rows (the app's GROWING collection)
 * and the code catalog's in-memory overlays.
 *
 * The code ships a curated head start — dishes in domain/dishes.ts, tags in
 * domain/tags.ts. At runtime the collection grows: owners list offerings the
 * code doesn't know, and a super-admin adds tags by hand. Those live as
 * `CatalogEntry` rows; `applyCatalogEntries` pushes the approved ones into the
 * dish/tag overlays so they surface as suggestions everywhere, and
 * `isCodeCatalogName` keeps capture from re-storing things the code already has.
 */
import type { CatalogEntry, CatalogEntryKind } from './types';
import { DISH_CATALOG, setCommunityDishes, type Dish } from './dishes';
import { isCatalogTag, setCommunityTags } from './tags';

/** Lowercase, whitespace-collapsed dedup key — one row per kind+key. */
export function catalogKey(name: string): string {
  return name.trim().toLowerCase().replace(/\s+/g, ' ');
}

const codeDishKeys = new Set(DISH_CATALOG.map((d) => catalogKey(d.name)));

/**
 * True when the code catalog already ships this name, so capturing it would
 * only duplicate what's already offered. Services/products have no code
 * catalog, so they're always "new".
 */
export function isCodeCatalogName(kind: CatalogEntryKind, name: string): boolean {
  if (kind === 'tag') return isCatalogTag(name);
  if (kind === 'dish') return codeDishKeys.has(catalogKey(name));
  return false;
}

/** A minimal Dish for a captured name — just enough for the typeahead. */
function synthDish(entry: CatalogEntry): Dish {
  return {
    id: `community_${entry.id}`,
    name: entry.name,
    sectionId: 'community',
    isVeg: true,
    description: '',
  };
}

/**
 * Load a set of catalog entries into the code overlays. Only approved entries
 * are surfaced; dishes and tags flow into their respective suggestion sources.
 * Most-used first, so the popular contributions rank ahead.
 */
export function applyCatalogEntries(entries: CatalogEntry[]): void {
  const approved = entries
    .filter((e) => e.approved)
    .sort((a, b) => b.count - a.count || a.name.localeCompare(b.name));
  setCommunityDishes(approved.filter((e) => e.kind === 'dish').map(synthDish));
  setCommunityTags(approved.filter((e) => e.kind === 'tag').map((e) => e.name));
}

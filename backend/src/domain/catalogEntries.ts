/**
 * Catalog dedup key + "is this already in the code catalog" test — the backend
 * port of the relevant halves of src/domain/catalogEntries.ts. The overlay glue
 * (applyCatalogEntries / setCommunity*) is frontend-only and NOT ported: the
 * backend only stores and serves entries, it never renders suggestions.
 */
import type { CatalogEntryKind } from './types';
import { DISH_NAMES, TAG_NAMES } from './catalogNames';

/** Lowercase, whitespace-collapsed dedup key — one row per kind+key. */
export function catalogKey(name: string): string {
  return name.trim().toLowerCase().replace(/\s+/g, ' ');
}

const codeDishKeys = new Set(DISH_NAMES.map((n) => catalogKey(n)));
const codeTagKeys = new Set(TAG_NAMES.map((n) => catalogKey(n)));

/**
 * True when the code catalog already ships this name, so capturing it would
 * only duplicate what's already offered. Services/products have no code
 * catalog, so they're always "new".
 */
export function isCodeCatalogName(kind: CatalogEntryKind, name: string): boolean {
  if (kind === 'tag') return codeTagKeys.has(catalogKey(name));
  if (kind === 'dish') return codeDishKeys.has(catalogKey(name));
  return false;
}

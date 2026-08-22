/**
 * Nested subcategory paths, shared by every catalog that folds.
 *
 * A menu section, a service section and a shop shelf all let the owner nest
 * their own folders inside a library one — "Repairs › Washing machine › Front
 * load". Rather than add a table of folders, the nested path is encoded inside
 * the item's SINGLE `subcategory` string with the separator below, so every
 * existing consumer (search, cart keys, order grouping, the business page's
 * category headings) keeps working unchanged while the editors and the menu
 * screen read it back as a tree.
 */

/** What separates one folder from the next inside `subcategory`. */
export const SUBCATEGORY_SEP = ' › ';

/** The nested segments of an item's subcategory, outermost first ([] if none). */
export function subcategoryPath(subcategory?: string): string[] {
  if (!subcategory) return [];
  return subcategory
    .split('›')
    .map((s) => s.trim())
    .filter(Boolean);
}

/** Join nested segments back into a `subcategory` (undefined if empty). */
export function joinSubcategoryPath(path: string[]): string | undefined {
  const clean = path.map((s) => s.trim()).filter(Boolean);
  return clean.length ? clean.join(SUBCATEGORY_SEP) : undefined;
}

/** Do two paths point at the exact same folder? */
export function samePath(a: string[], b: string[]): boolean {
  return a.length === b.length && a.every((seg, i) => seg === b[i]);
}

/** Is `prefix` an ancestor-or-equal of `path`? */
export function isPathPrefix(prefix: string[], path: string[]): boolean {
  return prefix.length <= path.length && prefix.every((seg, i) => seg === path[i]);
}

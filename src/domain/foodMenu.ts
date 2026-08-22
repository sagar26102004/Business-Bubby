/**
 * The prebuilt restaurant menu structure.
 *
 * Food businesses start from these ready-made sections rather than typing their
 * own — "Startrs" / "STARTERS" / "Starter" produced a different group per
 * restaurant and made menus unbrowsable. Every cafe's menu therefore reads the
 * same way and the customer's menu screen lays them out in one canonical order.
 * A restaurant with something the library misses (Chaat, Thali, Combos) can
 * still add its own section and subcategories; those sort after the library
 * ones (see `foodSectionOrder`).
 *
 * A section may carry subcategories (Beverages → Tea, Coffee, Shakes…). Veg vs
 * non-veg is NOT a subcategory — it's the green/red dot on each dish
 * (`MenuItem.isVeg`), the way delivery apps do it.
 *
 * The dishes that go INSIDE these sections live in `domain/dishes.ts`.
 *
 * Non-food businesses keep free-text grouping — a hardware shop's sections are
 * its own business.
 */

export interface FoodMenuSection {
  /** Stable id; the section's `name` is what lands on MenuItem.category. */
  id: string;
  name: string;
  icon: string;
  /** Groups inside the section, offered as "+ Tea", "+ Coffee" chips. */
  subcategories?: string[];
}

export const FOOD_MENU_SECTIONS: FoodMenuSection[] = [
  { id: 'appetizers', name: 'Appetizers', icon: '🍤' },
  { id: 'soups', name: 'Soups', icon: '🍜' },
  { id: 'salads', name: 'Salads', icon: '🥗' },
  { id: 'main_course', name: 'Main Course', icon: '🍛' },
  { id: 'breads', name: 'Breads', icon: '🫓' },
  { id: 'rice', name: 'Rice', icon: '🍚' },
  { id: 'noodles', name: 'Noodles', icon: '🍝' },
  { id: 'pasta', name: 'Pasta', icon: '🍝' },
  { id: 'pizza', name: 'Pizza', icon: '🍕' },
  { id: 'burger', name: 'Burger', icon: '🍔' },
  { id: 'sandwich', name: 'Sandwich', icon: '🥪' },
  { id: 'desserts', name: 'Desserts', icon: '🍨' },
  {
    id: 'beverages',
    name: 'Beverages',
    icon: '🥤',
    subcategories: ['Tea', 'Coffee', 'Shakes', 'Fresh Juice', 'Soft Drinks', 'Mocktails', 'Cocktails'],
  },
];

const SECTION_BY_NAME = new Map(FOOD_MENU_SECTIONS.map((s) => [s.name.toLowerCase(), s]));
const SECTION_BY_ID = new Map(FOOD_MENU_SECTIONS.map((s) => [s.id, s]));

/** The library section a MenuItem.category belongs to, if any. */
export function findFoodSection(category?: string): FoodMenuSection | undefined {
  return category ? SECTION_BY_NAME.get(category.trim().toLowerCase()) : undefined;
}

/** The library section with this id (what a catalog dish is filed under). */
export function getFoodSection(id: string): FoodMenuSection | undefined {
  return SECTION_BY_ID.get(id);
}

/**
 * Sort key for a menu category — its position in the library, so a menu always
 * reads Appetizers → Soups → … → Beverages however the owner typed it in.
 * Anything outside the library (a section the restaurant invented) sorts to the end.
 */
export function foodSectionOrder(category?: string): number {
  const section = findFoodSection(category);
  return section ? FOOD_MENU_SECTIONS.indexOf(section) : FOOD_MENU_SECTIONS.length;
}

/**
 * Nested subcategories ("South Indian › Dosa › Plain") are a plain-string path
 * encoded inside the item's single `subcategory` field. The helpers moved to
 * `domain/subcategoryPath.ts` when services started nesting too; they are
 * re-exported here so every menu caller keeps importing them from the menu
 * library it already talks to.
 */
export {
  SUBCATEGORY_SEP,
  isPathPrefix,
  joinSubcategoryPath,
  samePath,
  subcategoryPath,
} from './subcategoryPath';

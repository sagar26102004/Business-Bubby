/**
 * The customer's cart, held per business.
 *
 * The food flow bounces between two screens — /menu/[businessId] (pick) and
 * /cart/[businessId] (review, then "Add" back to the menu) — so the picks
 * can't live in either screen's state. They live here, keyed by business, and
 * are cleared once the order is actually sent.
 *
 * In-memory only, like the rest of the app pre-backend: a reload empties it.
 */
import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from 'react';
import type { MenuItem } from '@/domain/types';

export interface CartLine {
  item: MenuItem;
  quantity: number;
}

/** Menu items have no id — name + group is what makes one unique on a menu. */
export const cartKey = (item: MenuItem) =>
  `${item.category ?? ''}|${item.subcategory ?? ''}|${item.name}`;

interface CartState {
  lines: (businessId: string) => CartLine[];
  quantityOf: (businessId: string, item: MenuItem) => number;
  bump: (businessId: string, item: MenuItem, delta: number) => void;
  clear: (businessId: string) => void;
}

const CartContext = createContext<CartState | null>(null);

type Carts = Record<string, Record<string, CartLine>>;

export function CartProvider({ children }: { children: ReactNode }) {
  const [carts, setCarts] = useState<Carts>({});

  const lines = useCallback(
    (businessId: string) => Object.values(carts[businessId] ?? {}),
    [carts],
  );

  const quantityOf = useCallback(
    (businessId: string, item: MenuItem) => carts[businessId]?.[cartKey(item)]?.quantity ?? 0,
    [carts],
  );

  const bump = useCallback((businessId: string, item: MenuItem, delta: number) => {
    setCarts((prev) => {
      const cart = { ...(prev[businessId] ?? {}) };
      const key = cartKey(item);
      const quantity = (cart[key]?.quantity ?? 0) + delta;
      if (quantity <= 0) delete cart[key];
      else cart[key] = { item, quantity };
      return { ...prev, [businessId]: cart };
    });
  }, []);

  const clear = useCallback((businessId: string) => {
    setCarts((prev) => {
      const next = { ...prev };
      delete next[businessId];
      return next;
    });
  }, []);

  const value = useMemo(
    () => ({ lines, quantityOf, bump, clear }),
    [lines, quantityOf, bump, clear],
  );

  return <CartContext.Provider value={value}>{children}</CartContext.Provider>;
}

/** Cart operations scoped to one business — every screen already knows which. */
export function useCart(businessId: string) {
  const ctx = useContext(CartContext);
  if (!ctx) throw new Error('useCart must be used inside a CartProvider');
  const { lines, quantityOf, bump, clear } = ctx;

  return useMemo(() => {
    const myLines = lines(businessId);
    return {
      lines: myLines,
      itemCount: myLines.reduce((n, l) => n + l.quantity, 0),
      quantityOf: (item: MenuItem) => quantityOf(businessId, item),
      bump: (item: MenuItem, delta: number) => bump(businessId, item, delta),
      clear: () => clear(businessId),
    };
  }, [businessId, lines, quantityOf, bump, clear]);
}

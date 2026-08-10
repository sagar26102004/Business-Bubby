/**
 * Offer maths — the totals and "is it live?" rules shared by the workspace
 * editor and the business page, so the two never disagree about what an offer
 * is worth or whether a customer should see it.
 *
 * Prices are free-text labels everywhere in Localo (see lib/money), so every
 * total here is best-effort: lines with an unreadable price simply don't count
 * toward the struck-through "was" figure.
 */
import type { Business, Offer, OfferLine, OfferLineKind } from '@/domain/types';
import { formatMoney, parsePrice } from '@/lib/money';

/** Normal total of an offer's lines, or undefined when none carry a price. */
export function linesTotal(lines: OfferLine[]): number | undefined {
  let total = 0;
  let priced = false;
  for (const line of lines) {
    const unit = parsePrice(line.price);
    if (unit === undefined) continue;
    priced = true;
    total += unit * (line.quantity ?? 1);
  }
  return priced ? total : undefined;
}

/** "₹240" — the struck-through price, or undefined when nothing is priced. */
export function linesTotalLabel(lines: OfferLine[]): string | undefined {
  const total = linesTotal(lines);
  return total === undefined ? undefined : formatMoney(total);
}

/**
 * Whole-percent saving between two price labels, or undefined when either is
 * unreadable or the "deal" isn't actually cheaper.
 */
export function savingPercent(wasPrice?: string, price?: string): number | undefined {
  const was = parsePrice(wasPrice);
  const now = parsePrice(price);
  if (was === undefined || now === undefined || was <= 0 || now >= was) return undefined;
  return Math.round(((was - now) / was) * 100);
}

/** The saving badge on a saved offer. */
export function offerSavingPercent(offer: Offer): number | undefined {
  return savingPercent(offer.wasPrice, offer.price);
}

/**
 * Liveness moved to domain/offers.ts — the ad repositories need it too, and the
 * data layer must not reach into features. Re-exported here so every screen
 * keeps importing its offer helpers from one place.
 */
export { isOfferLive, liveOffers } from '@/domain/offers';

/** "2 × Cold coffee" / "Cold coffee" — one line of an offer, for display. */
export function offerLineLabel(line: OfferLine): string {
  const qty = line.quantity ?? 1;
  return qty > 1 ? `${qty} × ${line.name}` : line.name;
}

/** One of the business's own offerings, ready to drop into an offer. */
export interface PickableOffering {
  kind: OfferLineKind;
  name: string;
  price?: string;
  /** Which of the business's lists it came from — the picker's group heading. */
  group: string;
}

/**
 * Everything this business already lists, flattened into pickable lines. This
 * is what the offer builder chooses from — an offer is always made of things
 * the business genuinely sells, never free-typed inventory.
 */
export function pickableOfferings(business: Business): PickableOffering[] {
  const out: PickableOffering[] = [];
  const push = (kind: OfferLineKind, group: string, items?: { name: string; price?: string }[]) => {
    (items ?? []).forEach((i) => out.push({ kind, group, name: i.name, price: i.price }));
  };
  push('menu', 'Menu', business.menu);
  push('service', 'Services', business.services);
  push('product', 'Products', business.products);
  push('rental', 'Rentals', business.rentals);
  return out;
}

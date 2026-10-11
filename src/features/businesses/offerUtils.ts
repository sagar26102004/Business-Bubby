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

/**
 * Where an offer stands, for the workspace list: live, scheduled (its start is
 * still ahead), paused (switched off by hand), or ended (past its end date).
 * The list's "Past / Expired" tab holds both paused and ended.
 */
export type OfferStatus = 'live' | 'scheduled' | 'paused' | 'ended';

export function offerStatus(offer: Offer, now: number = Date.now()): OfferStatus {
  if (offer.endsAt && new Date(offer.endsAt).getTime() < now) return 'ended';
  if (!offer.active) return 'paused';
  if (offer.startsAt && new Date(offer.startsAt).getTime() > now) return 'scheduled';
  return 'live';
}

const dayLabel = (d: Date): string =>
  d.toLocaleDateString('en-IN', { weekday: 'short', day: 'numeric', month: 'short' });

/**
 * The "when" line on an offer card, and whether it's urgent (under a day
 * left): "Expires in 4h 30m", "Ends Sat 12 Oct", "Ended 10 Oct", "Starts Sat
 * 12 Oct", "Paused", "Runs until you pause it".
 */
export function offerEndsLabel(
  offer: Offer,
  now: number = Date.now(),
): { text: string; urgent: boolean } {
  const status = offerStatus(offer, now);
  if (status === 'paused') return { text: 'Paused — hidden from customers', urgent: false };
  if (status === 'scheduled' && offer.startsAt) {
    const start = new Date(offer.startsAt);
    const time = start.toLocaleTimeString('en-IN', { hour: 'numeric', minute: '2-digit' });
    return { text: `Starts ${dayLabel(start)}, ${time}`, urgent: false };
  }
  if (!offer.endsAt) return { text: 'Runs until you pause it', urgent: false };
  const end = new Date(offer.endsAt);
  const left = end.getTime() - now;
  const day = dayLabel(end);
  if (left <= 0) return { text: `Ended ${day}`, urgent: false };
  if (left < 24 * 3600_000) {
    const h = Math.floor(left / 3600_000);
    const m = Math.floor((left % 3600_000) / 60_000);
    return { text: `Expires in ${h > 0 ? `${h}h ` : ''}${m}m`, urgent: true };
  }
  return { text: `Ends ${day}`, urgent: false };
}

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

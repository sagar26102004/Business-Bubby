/**
 * Shared order helpers: line/total math over free-text prices, and one place
 * that says how each order status is presented on either side of the counter.
 */
import type { Business, Offer, Order, OrderFulfillment, OrderLine, OrderStatus } from '@/domain/types';
import { liveOffers, offerLineLabel } from '@/features/businesses/offerUtils';
import { formatMoney, parsePrice } from '@/lib/money';
import type { Offering } from './OfferingPicker';

/** The order-picker identity of an offer bundle. */
export const offerKey = (offerId: string) => `offer:${offerId}`;

/**
 * One offer as something orderable. A bundle is ordered as a SINGLE line named
 * after the offer and priced at the offer price — it can't be split, which is
 * exactly what makes it an offer rather than a list of items. What's inside
 * rides along as the row's description so the customer sees what they get.
 */
export function offerAsOffering(offer: Offer): Offering {
  const contents = offer.lines.map(offerLineLabel).join(' + ') || offer.description;
  return {
    key: offerKey(offer.id),
    // Goods unless everything in the bundle is a service.
    kind:
      offer.lines.length > 0 && offer.lines.every((l) => l.kind === 'service')
        ? 'service'
        : 'product',
    name: offer.title,
    price: offer.price,
    description:
      [contents, offer.wasPrice ? `normally ${offer.wasPrice}` : undefined]
        .filter(Boolean)
        .join(' · ') || undefined,
  };
}

/** A business's live offers, ready to drop into the order picker. */
export function offerOfferings(business: Business): Offering[] {
  return liveOffers(business).map(offerAsOffering);
}

/** A line's price fields — enough of an OrderLine to do money math on. */
export interface PricedLine {
  price?: string;
  offerPrice?: string;
  counterPrice?: string;
  quantity: number;
}

/**
 * The unit price a line currently stands at: the seller's counter beats the
 * customer's bargain offer beats the listed price.
 */
export function effectiveUnitPrice(line: PricedLine): string | undefined {
  return line.counterPrice ?? line.offerPrice ?? line.price;
}

/** Parsed total for one line (effective unit price × quantity), if it parses. */
export function lineAmount(line: PricedLine): number | undefined {
  const unit = parsePrice(effectiveUnitPrice(line));
  return unit === undefined ? undefined : unit * line.quantity;
}

export interface OrderTotal {
  /** Sum of the parseable line amounts. */
  amount: number;
  /** True when at least one counted line has no parseable price. */
  hasUnpriced: boolean;
}

/** Total over the given lines (callers pre-filter to e.g. included lines). */
export function totalOf(lines: PricedLine[]): OrderTotal {
  let amount = 0;
  let hasUnpriced = false;
  for (const line of lines) {
    const a = lineAmount(line);
    if (a === undefined) hasUnpriced = true;
    else amount += a;
  }
  return { amount, hasUnpriced };
}

/** "$145" / "$145 + items to price" / "price on request". */
export function totalLabel(total: OrderTotal): string {
  if (total.amount === 0 && total.hasUnpriced) return 'price on request';
  return total.hasUnpriced ? `${formatMoney(total.amount)} + items to price` : formatMoney(total.amount);
}

/** The lines the business is (or would be) providing. */
export const includedLines = (order: Order): OrderLine[] => order.lines.filter((l) => l.included);

/**
 * An order that's still moving: awaiting a response, awaiting the customer's
 * decision on a proposal, or a confirmed-but-unbilled dine-in tab the customer
 * can still add to. A set billId (or rejection/decline) closes it.
 */
export const isOrderOpen = (order: Order): boolean =>
  !order.billId &&
  (order.status === 'requested' || order.status === 'proposed' || order.status === 'accepted');

/** True when an ISO timestamp falls on the viewer's current calendar day. */
export const isToday = (iso: string): boolean => {
  const d = new Date(iso);
  const now = new Date();
  return (
    d.getFullYear() === now.getFullYear() &&
    d.getMonth() === now.getMonth() &&
    d.getDate() === now.getDate()
  );
};

/** How each fulfillment choice is shown, on both sides of the counter. */
export const FULFILLMENT_META: Record<OrderFulfillment, { icon: string; label: string }> = {
  dine_in: { icon: '🍽️', label: 'Dine-in' },
  takeaway: { icon: '🥡', label: 'Takeaway' },
};

export interface StatusMeta {
  icon: string;
  /** Short label, e.g. "Proposal sent". */
  label: string;
  /** One-liner for the side currently looking at it. */
  customerHint: string;
  businessHint: string;
  tone: 'brand' | 'default' | 'danger';
}

export const ORDER_STATUS_META: Record<OrderStatus, StatusMeta> = {
  requested: {
    icon: '⏳',
    label: 'Requested',
    customerHint: 'Waiting for the business to respond.',
    businessHint: 'Needs your review — accept, adjust, or reject.',
    tone: 'brand',
  },
  proposed: {
    icon: '✏️',
    label: 'Proposal sent',
    customerHint: 'The business can provide part of your order — review what’s in and out.',
    businessHint: 'Waiting for the customer to accept or decline your proposal.',
    tone: 'brand',
  },
  accepted: {
    icon: '✅',
    label: 'Accepted',
    customerHint: 'Confirmed — your bill is ready.',
    businessHint: 'Confirmed — the bill was issued.',
    tone: 'default',
  },
  rejected: {
    icon: '❌',
    label: 'Rejected',
    customerHint: 'The business couldn’t take this order.',
    businessHint: 'You rejected this order.',
    tone: 'danger',
  },
  declined: {
    icon: '🚫',
    label: 'Proposal declined',
    customerHint: 'You declined the business’s proposal.',
    businessHint: 'The customer declined your proposal.',
    tone: 'danger',
  },
};

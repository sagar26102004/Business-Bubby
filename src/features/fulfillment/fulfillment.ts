/**
 * QR handover — the small, business-agnostic service behind "scan to pay,
 * scan to collect". An order carries a QR code (its ticket); a staff member
 * with scan permission points a camera at it and the app walks the order
 * through place → pay → collect. Payment lives on the bill (only the business
 * can confirm money arrived); collection lives on the order (`deliveredAt`).
 *
 * Everything here is deliberately generic: a samosa counter uses it for
 * takeaway today, but any business that hands something over — a pharmacy
 * pickup, a parcel counter, a workshop collection — plugs in by widening
 * `usesQrHandover`. Screens and repositories depend on THESE helpers, never on
 * the specifics of one business type, so the same flow serves them all.
 */
import * as Linking from 'expo-linking';
import type { Bill, Business, Employee, Order } from '@/domain/types';

/** Where an order stands in the handover flow. */
export type HandoverStage = 'unpaid' | 'paid' | 'collected';

export interface HandoverState {
  paid: boolean;
  collected: boolean;
  stage: HandoverStage;
  paidByName?: string;
  paidAt?: string;
  collectedByName?: string;
  collectedAt?: string;
}

/** Presentation for each stage, on both the customer's ticket and staff scan. */
export const HANDOVER_META: Record<HandoverStage, { icon: string; label: string }> = {
  unpaid: { icon: '💳', label: 'Awaiting payment' },
  paid: { icon: '💰', label: 'Paid · ready to collect' },
  collected: { icon: '✅', label: 'Collected' },
};

/**
 * Does this order run through QR handover? Today: takeaway orders (the samosa
 * counter). Widen this one predicate to bring another business's pickups into
 * the exact same scan-to-pay / scan-to-collect flow — nothing else changes.
 */
export function usesQrHandover(order: Pick<Order, 'fulfillment'>): boolean {
  return order.fulfillment === 'takeaway';
}

/** Current handover state, derived from the order and its bill (payment). */
export function handoverOf(order: Order, bill?: Bill | null): HandoverState {
  const paid = bill?.paymentStatus === 'paid';
  const collected = !!order.deliveredAt;
  const stage: HandoverStage = collected ? 'collected' : paid ? 'paid' : 'unpaid';
  return {
    paid,
    collected,
    stage,
    paidByName: bill?.paidByName,
    paidAt: bill?.paidAt,
    collectedByName: order.deliveredByName,
    collectedAt: order.deliveredAt,
  };
}

/** True once the order has a bill — the QR ticket is meaningful from here. */
export const handoverStarted = (order: Order): boolean => !!order.billId;

/**
 * May this viewer scan/advance handovers for the business? The owner always
 * can; employees need to be granted it (`Business.scanHandlerIds`), and only
 * those with an app account can actually scan.
 */
export function canScanFor(
  business: Pick<Business, 'ownerId' | 'scanHandlerIds'>,
  viewerId: string | undefined,
  meEmployee: Pick<Employee, 'id'> | undefined,
): boolean {
  if (!viewerId) return false;
  if (viewerId === business.ownerId) return true;
  if (!meEmployee) return false;
  return (business.scanHandlerIds ?? []).includes(meEmployee.id);
}

/** The link a takeaway order's QR encodes — resolves to the staff scan screen. */
export function orderTicketUrl(orderId: string): string {
  return Linking.createURL(`/fulfill/${orderId}`);
}

/**
 * Pull an order id out of a scanned/pasted value: a full ticket link
 * (…/fulfill/<id>) or a bare id typed into the web paste fallback.
 */
export function orderIdFromScan(raw: string): string | undefined {
  const match = raw.match(/fulfill\/([A-Za-z0-9_-]+)/);
  if (match?.[1]) return match[1];
  const trimmed = raw.trim();
  return /^[A-Za-z0-9_-]+$/.test(trimmed) ? trimmed : undefined;
}

/** Shared order helpers — ports the free functions around orders in the mock. */
import type { Bill, LogEntry, Order } from '@/domain/types';
import { parsePrice } from '@/lib/money';
import { issueBill } from './billing';

export const orderSummary = (order: Order): string => {
  const kept = order.lines.filter((l) => l.included);
  const count = kept.reduce((n, l) => n + l.quantity, 0);
  return `${count} item${count === 1 ? '' : 's'}`;
};

/** Total of an order's included lines at the agreed price, when it parses. */
export const orderAmount = (order: Order): number | undefined => {
  let total = 0;
  let sawPrice = false;
  for (const l of order.lines) {
    if (!l.included) continue;
    const unit = parsePrice(l.counterPrice ?? l.offerPrice ?? l.price);
    if (unit !== undefined) {
      total += unit * l.quantity;
      sawPrice = true;
    }
  }
  return sawPrice ? total : undefined;
};

/** A logbook entry derived from an order (so every in-app order lands in the book). */
export const orderLogEntry = (order: Order): LogEntry => {
  const label = order.party
    ? 'Party order'
    : order.fulfillment === 'dine_in'
      ? 'Dine-in order'
      : order.fulfillment === 'takeaway'
        ? 'Takeaway order'
        : 'Order';
  return {
    id: `log_order_${order.id}`,
    businessId: order.businessId,
    source: 'order',
    orderId: order.id,
    title: `${label} · ${order.customerName}`,
    details: `${orderSummary(order)} · ${order.status}`,
    amount: orderAmount(order),
    customerName: order.customerName,
    recordedByName: 'App',
    createdAt: order.createdAt,
  };
};

/** An order still holding a table (awaiting response/decision, or an open tab). */
export const isOrderStillOpen = (order: Order): boolean =>
  !order.billId &&
  (order.status === 'requested' || order.status === 'proposed' || order.status === 'accepted');

/**
 * Finalise an order: bill the included lines at the agreed price and link the
 * bill back. Mutates `order` (the caller persists it) and returns the bill.
 */
export async function acceptOrder(order: Order): Promise<Bill> {
  const kept = order.lines.filter((l) => l.included);
  const bill = await issueBill({
    businessId: order.businessId,
    customerId: order.customerId,
    customerName: order.customerName,
    lines: kept.map((l) => ({
      name: l.name,
      quantity: l.quantity,
      price: l.counterPrice ?? l.offerPrice ?? l.price,
    })),
    issuedByName: order.respondedByName ?? 'Owner',
    orderId: order.id,
  });
  order.status = 'accepted';
  order.billId = bill.id;
  return bill;
}

/**
 * Supabase-backed LogbookRepository. Manual records live in `log_entries`
 * (members only); every in-app order is derived into an entry on read, so the
 * book is always complete without a write step.
 */
import type { LogEntry, Order } from '@/domain/types';
import type { LogbookRepository, NewLogEntryInput } from '@/data/repositories';
import { parsePrice } from '@/lib/money';
import { sb, uuid, nowIso, byNewest } from './shared';

const orderSummary = (order: Order): string => {
  const kept = order.lines.filter((l) => l.included);
  const count = kept.reduce((n, l) => n + l.quantity, 0);
  return `${count} item${count === 1 ? '' : 's'}`;
};

const orderAmount = (order: Order): number | undefined => {
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

const orderLogEntry = (order: Order): LogEntry => {
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

export function createSupabaseLogbook(): LogbookRepository {
  return {
    async listForBusiness(businessId: string): Promise<LogEntry[]> {
      const [ordersR, manualR] = await Promise.all([
        sb().from('orders').select('data').eq('business_id', businessId),
        sb().from('log_entries').select('data').eq('business_id', businessId),
      ]);
      const derived = (ordersR.data ?? []).map((r) => orderLogEntry(r.data as Order));
      const manual = (manualR.data ?? []).map((r) => r.data as LogEntry);
      return [...derived, ...manual].sort(byNewest((l) => l.createdAt));
    },

    async addManual(input: NewLogEntryInput): Promise<LogEntry> {
      const title = input.title.trim();
      if (!title) throw new Error('Give the record a title.');
      const entry: LogEntry = {
        id: uuid(),
        businessId: input.businessId,
        source: 'manual',
        title,
        details: input.details?.trim() || undefined,
        amount: input.amount,
        customerName: input.customerName?.trim() || undefined,
        recordedByName: input.recordedByName,
        createdAt: nowIso(),
      };
      const { error } = await sb()
        .from('log_entries')
        .insert({ id: entry.id, business_id: input.businessId, data: entry });
      if (error) throw error;
      return entry;
    },
  };
}

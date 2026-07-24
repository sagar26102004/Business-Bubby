/**
 * Supabase-backed OrderRepository over the `orders` table.
 *
 * Faithful to the mock, with ONE RLS-driven adaptation: when a CUSTOMER accepts
 * a proposal, the mock auto-issues a bill — but a customer can't INSERT a bill
 * under RLS (only members can). So a customer-accepted order becomes a confirmed
 * OPEN TAB (status `accepted`, no billId); the business closes it with
 * `moveToBilling`, exactly like a dine-in tab. The business accepting a whole
 * order still bills immediately (a member CAN issue bills).
 */
import type { Business, Order } from '@/domain/types';
import type {
  NewOrderInput,
  NewOrderLineInput,
  OrderRepository,
  TableSeat,
} from '@/data/repositories';
import { formatMoney } from '@/lib/money';
import { sb, uuid, nowIso, uuidOrNull, notify, byNewest } from './shared';
import { issueBill } from './bills';

const orderSummary = (order: Order): string => {
  const kept = order.lines.filter((l) => l.included);
  const count = kept.reduce((n, l) => n + l.quantity, 0);
  return `${count} item${count === 1 ? '' : 's'}`;
};

const isOrderStillOpen = (order: Order): boolean =>
  !order.billId &&
  (order.status === 'requested' || order.status === 'proposed' || order.status === 'accepted');

async function loadBusiness(id: string): Promise<Business | null> {
  const { data, error } = await sb().from('businesses').select('data').eq('id', id).maybeSingle();
  if (error) throw error;
  return data ? (data.data as Business) : null;
}

async function loadOrder(id: string): Promise<Order> {
  const { data, error } = await sb().from('orders').select('data').eq('id', id).maybeSingle();
  if (error) throw error;
  if (!data) throw new Error(`Order ${id} not found`);
  return data.data as Order;
}

async function saveOrder(order: Order): Promise<void> {
  const { error } = await sb().from('orders').update({ data: order }).eq('id', order.id);
  if (error) throw error;
}

/** Dine-in orders currently seated at a business (best-effort under RLS). */
async function openDineInOrders(businessId: string): Promise<Order[]> {
  const { data } = await sb().from('orders').select('data').eq('business_id', businessId);
  return (data ?? [])
    .map((r) => r.data as Order)
    .filter((o) => o.fulfillment === 'dine_in' && o.tableNumber != null && isOrderStillOpen(o));
}

/** Bill an order's included lines (member actor only) and link the bill back. */
async function acceptOrder(order: Order): Promise<{ order: Order; total: number }> {
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
  await saveOrder(order);
  return { order, total: bill.total };
}

export function createSupabaseOrders(): OrderRepository {
  return {
    async create(input: NewOrderInput): Promise<Order> {
      const business = await loadBusiness(input.businessId);
      let tableNumber: number | undefined;
      if (input.fulfillment === 'dine_in' && business?.tableCount) {
        if (input.tableNumber != null) {
          tableNumber = input.tableNumber;
        } else {
          const open = await openDineInOrders(input.businessId);
          const mine = open.find((o) => o.customerId === input.customerId && o.tableNumber != null);
          if (mine?.tableNumber != null) {
            tableNumber = mine.tableNumber;
          } else {
            const taken = new Set(open.map((o) => o.tableNumber!));
            for (let n = 1; n <= business.tableCount; n++) {
              if (!taken.has(n)) {
                tableNumber = n;
                break;
              }
            }
          }
        }
      }

      const order: Order = {
        id: uuid(),
        businessId: input.businessId,
        customerId: input.customerId,
        customerName: input.customerName,
        lines: input.lines.map((l) => ({
          id: uuid(),
          kind: l.kind,
          name: l.name,
          price: l.price,
          offerPrice: l.offerPrice?.trim() || undefined,
          quantity: Math.max(1, Math.round(l.quantity)),
          included: true,
        })),
        fulfillment: input.fulfillment,
        tableNumber,
        party: input.party,
        enrollees: input.enrollees?.map((n) => n.trim()).filter(Boolean),
        note: input.note,
        status: 'requested',
        createdAt: nowIso(),
      };
      const { error } = await sb().from('orders').insert({
        id: order.id,
        business_id: input.businessId,
        customer_id: uuidOrNull(input.customerId),
        data: order,
      });
      if (error) throw error;

      if (business) {
        if (order.party) {
          await notify({
            recipientId: business.ownerId,
            kind: 'order_requested',
            title: `🎉 Party request · ${business.name}`,
            body: `${input.customerName} wants to host ${order.party.occasion ? `a ${order.party.occasion.toLowerCase()}` : 'a party'} for ${order.party.guests} guests — ${order.party.when}.`,
            businessId: business.id,
            orderId: order.id,
          });
        } else {
          const fulfillment =
            order.fulfillment === 'dine_in' ? ' · Dine-in' : order.fulfillment === 'takeaway' ? ' · Takeaway' : '';
          const bargained = order.lines.some((l) => l.offerPrice) ? ' with a price offer' : '';
          const enrolling =
            order.enrollees && order.enrollees.length > 0 ? ` for ${order.enrollees.join(', ')}` : '';
          await notify({
            recipientId: business.ownerId,
            kind: 'order_requested',
            title: `New order · ${business.name}`,
            body: `${input.customerName} ordered ${orderSummary(order)}${enrolling}${bargained}${fulfillment}.`,
            businessId: business.id,
            orderId: order.id,
          });
        }
      }
      return order;
    },

    async getById(id: string): Promise<Order | null> {
      const { data, error } = await sb().from('orders').select('data').eq('id', id).maybeSingle();
      if (error) throw error;
      return data ? (data.data as Order) : null;
    },

    async listForBusiness(businessId: string): Promise<Order[]> {
      const { data, error } = await sb().from('orders').select('data').eq('business_id', businessId);
      if (error) throw error;
      return (data ?? []).map((r) => r.data as Order).sort(byNewest((o) => o.createdAt));
    },

    async listForCustomer(customerId: string, businessId?: string): Promise<Order[]> {
      let q = sb().from('orders').select('data').eq('customer_id', customerId);
      if (businessId) q = q.eq('business_id', businessId);
      const { data, error } = await q;
      if (error) throw error;
      return (data ?? []).map((r) => r.data as Order).sort(byNewest((o) => o.createdAt));
    },

    async respond(
      id: string,
      keptLineIds: string[],
      respondedByName: string,
      message?: string,
      counterPrices?: Record<string, string>,
    ): Promise<Order> {
      const order = await loadOrder(id);
      if (order.status !== 'requested') throw new Error('This order was already responded to.');
      const kept = new Set(keptLineIds);
      if (kept.size === 0) {
        throw new Error('Keep at least one item — to turn the whole order down, reject it instead.');
      }
      order.lines.forEach((l) => {
        l.included = kept.has(l.id);
        l.counterPrice = (l.included && counterPrices?.[l.id]?.trim()) || undefined;
      });
      order.respondedByName = respondedByName;
      order.respondedAt = nowIso();
      order.responseMessage = message?.trim() || undefined;

      const business = await loadBusiness(order.businessId);
      const businessName = business?.name ?? 'Business';
      const countered = order.lines.some((l) => l.counterPrice);
      if (order.lines.every((l) => l.included) && !countered) {
        if (order.fulfillment === 'dine_in' || order.party) {
          order.status = 'accepted';
          await saveOrder(order);
          await notify({
            recipientId: order.customerId,
            kind: 'order_update',
            title: order.party ? `Party confirmed · ${businessName}` : `Order confirmed · ${businessName}`,
            body: order.party
              ? `Your party for ${order.party.guests} guests (${order.party.when}) is confirmed — the bill comes after the event.`
              : `${orderSummary(order)} confirmed — add more anytime; the bill comes at the end.`,
            businessId: order.businessId,
            orderId: order.id,
          });
          return order;
        }
        const { total } = await acceptOrder(order);
        await notify({
          recipientId: order.customerId,
          kind: 'order_update',
          title: `Order accepted · ${businessName}`,
          body: `${orderSummary(order)} confirmed — your bill is ${formatMoney(total)}.`,
          businessId: order.businessId,
          orderId: order.id,
        });
      } else {
        order.status = 'proposed';
        await saveOrder(order);
        await notify({
          recipientId: order.customerId,
          kind: 'order_update',
          title: countered ? `Counter-offer from ${businessName}` : `Proposal from ${businessName}`,
          body: countered
            ? 'The seller countered your offer — review the price and confirm.'
            : `They can provide ${orderSummary(order)} of your order — review and confirm.`,
          businessId: order.businessId,
          orderId: order.id,
        });
      }
      return order;
    },

    async reject(id: string, respondedByName: string, message?: string): Promise<Order> {
      const order = await loadOrder(id);
      if (order.status !== 'requested') throw new Error('This order was already responded to.');
      order.status = 'rejected';
      order.respondedByName = respondedByName;
      order.respondedAt = nowIso();
      order.responseMessage = message?.trim() || undefined;
      await saveOrder(order);

      const business = await loadBusiness(order.businessId);
      await notify({
        recipientId: order.customerId,
        kind: 'order_update',
        title: `Order rejected · ${business?.name ?? 'Business'}`,
        body: order.responseMessage ?? 'The business couldn’t take this order.',
        businessId: order.businessId,
        orderId: order.id,
      });
      return order;
    },

    async decideProposal(id: string, accept: boolean): Promise<Order> {
      const order = await loadOrder(id);
      if (order.status !== 'proposed') throw new Error('There is no open proposal on this order.');
      const business = await loadBusiness(order.businessId);

      if (accept) {
        // RLS: a customer can't issue a bill. A customer-accepted proposal becomes
        // a confirmed OPEN TAB; the business closes it with "Move to billing".
        order.status = 'accepted';
        await saveOrder(order);
        if (business) {
          const dineInOrParty = order.fulfillment === 'dine_in' || order.party;
          await notify({
            recipientId: business.ownerId,
            kind: 'order_update',
            title: `Proposal accepted · ${business.name}`,
            body: order.party
              ? `${order.customerName} agreed — party for ${order.party.guests} guests, ${order.party.when}. Bill it after the event.`
              : dineInOrParty
                ? `${order.customerName} confirmed ${orderSummary(order)} — move the tab to billing when they're done.`
                : `${order.customerName} accepted your proposal (${orderSummary(order)}) — move it to billing to issue the bill.`,
            businessId: order.businessId,
            orderId: order.id,
          });
        }
      } else {
        order.status = 'declined';
        await saveOrder(order);
        if (business) {
          await notify({
            recipientId: business.ownerId,
            kind: 'order_update',
            title: `Proposal declined · ${business.name}`,
            body: `${order.customerName} declined your proposal.`,
            businessId: order.businessId,
            orderId: order.id,
          });
        }
      }
      return order;
    },

    async appendLines(id: string, lines: NewOrderLineInput[]): Promise<Order> {
      const order = await loadOrder(id);
      if (order.billId) throw new Error('This order was already billed — place a new order instead.');
      if (order.status !== 'requested' && order.status !== 'accepted') {
        throw new Error('This order is not open anymore — place a new order instead.');
      }
      if (lines.length === 0) throw new Error('Pick at least one item to add.');
      order.lines.push(
        ...lines.map((l) => ({
          id: uuid(),
          kind: l.kind,
          name: l.name,
          price: l.price,
          offerPrice: l.offerPrice?.trim() || undefined,
          quantity: Math.max(1, Math.round(l.quantity)),
          included: true,
        })),
      );
      order.status = 'requested';
      order.responseMessage = undefined;
      await saveOrder(order);

      const business = await loadBusiness(order.businessId);
      if (business) {
        await notify({
          recipientId: business.ownerId,
          kind: 'order_requested',
          title: `Order updated · ${business.name}`,
          body: `${order.customerName} added more items — now ${orderSummary(order)} in total.`,
          businessId: business.id,
          orderId: order.id,
        });
      }
      return order;
    },

    async moveToBilling(id: string, issuedByName: string): Promise<Order> {
      const order = await loadOrder(id);
      if (order.billId) throw new Error('This order was already billed.');
      if (order.status !== 'accepted') {
        throw new Error('Only a confirmed open order can be moved to billing.');
      }
      order.respondedByName = issuedByName;
      const { total } = await acceptOrder(order);

      const business = await loadBusiness(order.businessId);
      await notify({
        recipientId: order.customerId,
        kind: 'order_update',
        title: `Bill ready · ${business?.name ?? 'Business'}`,
        body: `Your tab was closed — the bill is ${formatMoney(total)}.`,
        businessId: order.businessId,
        orderId: order.id,
      });
      return order;
    },

    async markDelivered(id: string, byName: string): Promise<Order> {
      const order = await loadOrder(id);
      if (order.deliveredAt) throw new Error('This order was already collected.');
      if (!order.billId) throw new Error('Accept and bill the order before handing it over.');
      order.deliveredAt = nowIso();
      order.deliveredByName = byName;
      await saveOrder(order);

      const business = await loadBusiness(order.businessId);
      await notify({
        recipientId: order.customerId,
        kind: 'order_update',
        title: `Order collected · ${business?.name ?? 'Business'}`,
        body: `${byName} handed over your order — enjoy!`,
        businessId: order.businessId,
        orderId: order.id,
      });
      return order;
    },

    async tableStatus(businessId: string): Promise<TableSeat[]> {
      const business = await loadBusiness(businessId);
      const count = business?.tableCount ?? 0;
      const open = await openDineInOrders(businessId);
      const seated = new Map<number, Order>();
      open.forEach((o) => seated.set(o.tableNumber!, o));
      return Array.from({ length: count }, (_, i) => {
        const number = i + 1;
        return { number, order: seated.get(number) ?? null };
      });
    },
  };
}

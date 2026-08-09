/** Orders — ports MockOrderRepository (proposals, dine-in tabs, tables). */
import type { Business, Order } from '@/domain/types';
import type { NewOrderInput, NewOrderLineInput, TableSeat } from '@/domain/contracts';
import { prisma } from '@/db';
import { newUuid } from '@/lib/ids';
import { asData, isUuid, jsonEquals, rowsData, toJson, uuidOrNull } from '@/lib/data';
import { formatMoney } from '@/lib/money';
import { notFound } from '@/http/errors';
import { isBusinessMember } from '@/authz';
import { notify } from './notify';
import { acceptOrder, isOrderStillOpen, orderSummary } from './orderUtils';

async function findBusiness(id: string): Promise<Business | null> {
  const row = await prisma.business.findUnique({ where: { id } });
  return row ? asData<Business>(row) : null;
}

async function ordersForBusiness(businessId: string): Promise<Order[]> {
  return rowsData<Order>(await prisma.order.findMany({ where: { businessId } }));
}

async function saveOrder(order: Order): Promise<void> {
  await prisma.order.update({
    where: { id: order.id },
    data: { customerId: uuidOrNull(order.customerId), data: toJson(order) },
  });
}

async function mustFind(id: string): Promise<Order> {
  const row = await prisma.order.findUnique({ where: { id } });
  if (!row) throw notFound(`Order ${id} not found`);
  return asData<Order>(row);
}

/** Table numbers currently taken by open dine-in orders. */
function occupiedTables(businessOrders: Order[]): Set<number> {
  const taken = new Set<number>();
  for (const o of businessOrders) {
    if (o.fulfillment !== 'dine_in' || o.tableNumber == null) continue;
    if (isOrderStillOpen(o)) taken.add(o.tableNumber);
  }
  return taken;
}

function assignTable(
  business: Business | undefined,
  explicit: number | undefined,
  customerId: string,
  businessOrders: Order[],
): number | undefined {
  if (!business?.tableCount) return undefined;
  if (explicit != null) return explicit;
  const taken = occupiedTables(businessOrders);
  if (customerId && customerId !== 'guest') {
    const existing = businessOrders.find(
      (o) =>
        o.customerId === customerId &&
        o.fulfillment === 'dine_in' &&
        o.tableNumber != null &&
        isOrderStillOpen(o),
    );
    if (existing?.tableNumber != null) return existing.tableNumber;
  }
  for (let n = 1; n <= business.tableCount; n++) {
    if (!taken.has(n)) return n;
  }
  return undefined;
}

const buildLine = (l: NewOrderLineInput) => ({
  id: newUuid(),
  kind: l.kind,
  name: l.name,
  price: l.price,
  offerPrice: l.offerPrice?.trim() || undefined,
  quantity: Math.max(1, Math.round(l.quantity)),
  included: true,
});

/**
 * What the BUSINESS says this line costs, looked up in its own catalogue by
 * name (case-insensitive across menu, products, services, rentals and party
 * packages). Returns undefined when the business doesn't list it.
 */
function catalogPrice(business: Business | null, name: string): string | undefined {
  if (!business) return undefined;
  const wanted = name.trim().toLowerCase();
  const pools: Array<Array<{ name: string; price?: string }> | undefined> = [
    business.menu,
    business.products,
    business.services,
    business.rentals,
    business.partyPackages,
  ];
  for (const pool of pools) {
    const hit = pool?.find((i) => i.name.trim().toLowerCase() === wanted);
    if (hit?.price) return hit.price;
  }
  return undefined;
}

/**
 * Build an order line whose PRICE the customer cannot dictate.
 *
 * A customer used to be able to send any `price` they liked. Because an
 * accepted dine-in tab stays open by design and "Move to billing" bills
 * straight from `order.lines`, a line priced "₹0" became a ₹0 bill that the
 * business never re-checked — it had already approved the order. So for a
 * non-member actor the price is taken from the business's own catalogue, and
 * the client's value is used only for something the business doesn't list
 * (a custom/ad-hoc line, which a human prices during the proposal anyway).
 *
 * `offerPrice` is deliberately kept: that is the customer OFFERING a price,
 * which the business explicitly accepts or counters. It never bills by itself.
 */
function buildTrustedLine(l: NewOrderLineInput, business: Business | null, trusted: boolean) {
  const line = buildLine(l);
  if (trusted) return line;
  return { ...line, price: catalogPrice(business, l.name) ?? l.price };
}

export const orderService = {
  /**
   * Place an order. `actorId` is the authenticated caller — when they are NOT a
   * member of the business, line prices are re-derived from the catalogue
   * rather than trusted from the request (see buildTrustedLine).
   */
  async create(input: NewOrderInput, actorId?: string | null): Promise<Order> {
    const business = await findBusiness(input.businessId);
    const trusted = await isBusinessMember(input.businessId, actorId ?? null);
    const tableNumber =
      input.fulfillment === 'dine_in'
        ? assignTable(
            business ?? undefined,
            input.tableNumber,
            input.customerId,
            await ordersForBusiness(input.businessId),
          )
        : undefined;

    const order: Order = {
      id: newUuid(),
      businessId: input.businessId,
      customerId: input.customerId,
      customerName: input.customerName,
      lines: input.lines.map((l) => buildTrustedLine(l, business, trusted)),
      fulfillment: input.fulfillment,
      tableNumber,
      party: input.party,
      enrollees: input.enrollees?.map((n) => n.trim()).filter(Boolean),
      note: input.note,
      status: 'requested',
      createdAt: new Date().toISOString(),
    };
    await prisma.order.create({
      data: {
        id: order.id,
        businessId: order.businessId,
        customerId: uuidOrNull(order.customerId),
        data: toJson(order),
      },
    });

    if (business) {
      if (order.party) {
        await notify({
          recipientId: business.ownerId,
          kind: 'order_requested',
          title: `🎉 Party request · ${business.name}`,
          body: `${input.customerName} wants to host ${
            order.party.occasion ? `a ${order.party.occasion.toLowerCase()}` : 'a party'
          } for ${order.party.guests} guests — ${order.party.when}.`,
          businessId: business.id,
          orderId: order.id,
        });
        return order;
      }
      const fulfillment =
        order.fulfillment === 'dine_in'
          ? ' · Dine-in'
          : order.fulfillment === 'takeaway'
            ? ' · Takeaway'
            : '';
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
    return order;
  },

  async getById(id: string): Promise<Order | null> {
    const row = await prisma.order.findUnique({ where: { id } });
    return row ? asData<Order>(row) : null;
  },

  async listForBusiness(businessId: string): Promise<Order[]> {
    const rows = await prisma.order.findMany({
      where: { businessId },
      orderBy: { createdAt: 'desc' },
    });
    return rowsData<Order>(rows);
  },

  async listForCustomer(customerId: string, businessId?: string): Promise<Order[]> {
    // A logged-out viewer arrives as the literal 'guest' — never a real account.
    if (!isUuid(customerId)) return [];
    const rows = await prisma.order.findMany({
      where: {
        AND: [
          { data: jsonEquals('customerId', customerId) },
          ...(businessId ? [{ businessId }] : []),
        ],
      },
      orderBy: { createdAt: 'desc' },
    });
    return rowsData<Order>(rows);
  },

  async respond(
    id: string,
    keptLineIds: string[],
    respondedByName: string,
    message?: string,
    counterPrices?: Record<string, string>,
  ): Promise<Order> {
    const order = await mustFind(id);
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
    order.respondedAt = new Date().toISOString();
    order.responseMessage = message?.trim() || undefined;

    const business = await findBusiness(order.businessId);
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
      const bill = await acceptOrder(order);
      await saveOrder(order);
      await notify({
        recipientId: order.customerId,
        kind: 'order_update',
        title: `Order accepted · ${businessName}`,
        body: `${orderSummary(order)} confirmed — your bill is ${formatMoney(bill.total)}.`,
        businessId: order.businessId,
        orderId: order.id,
      });
      return order;
    }

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
    return order;
  },

  async reject(id: string, respondedByName: string, message?: string): Promise<Order> {
    const order = await mustFind(id);
    if (order.status !== 'requested') throw new Error('This order was already responded to.');
    order.status = 'rejected';
    order.respondedByName = respondedByName;
    order.respondedAt = new Date().toISOString();
    order.responseMessage = message?.trim() || undefined;
    await saveOrder(order);

    const business = await findBusiness(order.businessId);
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
    const order = await mustFind(id);
    if (order.status !== 'proposed') throw new Error('There is no open proposal on this order.');
    const business = await findBusiness(order.businessId);

    if (accept) {
      if (order.fulfillment === 'dine_in' || order.party) {
        order.status = 'accepted';
        await saveOrder(order);
        if (business) {
          await notify({
            recipientId: business.ownerId,
            kind: 'order_update',
            title: `Proposal accepted · ${business.name}`,
            body: order.party
              ? `${order.customerName} agreed — party for ${order.party.guests} guests, ${order.party.when}. Bill it after the event.`
              : `${order.customerName} confirmed ${orderSummary(order)} — move the tab to billing when they're done.`,
            businessId: order.businessId,
            orderId: order.id,
          });
        }
        return order;
      }
      const bill = await acceptOrder(order);
      await saveOrder(order);
      if (business) {
        await notify({
          recipientId: business.ownerId,
          kind: 'order_update',
          title: `Proposal accepted · ${business.name}`,
          body: `${order.customerName} confirmed ${orderSummary(order)} — bill ${formatMoney(bill.total)} issued.`,
          businessId: order.businessId,
          orderId: order.id,
        });
      }
      return order;
    }

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
    return order;
  },

  /**
   * Add a round to an open tab. Same price rule as `create`: a customer cannot
   * append a line at a price of their choosing.
   */
  async appendLines(id: string, lines: NewOrderLineInput[], actorId?: string | null): Promise<Order> {
    const order = await mustFind(id);
    if (order.billId) throw new Error('This order was already billed — place a new order instead.');
    if (order.status !== 'requested' && order.status !== 'accepted') {
      throw new Error('This order is not open anymore — place a new order instead.');
    }
    if (lines.length === 0) throw new Error('Pick at least one item to add.');
    const appendBusiness = await findBusiness(order.businessId);
    const trusted = await isBusinessMember(order.businessId, actorId ?? null);
    order.lines.push(...lines.map((l) => buildTrustedLine(l, appendBusiness, trusted)));
    order.status = 'requested';
    order.responseMessage = undefined;
    await saveOrder(order);

    const business = await findBusiness(order.businessId);
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
    const order = await mustFind(id);
    if (order.billId) throw new Error('This order was already billed.');
    if (order.status !== 'accepted') {
      throw new Error('Only a confirmed open order can be moved to billing.');
    }
    order.respondedByName = issuedByName;
    const bill = await acceptOrder(order);
    await saveOrder(order);

    const business = await findBusiness(order.businessId);
    await notify({
      recipientId: order.customerId,
      kind: 'order_update',
      title: `Bill ready · ${business?.name ?? 'Business'}`,
      body: `Your tab was closed — the bill is ${formatMoney(bill.total)}.`,
      businessId: order.businessId,
      orderId: order.id,
    });
    return order;
  },

  async markDelivered(id: string, byName: string): Promise<Order> {
    const order = await mustFind(id);
    if (order.deliveredAt) throw new Error('This order was already collected.');
    if (!order.billId) throw new Error('Accept and bill the order before handing it over.');
    order.deliveredAt = new Date().toISOString();
    order.deliveredByName = byName;
    await saveOrder(order);

    const business = await findBusiness(order.businessId);
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
    const business = await findBusiness(businessId);
    const count = business?.tableCount ?? 0;
    const businessOrders = await ordersForBusiness(businessId);
    const seated = new Map<number, Order>();
    for (const o of businessOrders) {
      if (o.fulfillment !== 'dine_in' || o.tableNumber == null) continue;
      if (!isOrderStillOpen(o)) continue;
      seated.set(o.tableNumber, o);
    }
    return Array.from({ length: count }, (_, i) => {
      const number = i + 1;
      return { number, order: seated.get(number) ?? null };
    });
  },
};

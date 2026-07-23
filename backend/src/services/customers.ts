/** Customers — ports MockCustomerRepository (aggregated, favourites persisted). */
import type { Bill, Booking, Business, Call, ChatMessage, Order, User } from '@/domain/types';
import type { CustomerSummary } from '@/domain/contracts';
import { prisma } from '@/db';
import { asData, rowsData, toJson } from '@/lib/data';
import { notFound } from '@/http/errors';

const customerKeyForBill = (bill: Bill): string =>
  bill.customerId ?? `walkin:${bill.customerName.trim().toLowerCase()}`;

export const customerService = {
  async listForBusiness(businessId: string): Promise<CustomerSummary[]> {
    const bizRow = await prisma.business.findUnique({ where: { id: businessId } });
    if (!bizRow) return [];
    const business = asData<Business>(bizRow);

    const [orderRows, bookingRows, callRows, billRows, chatRows, profileRows] = await Promise.all([
      prisma.order.findMany({ where: { businessId } }),
      prisma.booking.findMany({ where: { businessId } }),
      prisma.call.findMany({ where: { businessId } }),
      prisma.bill.findMany({ where: { businessId } }),
      prisma.chatMessage.findMany({ where: { businessId } }),
      prisma.profile.findMany(),
    ]);

    const profiles = new Map(rowsData<User>(profileRows).map((u) => [u.id, u]));
    const byKey = new Map<string, CustomerSummary>();
    const touch = (key: string, name: string, at: string): CustomerSummary => {
      let c = byKey.get(key);
      if (!c) {
        c = {
          businessId,
          key,
          name,
          hasAccount: profiles.has(key),
          favorite: false,
          orderCount: 0,
          bookingCount: 0,
          billCount: 0,
          callCount: 0,
          chatCount: 0,
          totalBilled: 0,
          lastActivityAt: at,
        };
        byKey.set(key, c);
      }
      if (at > c.lastActivityAt) {
        c.lastActivityAt = at;
        c.name = name;
      }
      return c;
    };

    rowsData<Order>(orderRows).forEach(
      (o) => (touch(o.customerId, o.customerName, o.createdAt).orderCount += 1),
    );
    rowsData<Booking>(bookingRows).forEach(
      (b) => (touch(b.customerId, b.customerName, b.createdAt).bookingCount += 1),
    );
    rowsData<Call>(callRows).forEach(
      (c) => (touch(c.customerId, c.customerName, c.startedAt).callCount += 1),
    );
    rowsData<Bill>(billRows).forEach((b) => {
      const c = touch(customerKeyForBill(b), b.customerName, b.createdAt);
      c.billCount += 1;
      c.totalBilled += b.total;
    });
    for (const row of chatRows) {
      const m = asData<ChatMessage>(row);
      const pid = row.participantId;
      const name = pid === 'guest' ? 'Guest' : profiles.get(pid)?.name ?? pid;
      touch(pid, name, m.createdAt).chatCount += 1;
    }

    const favorites = new Set(business.favoriteCustomerIds ?? []);
    byKey.forEach((c) => (c.favorite = favorites.has(c.key)));

    return Array.from(byKey.values()).sort((a, b) => {
      if (a.favorite !== b.favorite) return a.favorite ? -1 : 1;
      return b.lastActivityAt.localeCompare(a.lastActivityAt);
    });
  },

  async setFavorite(businessId: string, customerKey: string, favorite: boolean): Promise<void> {
    const row = await prisma.business.findUnique({ where: { id: businessId } });
    if (!row) throw notFound(`Business ${businessId} not found`);
    const business = asData<Business>(row);
    const current = new Set(business.favoriteCustomerIds ?? []);
    if (favorite) current.add(customerKey);
    else current.delete(customerKey);
    business.favoriteCustomerIds = Array.from(current);
    await prisma.business.update({ where: { id: businessId }, data: { data: toJson(business) } });
  },
};

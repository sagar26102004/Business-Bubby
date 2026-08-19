/**
 * Supabase-backed CustomerRepository. Nothing is stored — the customer list is
 * aggregated live from a business's orders, bookings, bills, chats and calls
 * (members can read all of these for their business under RLS). Favourites are
 * the one persisted piece, on the business itself.
 */
import type { Bill, Booking, Business, Call, ChatMessage, Order } from '@/domain/types';
import type { CustomerRepository, CustomerSummary } from '@/data/repositories';
import { sb } from './shared';

const customerKeyForBill = (bill: Bill): string =>
  bill.customerId ?? `walkin:${bill.customerName.trim().toLowerCase()}`;

export function createSupabaseCustomers(): CustomerRepository {
  return {
    async listForBusiness(businessId: string): Promise<CustomerSummary[]> {
      const { data: bizRow } = await sb().from('businesses').select('data').eq('id', businessId).maybeSingle();
      const business = bizRow?.data as Business | undefined;
      if (!business) return [];

      const [ordersR, bookingsR, callsR, billsR, chatsR] = await Promise.all([
        sb().from('orders').select('data').eq('business_id', businessId),
        sb().from('bookings').select('data').eq('business_id', businessId),
        sb().from('calls').select('data').eq('business_id', businessId),
        sb().from('bills').select('data').eq('business_id', businessId),
        sb().from('chat_messages').select('participant_id, data').eq('business_id', businessId),
      ]);

      const byKey = new Map<string, CustomerSummary>();
      const accountKeys = new Set<string>();
      const touch = (key: string, name: string, at: string): CustomerSummary => {
        let c = byKey.get(key);
        if (!c) {
          c = {
            businessId,
            key,
            name,
            hasAccount: false,
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

      (ordersR.data ?? []).forEach((r) => {
        const o = r.data as Order;
        touch(o.customerId, o.customerName, o.createdAt).orderCount += 1;
        if (o.customerId && o.customerId !== 'guest') accountKeys.add(o.customerId);
      });
      (bookingsR.data ?? []).forEach((r) => {
        const b = r.data as Booking;
        touch(b.customerId, b.customerName, b.createdAt).bookingCount += 1;
        if (b.customerId && b.customerId !== 'guest') accountKeys.add(b.customerId);
      });
      (callsR.data ?? []).forEach((r) => {
        const c = r.data as Call;
        touch(c.customerId, c.customerName, c.startedAt).callCount += 1;
        if (c.customerId && c.customerId !== 'guest') accountKeys.add(c.customerId);
      });
      (billsR.data ?? []).forEach((r) => {
        const b = r.data as Bill;
        const c = touch(customerKeyForBill(b), b.customerName, b.createdAt);
        c.billCount += 1;
        c.totalBilled += b.total;
        if (b.customerId) accountKeys.add(b.customerId);
      });

      // Chat participant display names come from their profiles.
      const chatRows = chatsR.data ?? [];
      const pids = Array.from(
        new Set(chatRows.map((r) => r.participant_id as string).filter((p) => p && p !== 'guest')),
      );
      const names = new Map<string, string>();
      if (pids.length > 0) {
        const { data } = await sb().from('profiles').select('id, data').in('id', pids);
        (data ?? []).forEach((r) => {
          names.set(r.id as string, (r.data as { name: string }).name);
          accountKeys.add(r.id as string);
        });
      }
      chatRows.forEach((r) => {
        const pid = r.participant_id as string;
        const m = r.data as ChatMessage;
        // Anonymous identities (guest chat, guest orders) get a profile row with
        // an EMPTY name, so `??` isn't enough — an empty string would render as
        // a blank customer. Anything unnamed reads as "Guest".
        const name = pid === 'guest' ? 'Guest' : names.get(pid) || 'Guest';
        touch(pid, name, m.createdAt).chatCount += 1;
      });

      byKey.forEach((c) => (c.hasAccount = accountKeys.has(c.key)));
      const favorites = new Set(business.favoriteCustomerIds ?? []);
      byKey.forEach((c) => (c.favorite = favorites.has(c.key)));

      return Array.from(byKey.values()).sort((a, b) => {
        if (a.favorite !== b.favorite) return a.favorite ? -1 : 1;
        return b.lastActivityAt.localeCompare(a.lastActivityAt);
      });
    },

    async setFavorite(businessId: string, customerKey: string, favorite: boolean): Promise<void> {
      const { data, error } = await sb().from('businesses').select('data').eq('id', businessId).maybeSingle();
      if (error) throw error;
      if (!data) throw new Error(`Business ${businessId} not found`);
      const business = data.data as Business;
      const current = new Set(business.favoriteCustomerIds ?? []);
      if (favorite) current.add(customerKey);
      else current.delete(customerKey);
      const { error: uErr } = await sb()
        .from('businesses')
        .update({ data: { ...business, favoriteCustomerIds: Array.from(current) } })
        .eq('id', businessId);
      if (uErr) throw uErr;
    },
  };
}

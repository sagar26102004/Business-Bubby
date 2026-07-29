/**
 * Supabase-backed BillRepository over the `bills` table (members issue;
 * customers read). `issueBill` is exported so the order flow can bill an
 * accepted order in the same way.
 */
import type { Bill, BillLine, Business, PaymentStatus } from '@/domain/types';
import type { BillRepository, NewBillInput } from '@/data/repositories';
import { formatMoney, parsePrice } from '@/lib/money';
import { sb, uuid, nowIso, isUuid, uuidOrNull, notify, byNewest } from './shared';

/** Compute line amounts + total and insert the bill. Shared by both flows. */
export async function issueBill(input: NewBillInput): Promise<Bill> {
  const lines: BillLine[] = input.lines.map((l) => {
    const unit = parsePrice(l.price);
    return { ...l, amount: unit === undefined ? undefined : unit * l.quantity };
  });
  const total = lines.reduce((sum, l) => sum + (l.amount ?? 0), 0);
  const { data } = await sb().from('businesses').select('data').eq('id', input.businessId).maybeSingle();
  const businessName = (data?.data as Business | undefined)?.name ?? 'Business';
  const bill: Bill = {
    id: uuid(),
    businessId: input.businessId,
    businessName,
    customerId: input.customerId,
    customerName: input.customerName,
    lines,
    total,
    note: input.note,
    issuedByName: input.issuedByName,
    orderId: input.orderId,
    paymentStatus: 'pending',
    createdAt: nowIso(),
  };
  const { error } = await sb().from('bills').insert({
    id: bill.id,
    business_id: input.businessId,
    customer_id: uuidOrNull(input.customerId),
    data: bill,
  });
  if (error) throw error;
  return bill;
}

const threadKeyFor = (businessId: string, participantId: string) => `${businessId}:${participantId}`;

export function createSupabaseBills(): BillRepository {
  return {
    async create(input: NewBillInput): Promise<Bill> {
      const bill = await issueBill(input);
      if (bill.customerId && !bill.orderId) {
        await notify({
          recipientId: bill.customerId,
          kind: 'bill_issued',
          title: `New bill · ${bill.businessName}`,
          body: `${bill.issuedByName} billed you ${formatMoney(bill.total)}.`,
          businessId: bill.businessId,
          billId: bill.id,
        });
      }
      return bill;
    },

    async getById(id: string): Promise<Bill | null> {
      const { data, error } = await sb().from('bills').select('data').eq('id', id).maybeSingle();
      if (error) throw error;
      return data ? (data.data as Bill) : null;
    },

    async listForBusiness(businessId: string): Promise<Bill[]> {
      const { data, error } = await sb().from('bills').select('data').eq('business_id', businessId);
      if (error) throw error;
      return (data ?? []).map((r) => r.data as Bill).sort(byNewest((b) => b.createdAt));
    },

    async listForCustomer(customerId: string, businessId?: string): Promise<Bill[]> {
      // Synthetic ids ('guest', 'walkin:…') aren't uuids — a guest has no bills
      // of their own, and querying the uuid column with one errors (22P02).
      if (!isUuid(customerId)) return [];
      let q = sb().from('bills').select('data').eq('customer_id', customerId);
      if (businessId) q = q.eq('business_id', businessId);
      const { data, error } = await q;
      if (error) throw error;
      return (data ?? []).map((r) => r.data as Bill).sort(byNewest((b) => b.createdAt));
    },

    async sendToChat(billId: string, sentByName: string): Promise<void> {
      const bill = await this.getById(billId);
      if (!bill) throw new Error(`Bill ${billId} not found`);
      if (!bill.customerId) {
        throw new Error('This bill has no linked customer account to chat with.');
      }
      const message = {
        id: uuid(),
        threadKey: threadKeyFor(bill.businessId, bill.customerId),
        authorType: 'business' as const,
        authorName: sentByName,
        body: `Here’s your bill — total ${formatMoney(bill.total)}.`,
        billId: bill.id,
        createdAt: nowIso(),
      };
      const { error } = await sb().from('chat_messages').insert({
        id: message.id,
        business_id: bill.businessId,
        participant_id: bill.customerId,
        data: message,
      });
      if (error) throw error;
      await notify({
        recipientId: bill.customerId,
        kind: 'chat_reply',
        title: `${sentByName} from ${bill.businessName}`,
        body: `🧾 Sent you a bill — ${formatMoney(bill.total)}.`,
        businessId: bill.businessId,
      });
    },

    async setPaymentStatus(billId: string, status: PaymentStatus, byName: string): Promise<Bill> {
      const bill = await this.getById(billId);
      if (!bill) throw new Error(`Bill ${billId} not found`);
      const next: Bill = {
        ...bill,
        paymentStatus: status,
        paidByName: status === 'paid' ? byName : undefined,
        paidAt: status === 'paid' ? nowIso() : undefined,
      };
      const { error } = await sb().from('bills').update({ data: next }).eq('id', billId);
      if (error) throw error;

      if (bill.customerId && status === 'paid') {
        await notify({
          recipientId: bill.customerId,
          kind: 'bill_issued',
          title: `Payment received · ${bill.businessName}`,
          body: `${byName} marked your ${formatMoney(bill.total)} bill as paid.`,
          businessId: bill.businessId,
          billId: bill.id,
        });
      }
      return next;
    },
  };
}

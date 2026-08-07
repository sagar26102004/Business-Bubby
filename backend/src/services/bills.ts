/** Bills — ports MockBillRepository. */
import type { Bill, PaymentStatus } from '@/domain/types';
import type { NewBillInput } from '@/domain/contracts';
import { prisma } from '@/db';
import { newUuid } from '@/lib/ids';
import { asData, isUuid, jsonEquals, rowsData, toJson } from '@/lib/data';
import { formatMoney } from '@/lib/money';
import { notFound } from '@/http/errors';
import { issueBill } from './billing';
import { notify } from './notify';
import { threadKeyFor } from './chat';

async function findBill(id: string): Promise<{ bill: Bill } | null> {
  const row = await prisma.bill.findUnique({ where: { id } });
  return row ? { bill: asData<Bill>(row) } : null;
}

async function saveBill(bill: Bill): Promise<void> {
  await prisma.bill.update({ where: { id: bill.id }, data: { data: toJson(bill) } });
}

export const billService = {
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
    const found = await findBill(id);
    return found?.bill ?? null;
  },

  async listForBusiness(businessId: string): Promise<Bill[]> {
    const rows = await prisma.bill.findMany({
      where: { businessId },
      orderBy: { createdAt: 'desc' },
    });
    return rowsData<Bill>(rows);
  },

  async listForCustomer(customerId: string, businessId?: string): Promise<Bill[]> {
    // A logged-out viewer arrives as the literal 'guest' — never a real account.
    if (!isUuid(customerId)) return [];
    const rows = await prisma.bill.findMany({
      where: {
        AND: [
          { data: jsonEquals('customerId', customerId) },
          ...(businessId ? [{ businessId }] : []),
        ],
      },
      orderBy: { createdAt: 'desc' },
    });
    return rowsData<Bill>(rows);
  },

  async sendToChat(billId: string, sentByName: string): Promise<void> {
    const found = await findBill(billId);
    if (!found) throw notFound(`Bill ${billId} not found`);
    const bill = found.bill;
    if (!bill.customerId) {
      throw new Error('This bill has no linked customer account to chat with.');
    }
    const messageId = newUuid();
    await prisma.chatMessage.create({
      data: {
        id: messageId,
        businessId: bill.businessId,
        participantId: bill.customerId,
        data: toJson({
          id: messageId,
          threadKey: threadKeyFor(bill.businessId, bill.customerId),
          authorType: 'business',
          authorName: sentByName,
          body: `Here’s your bill — total ${formatMoney(bill.total)}.`,
          billId: bill.id,
          createdAt: new Date().toISOString(),
        }),
      },
    });
    await notify({
      recipientId: bill.customerId,
      kind: 'chat_reply',
      title: `${sentByName} from ${bill.businessName}`,
      body: `🧾 Sent you a bill — ${formatMoney(bill.total)}.`,
      businessId: bill.businessId,
    });
  },

  async setPaymentStatus(billId: string, status: PaymentStatus, byName: string): Promise<Bill> {
    const found = await findBill(billId);
    if (!found) throw notFound(`Bill ${billId} not found`);
    const bill = found.bill;
    bill.paymentStatus = status;
    bill.paidByName = status === 'paid' ? byName : undefined;
    bill.paidAt = status === 'paid' ? new Date().toISOString() : undefined;
    await saveBill(bill);

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
    return bill;
  },
};

/** Shared bill issuance — the backend equivalent of the mock's `issueBill`. */
import type { Bill, BillLine, Business } from '@/domain/types';
import type { NewBillInput } from '@/domain/contracts';
import { prisma } from '@/db';
import { newUuid } from '@/lib/ids';
import { asData, toJson, uuidOrNull } from '@/lib/data';
import { parsePrice } from '@/lib/money';

/** Compute line amounts + total, store the bill row, and return it. */
export async function issueBill(input: NewBillInput): Promise<Bill> {
  const lines: BillLine[] = input.lines.map((l) => {
    const unit = parsePrice(l.price);
    return { ...l, amount: unit === undefined ? undefined : unit * l.quantity };
  });
  const total = lines.reduce((sum, l) => sum + (l.amount ?? 0), 0);
  const bizRow = await prisma.business.findUnique({ where: { id: input.businessId } });
  const businessName = bizRow ? asData<Business>(bizRow).name : 'Business';

  const bill: Bill = {
    id: newUuid(),
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
    createdAt: new Date().toISOString(),
  };
  await prisma.bill.create({
    data: {
      id: bill.id,
      businessId: bill.businessId,
      customerId: uuidOrNull(bill.customerId),
      data: toJson(bill),
    },
  });
  return bill;
}

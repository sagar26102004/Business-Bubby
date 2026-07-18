/**
 * Turn a bill into clean, shareable plain text — what goes out through the
 * system share sheet (WhatsApp, email, SMS…) or the clipboard. A real backend
 * can render a proper PDF later; the structure here mirrors what that PDF
 * would say.
 */
import type { Bill } from '@/domain/types';
import { formatMoney } from '@/lib/money';

/** Short human reference, e.g. "Bill #K3F9" from "bill_k3f9_12". */
export function billRef(bill: Bill): string {
  const tail = bill.id.split('_').pop() ?? bill.id;
  return `#${tail.slice(-4).toUpperCase()}`;
}

export function billToText(bill: Bill): string {
  const date = new Date(bill.createdAt).toLocaleDateString();
  const lines = bill.lines.map((l) => {
    const qty = l.quantity > 1 ? ` ×${l.quantity}` : '';
    const amount = l.amount !== undefined ? formatMoney(l.amount) : (l.price ?? 'TBC');
    return `• ${l.name}${qty} — ${amount}`;
  });
  const hasUnpriced = bill.lines.some((l) => l.amount === undefined);
  return [
    `🧾 ${bill.businessName} — Bill ${billRef(bill)}`,
    `To: ${bill.customerName}`,
    `Date: ${date}`,
    '',
    ...lines,
    '',
    `TOTAL: ${formatMoney(bill.total)}${hasUnpriced ? ' (some items to be priced)' : ''}`,
    ...(bill.note ? ['', `Note: ${bill.note}`] : []),
    '',
    `Issued by ${bill.issuedByName} via Localo`,
  ].join('\n');
}

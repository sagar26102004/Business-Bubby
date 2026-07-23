/** Price helpers — ported from ../../../src/lib/money.ts. */

export function parsePrice(price?: string): number | undefined {
  if (!price) return undefined;
  const match = price.replace(/,/g, '').match(/(\d+(?:\.\d+)?)/);
  return match ? parseFloat(match[1]) : undefined;
}

export function formatMoney(amount: number): string {
  const digits = Number.isInteger(amount) ? 0 : 2;
  return `₹${amount.toLocaleString('en-IN', {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  })}`;
}

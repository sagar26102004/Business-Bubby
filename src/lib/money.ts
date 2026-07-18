/**
 * Price helpers. Listing prices are free-text labels ("$85", "from $600",
 * "$4.50") — these helpers pull a number out when possible so orders and
 * bills can show line amounts and totals, and format numbers back to money.
 */

/** Extract the first numeric amount from a price label, if any. */
export function parsePrice(price?: string): number | undefined {
  if (!price) return undefined;
  const match = price.replace(/,/g, '').match(/(\d+(?:\.\d+)?)/);
  return match ? parseFloat(match[1]) : undefined;
}

/**
 * Format a numeric amount as money, dropping ".00" on whole amounts. Grouped
 * the Indian way (₹1,26,500 — lakhs, not thousands) so prices the app writes
 * read like the ones sellers type.
 */
export function formatMoney(amount: number): string {
  const digits = Number.isInteger(amount) ? 0 : 2;
  return `₹${amount.toLocaleString('en-IN', {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  })}`;
}

/**
 * Restrict live text input to a plain amount: digits plus at most one decimal
 * point. Use in onChangeText so price boxes can't take letters.
 */
export function sanitizePriceInput(text: string): string {
  const cleaned = text.replace(/[^0-9.]/g, '');
  const dot = cleaned.indexOf('.');
  if (dot === -1) return cleaned;
  return cleaned.slice(0, dot + 1) + cleaned.slice(dot + 1).replace(/\./g, '');
}

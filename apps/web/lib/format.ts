/** Format a monetary amount in the given currency (defaults to USD). */
export function formatMoney(amount: number, currency = "USD"): string {
  try {
    return new Intl.NumberFormat("en-US", {
      style: "currency",
      currency,
      maximumFractionDigits: 2,
    }).format(amount);
  } catch {
    return `${amount.toFixed(2)} ${currency}`;
  }
}

/**
 * Sum a list of {price, currency} into per-currency totals, then render as a
 * single string, e.g. "$120.50 · €8.00". Returns "—" when there's nothing.
 */
export function formatTotals(
  items: { price?: number; currency?: string }[],
): string {
  const totals = new Map<string, number>();
  for (const it of items) {
    if (typeof it.price === "number" && it.price > 0) {
      const cur = it.currency || "USD";
      totals.set(cur, (totals.get(cur) ?? 0) + it.price);
    }
  }
  if (totals.size === 0) return "—";
  return [...totals.entries()].map(([cur, amt]) => formatMoney(amt, cur)).join(" · ");
}

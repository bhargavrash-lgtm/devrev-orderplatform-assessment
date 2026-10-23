import { formatNumber } from "../../lib/format";

/** Stock wording and colour for a product card or drawer. */
export function stockLabel(stock: number): { text: string; tone: string } {
  if (stock <= 0) return { text: "Out of stock", tone: "text-red-fg" };
  if (stock < 50) return { text: `Only ${formatNumber(stock)} left`, tone: "text-amber-fg" };
  return { text: `${formatNumber(stock)} in stock`, tone: "text-ink-subtle" };
}

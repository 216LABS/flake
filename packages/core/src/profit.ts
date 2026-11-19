/**
 * Profit per lot (issue 167): what a lot earned less what it cost, for a storm, a season or any period.
 *
 * Cost rules, also shown on the Profit page:
 * - Revenue: billed lines for the lot (approved or later; void and drafts in review left out), plus seasonal
 *   installments billed on its contract. Unpaid bills still count; "Collected only" counts paid ones alone.
 * - Labor: each employee visit's minutes on site times their regular pay rate (storm rate when set). Drive time
 *   between lots is shared across the lots of that run by their minutes on site.
 * - Subs: what Sub pay pays for that visit.
 * - Salt: tons spread times the average cost per ton of the salt on hand (from deliveries with a cost), or the
 *   company's default cost per ton.
 * - Equipment: fuel and maintenance logged against a storm, shared across the lots that storm's trucks served, by
 *   minutes on site.
 * A cost with no number behind it (no pay rate, no salt cost) is left at zero and named, never guessed.
 */

export interface LotCosts {
  siteId: string;
  revenue_cents: number;
  labor_cents: number;
  sub_cents: number;
  salt_cents: number;
  equipment_cents: number;
}

export interface LotProfit extends LotCosts {
  cost_cents: number;
  profit_cents: number;
  /** Profit over revenue, as a percent with one decimal; null with no revenue. */
  margin: number | null;
  losing: boolean;
}

export function profitOf(c: LotCosts, opts: { minMarginPct?: number | null } = {}): LotProfit {
  const cost = c.labor_cents + c.sub_cents + c.salt_cents + c.equipment_cents;
  const profit = c.revenue_cents - cost;
  const margin = c.revenue_cents > 0 ? Math.round((profit / c.revenue_cents) * 1000) / 10 : null;
  const losing = profit < 0 || (opts.minMarginPct != null && margin != null && margin < opts.minMarginPct);
  return { ...c, cost_cents: cost, profit_cents: profit, margin, losing };
}

/** Splits an amount across keys by weight, in whole cents that add back to the amount exactly. */
export function share(totalCents: number, weights: Map<string, number>): Map<string, number> {
  const out = new Map<string, number>();
  const sum = [...weights.values()].reduce((a, b) => a + b, 0);
  if (!weights.size) return out;
  if (sum <= 0) {
    const each = Math.floor(totalCents / weights.size);
    let left = totalCents - each * weights.size;
    for (const k of weights.keys()) out.set(k, each + (left-- > 0 ? 1 : 0));
    return out;
  }
  let given = 0;
  const parts = [...weights].map(([k, w]) => {
    const exact = (totalCents * w) / sum;
    const floor = Math.floor(exact);
    given += floor;
    return { k, floor, frac: exact - floor };
  });
  let left = totalCents - given;
  for (const p of [...parts].sort((a, b) => b.frac - a.frac || a.k.localeCompare(b.k))) {
    out.set(p.k, p.floor + (left-- > 0 ? 1 : 0));
  }
  return out;
}

/** Average cost per ton of salt from deliveries that carry a cost; null when none do. */
export function averageCostPerTon(deliveries: { tons: number; cost_cents: number | null }[]): number | null {
  const priced = deliveries.filter((d) => d.cost_cents != null && d.tons > 0);
  const tons = priced.reduce((a, d) => a + d.tons, 0);
  return tons > 0 ? Math.round(priced.reduce((a, d) => a + d.cost_cents!, 0) / tons) : null;
}

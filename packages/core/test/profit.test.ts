import { describe, expect, it } from 'vitest';
import { averageCostPerTon, profitOf, share } from '../src/profit';

describe('issue 167: profit per lot', () => {
  it('profit, margin and the money-losing flag', () => {
    const p = profitOf({ siteId: 'a', revenue_cents: 10000, labor_cents: 6000, sub_cents: 0, salt_cents: 3000, equipment_cents: 2000 });
    expect(p).toMatchObject({ cost_cents: 11000, profit_cents: -1000, margin: -10, losing: true });
    expect(profitOf({ siteId: 'b', revenue_cents: 10000, labor_cents: 9000, sub_cents: 0, salt_cents: 0, equipment_cents: 0 }, { minMarginPct: 15 }).losing).toBe(true);
    expect(profitOf({ siteId: 'c', revenue_cents: 0, labor_cents: 0, sub_cents: 0, salt_cents: 0, equipment_cents: 0 }).margin).toBeNull();
  });
  it('shares a cost in whole cents that add back exactly', () => {
    const s = share(1000, new Map([['a', 1], ['b', 1], ['c', 1]]));
    expect([...s.values()].reduce((a, b) => a + b, 0)).toBe(1000);
    expect(s.get('a')).toBe(334);
    expect(share(500, new Map([['a', 0], ['b', 0]]))).toEqual(new Map([['a', 250], ['b', 250]]));
    expect(share(100, new Map([['a', 3], ['b', 1]]))).toEqual(new Map([['a', 75], ['b', 25]]));
  });
  it('average cost per ton from priced deliveries only', () => {
    expect(averageCostPerTon([{ tons: 20, cost_cents: 160000 }, { tons: 10, cost_cents: null }, { tons: 10, cost_cents: 100000 }])).toBe(8667);
    expect(averageCostPerTon([{ tons: 5, cost_cents: null }])).toBeNull();
  });
});

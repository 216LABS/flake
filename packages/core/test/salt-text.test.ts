import { describe, expect, it } from 'vitest';
import { saltAmountText } from '../src/pricing';

describe('salt on a service record reads as words, not a unit code', () => {
  it('names each unit, singular and plural', () => {
    expect(saltAmountText(3, 'bag50lb')).toBe('3 bags (50 lb)');
    expect(saltAmountText(1, 'bag50lb')).toBe('1 bag (50 lb)');
    expect(saltAmountText(1.5, 'ton')).toBe('1.5 tons');
    expect(saltAmountText(1, 'ton')).toBe('1 ton');
    expect(saltAmountText(200, 'lb')).toBe('200 lb');
    expect(saltAmountText(2, 'application')).toBe('2 applications');
    expect(saltAmountText(1, 'application')).toBe('1 application');
    expect(saltAmountText(4, 'scoop')).toBe('4 scoop');
  });
});

describe('a per-inch invoice line names the depth plainly', () => {
  it('reads "Plow for 3" of snow", not the pricing code', async () => {
    const { priceVisit } = await import('../src/pricing');
    const svc = { service: 'plow', trigger_in: 2, pricing: { type: 'per_inch_tier', tiers: [{ up_to_in: 4, amount_cents: 6000 }, { up_to_in: null, amount_cents: 9000 }] } } as never;
    const v = { id: 'v1', site_id: 's1', services: ['plow'], arrived_at: '2025-12-12T10:00:00Z', departed_at: '2025-12-12T10:20:00Z', depth_in: 3, salt: null, is_replow: false } as never;
    expect(priceVisit(svc, v, 3)[0]!.description).toBe('Plow for 3" of snow');
    expect(priceVisit(svc, v, null)[0]!.description).toBe('Plow by snow depth, depth not recorded');
  });
});

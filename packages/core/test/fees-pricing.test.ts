import { describe, expect, it } from 'vitest';
import { applicationFeeCents, estimateStripeFeeCents, feeRate, inFreeSeason, proFeaturesEnabled } from '../src/fees';
import { billableQuarterHours, priceSalt, priceSiteForStorm, priceVisit, seasonalInstallments, stormDepthIn, tierAmountCents, type ContractService, type PricedVisit } from '../src/pricing';

describe('application fee', () => {
  it('rounds and clamps to $0.50 to $25', () => {
    expect(applicationFeeCents(10000, 0.01)).toBe(100);
    expect(applicationFeeCents(1000, 0.01)).toBe(50);
    expect(applicationFeeCents(10_000_000, 0.01)).toBe(2500);
    expect(applicationFeeCents(12345, 0.005)).toBe(62);
  });
  it('never exceeds the amount and is zero on zero', () => {
    expect(applicationFeeCents(30, 0.01)).toBe(30);
    expect(applicationFeeCents(0, 0.01)).toBe(0);
  });
  it('uses 1% for free, 0.5% for paid Pro, 1% for Pro inside the free season', () => {
    expect(feeRate('free', null, '2027-06-01')).toBe(0.01);
    expect(feeRate('pro', null, '2027-06-01')).toBe(0.005);
    expect(feeRate('pro', '2027-04-30', '2027-04-30')).toBe(0.01);
    expect(feeRate('pro', '2027-04-30', '2027-05-01')).toBe(0.005);
  });
  it('knows the free season and Pro features', () => {
    expect(inFreeSeason(undefined, '2027-01-01')).toBe(false);
    expect(proFeaturesEnabled('free', '2027-04-30', '2027-01-01')).toBe(true);
    expect(proFeaturesEnabled('free', '2027-04-30', '2027-05-01')).toBe(false);
    expect(proFeaturesEnabled('pro', null, '2027-05-01')).toBe(true);
  });
  it('estimates each Stripe method', () => {
    expect(estimateStripeFeeCents(10000, 'card')).toBe(320);
    expect(estimateStripeFeeCents(10000, 'ach')).toBe(80);
    expect(estimateStripeFeeCents(1_000_000, 'ach')).toBe(500);
    expect(estimateStripeFeeCents(10000, 'invoice_ach')).toBe(120);
    expect(estimateStripeFeeCents(10000, 'invoice_card')).toBe(360);
    expect(estimateStripeFeeCents(0, 'card')).toBe(0);
  });
});

const visit = (over: Partial<PricedVisit> = {}): PricedVisit => ({
  id: 'v1', site_id: 's1', services: ['plow'], arrived_at: '2025-12-12T10:00:00Z', departed_at: '2025-12-12T10:20:00Z', depth_in: 3, salt: null, is_replow: false, ...over,
});
const none = { nohrsc24hIn: null, nwsElapsedIn: null };
const tiers = [{ up_to_in: 4, amount_cents: 6000 }, { up_to_in: 8, amount_cents: 9000 }, { up_to_in: null, amount_cents: 12000 }];

describe('pricing helpers', () => {
  it('stormDepthIn takes the max of known values and is null when all are unavailable', () => {
    expect(stormDepthIn([3, null], { nohrsc24hIn: 4.2, nwsElapsedIn: 1 })).toBe(4.2);
    expect(stormDepthIn([null], none)).toBeNull();
  });
  it('tierAmountCents picks the matching tier, open top, and the highest when no open tier exists', () => {
    expect(tierAmountCents(tiers, 3)).toBe(6000);
    expect(tierAmountCents(tiers, 4)).toBe(6000);
    expect(tierAmountCents(tiers, 7)).toBe(9000);
    expect(tierAmountCents(tiers, 30)).toBe(12000);
    expect(tierAmountCents([{ up_to_in: 2, amount_cents: 100 }, { up_to_in: 4, amount_cents: 200 }], 9)).toBe(200);
    expect(tierAmountCents([{ up_to_in: null, amount_cents: 700 }, { up_to_in: 4, amount_cents: 200 }], 9)).toBe(700);
  });
  it('billableQuarterHours rounds up to 15 minutes and handles open and backward visits', () => {
    expect(billableQuarterHours('2025-12-12T10:00:00Z', '2025-12-12T10:16:00Z')).toBe(2);
    expect(billableQuarterHours('2025-12-12T10:00:00Z', '2025-12-12T10:15:00Z')).toBe(1);
    expect(billableQuarterHours('2025-12-12T10:00:00Z', null)).toBe(0);
    expect(billableQuarterHours('2025-12-12T10:00:00Z', '2025-12-12T09:00:00Z')).toBe(0);
  });
  it('seasonal installments always add up to the total', () => {
    const parts = seasonalInstallments(240001, 5);
    expect(parts.reduce((a, b) => a + b)).toBe(240001);
    expect(parts[0]).toBe(48001);
  });
});

describe('priceVisit', () => {
  it('per_push', () => {
    expect(priceVisit({ service: 'plow', pricing: { type: 'per_push', amount_cents: 6500 } }, visit(), 3)[0]!.amount_cents).toBe(6500);
  });
  it('per_event', () => {
    expect(priceVisit({ service: 'plow', pricing: { type: 'per_event', amount_cents: 20000 } }, visit(), 3)[0]!.pricing_type).toBe('per_event');
  });
  it('per_inch_tier with depth', () => {
    expect(priceVisit({ service: 'plow', pricing: { type: 'per_inch_tier', tiers } }, visit(), 5)[0]!.amount_cents).toBe(9000);
  });
  it('per_inch_tier without depth prices zero and asks for depth', () => {
    const [l] = priceVisit({ service: 'plow', pricing: { type: 'per_inch_tier', tiers } }, visit(), null);
    expect(l!.amount_cents).toBe(0);
    expect(l!.needs_depth).toBe(true);
  });
  it('seasonal has no per-visit charge', () => {
    expect(priceVisit({ service: 'plow', pricing: { type: 'seasonal', total_cents: 240000, installments: 5 } }, visit(), 3)).toEqual([]);
  });
  it('hourly rounds up to 15 minutes', () => {
    const [l] = priceVisit({ service: 'plow', pricing: { type: 'hourly', rate_cents: 12000 } }, visit(), 3);
    expect(l!.quantity).toBe(0.5);
    expect(l!.amount_cents).toBe(6000);
  });
  it('no pricing returns nothing', () => {
    expect(priceVisit({ service: 'salt' }, visit(), 3)).toEqual([]);
  });
});

describe('priceSalt', () => {
  const sp = { unit: 'bag50lb' as const, amount_cents: 1800 };
  it('prices only matching units with a positive quantity', () => {
    const lines = priceSalt(sp, visit({ salt: [{ unit: 'bag50lb', qty: 3 }, { unit: 'ton', qty: 1 }, { unit: 'bag50lb', qty: 0 }] }));
    expect(lines).toHaveLength(1);
    expect(lines[0]!.amount_cents).toBe(5400);
  });
  it('falls back to the raw unit label', () => {
    expect(priceSalt({ unit: 'kg' as never, amount_cents: 100 }, visit({ salt: [{ unit: 'kg', qty: 2 }] }))[0]!.description).toContain('kg');
  });
  it('handles missing pricing or salt', () => {
    expect(priceSalt(null, visit({ salt: [{ unit: 'bag50lb', qty: 1 }] }))).toEqual([]);
    expect(priceSalt(sp, visit())).toEqual([]);
  });
});

describe('priceSiteForStorm', () => {
  it('charges per_push for every push', () => {
    const svc: ContractService[] = [{ service: 'plow', pricing: { type: 'per_push', amount_cents: 5000 } }];
    expect(priceSiteForStorm(svc, null, [visit(), visit({ id: 'v2' })], none).reduce((s, l) => s + l.amount_cents, 0)).toBe(10000);
  });
  it('charges per_event once per storm and tracks all source visits', () => {
    const svc: ContractService[] = [{ service: 'plow', pricing: { type: 'per_event', amount_cents: 20000 } }];
    const lines = priceSiteForStorm(svc, null, [visit(), visit({ id: 'v2' })], none);
    expect(lines).toHaveLength(1);
    expect(lines[0]!.source_visit_ids).toEqual(['v1', 'v2']);
  });
  it('charges per_inch_tier once using the max of driver, NOHRSC and NWS', () => {
    const svc: ContractService[] = [{ service: 'plow', pricing: { type: 'per_inch_tier', tiers } }];
    const lines = priceSiteForStorm(svc, null, [visit({ depth_in: 2 }), visit({ id: 'v2', depth_in: 3 })], { nohrsc24hIn: 6, nwsElapsedIn: 1 });
    expect(lines).toHaveLength(1);
    expect(lines[0]!.amount_cents).toBe(9000);
  });
  it('adds salt only when the contract has a salt service, and ignores services the visit lacks', () => {
    const v = visit({ services: ['plow', 'salt'], salt: [{ unit: 'bag50lb', qty: 2 }] });
    const sp = { unit: 'bag50lb' as const, amount_cents: 1800 };
    const withSalt = priceSiteForStorm([{ service: 'plow', pricing: { type: 'per_push', amount_cents: 100 } }, { service: 'salt' }], sp, [v], none);
    expect(withSalt.map((l) => l.amount_cents)).toEqual([100, 3600]);
    expect(priceSiteForStorm([{ service: 'plow', pricing: { type: 'per_push', amount_cents: 100 } }], sp, [v], none)).toHaveLength(1);
    expect(priceSiteForStorm([{ service: 'walks', pricing: { type: 'per_event', amount_cents: 100 } }], sp, [v], none)).toEqual([]);
  });
});

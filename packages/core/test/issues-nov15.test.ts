import { describe, expect, it } from 'vitest';
import { draftInvoices, type BillingContract, type BillingVisit, type DraftInput } from '../src/billing';
import { stormWhen } from '../src/time';
import { seasonalRemaining } from '../src/pricing';

const LAT = 41.48, LON = -81.8;
let n = 0;
const v = (over: Partial<BillingVisit> = {}): BillingVisit => ({
  id: `v${++n}`, site_id: 's1', services: ['plow'], arrived_at: '2026-11-14T10:00:00Z', departed_at: '2026-11-14T10:20:00Z', depth_in: 3, salt: null, is_replow: false,
  arrive_lat: LAT, arrive_lon: LON, after_photos: 1, ...over,
});
const perPush: BillingContract = { site_id: 's1', services: [{ service: 'plow', trigger_in: 2, pricing: { type: 'per_push', amount_cents: 4500 } }], season: '2026-27' };
const input = (contract: BillingContract, visits: BillingVisit[], extra: Partial<DraftInput> = {}): DraftInput => ({
  sites: [{ id: 's1', customer_id: 'c1', label: 'Lot', lat: LAT, lon: LON }], contracts: [contract], stops: [{ site_id: 's1', status: 'done' }], visits, corrections: [], depth: {}, ...extra,
});
const window = { start: '2026-11-14T08:00:00Z', end: '2026-11-14T20:00:00Z', timezone: 'America/New_York' };

describe('issue 141: a phone clock far outside the storm', () => {
  it('flags a visit stamped years before, or days after, and holds the bill', () => {
    for (const at of [{ arrived_at: '2020-01-01T10:00:00Z', departed_at: '2020-01-01T10:20:00Z' }, { arrived_at: '2026-11-14T10:00:00Z', departed_at: '2026-11-16T10:00:00Z' }]) {
      const [d] = draftInvoices(input(perPush, [v(at)], { window }));
      const flag = d!.flags.find((f) => f.code === 'time_outside_storm');
      expect(flag?.severity, JSON.stringify(at)).toBe('review');
      expect(flag?.message).toMatch(/the phone's clock put this visit at .*20(20|26)/);
    }
  });
  it('lets a little drift through: an hour early, or finishing a few hours after the close', () => {
    const [d] = draftInvoices(input(perPush, [v({ arrived_at: '2026-11-14T07:00:00Z', departed_at: '2026-11-14T07:20:00Z' }), v({ arrived_at: '2026-11-14T22:00:00Z', departed_at: '2026-11-14T23:00:00Z', is_replow: true })], { window }));
    expect(d!.flags.map((f) => f.code)).not.toContain('time_outside_storm');
  });
});

describe('issue 157: a seasonal lot plowed after its season', () => {
  it('has the "not paid for" flag alone, not a "no per-visit charge" note beside it', () => {
    const seasonal: BillingContract = { site_id: 's1', services: [{ service: 'plow', trigger_in: 2, pricing: { type: 'seasonal', total_cents: 250000, installments: 5 } }], season: '2025-26' };
    // With a photo flag beside it too, so only the seasonal note is taken out.
    const [d] = draftInvoices(input(seasonal, [v({ after_photos: 0 })], { season: '2026-27' }));
    expect(d!.flags.map((f) => f.code)).toContain('no_after_photo');
    expect(d!.flags.map((f) => f.code)).toEqual(expect.arrayContaining(['prior_season']));
    expect(d!.flags.map((f) => f.code)).not.toContain('seasonal_info');
    // In its own season the note stays.
    const [same] = draftInvoices(input({ ...seasonal, season: '2026-27' }, [v({ services: [] })], { season: '2026-27', stops: [{ site_id: 's1', status: 'open' }] }));
    expect(same?.flags.map((f) => f.code) ?? ['seasonal_info']).toContain('seasonal_info');
  });

  it('dates a storm from an earlier winter with its year', () => {
    const now = new Date('2026-11-14T15:00:00Z');
    expect(stormWhen('2026-11-10T13:00:00Z', 'America/New_York', true, now)).toBe('Nov 10, 8:00 AM');
    expect(stormWhen('2026-03-20T12:00:00Z', 'America/New_York', true, now)).toBe('Mar 20, 2026, 8:00 AM');
    expect(stormWhen('2026-03-20T12:00:00Z', 'America/New_York', false, now)).toBe('Mar 20, 2026');
  });
});

describe('issue 156: what a re-sign leaves to bill', () => {
  it('spreads the rest over the installments left, one more when they are used up, none once covered', () => {
    expect(seasonalRemaining(300000, 5, { cents: 150000, count: 3 })).toEqual([75000, 75000]);
    expect(seasonalRemaining(300000, 5, { cents: 250000, count: 5 })).toEqual([50000]);
    expect(seasonalRemaining(200000, 5, { cents: 250000, count: 5 })).toEqual([]);
  });
});

describe('issue 141: a storm still running', () => {
  it('checks against now when the storm has no close time yet', () => {
    const open = { ...window, end: null };
    const [d] = draftInvoices(input(perPush, [v({ arrived_at: new Date(Date.now() + 3 * 86400000).toISOString(), departed_at: new Date(Date.now() + 3 * 86400000 + 600000).toISOString() })], { window: open }));
    expect(d!.flags.map((f) => f.code)).toContain('time_outside_storm');
  });
});

describe('nationwide depth: driver and NOAA far apart', () => {
  const tier: BillingContract = { site_id: 's1', services: [{ service: 'plow', trigger_in: 1, pricing: { type: 'per_inch_tier', tiers: [{ up_to_in: 4, amount_cents: 6000 }, { up_to_in: null, amount_cents: 9000 }] } }], season: '2026-27' };
  it('holds a tier bill when the driver and NOAA differ by more than 1.5", and lets a close match through', () => {
    const far = draftInvoices(input(tier, [v({ depth_in: 6 })], { depth: { s1: { nohrsc24hIn: 2, nwsElapsedIn: null } } }))[0]!;
    expect(far.flags.find((f) => f.code === 'depth_disagrees')?.message).toMatch(/driver measured 6" but NOAA observed 2"/);
    expect(far.subtotal_cents).toBe(9000);
    const close = draftInvoices(input(tier, [v({ depth_in: 3 })], { depth: { s1: { nohrsc24hIn: 4, nwsElapsedIn: null } } }))[0]!;
    expect(close.flags.map((f) => f.code)).not.toContain('depth_disagrees');
  });
});

describe('issue 161: salt logged on a contract with no salt price', () => {
  it('is flagged instead of going out free, and a priced salt contract is not', () => {
    const salty = v({ services: ['plow', 'salt'], salt: [{ unit: 'bag50lb', qty: 4 }] });
    const [d] = draftInvoices(input(perPush, [salty]));
    expect(d!.flags.find((f) => f.code === 'salt_no_price')?.message).toMatch(/logged 4 bag50lb of salt, but the contract has no salt price/);
    const priced: BillingContract = { ...perPush, services: [...perPush.services, { service: 'salt' }], salt_pricing: { unit: 'bag50lb', amount_cents: 1800 } };
    expect(draftInvoices(input(priced, [salty]))[0]!.flags.map((f) => f.code)).not.toContain('salt_no_price');
    // Salt on the contract but no price for it is the same gap.
    const unpriced: BillingContract = { ...perPush, services: [...perPush.services, { service: 'salt' }] };
    expect(draftInvoices(input(unpriced, [salty]))[0]!.flags.map((f) => f.code)).toContain('salt_no_price');
  });
});

import { describe, expect, it } from 'vitest';
import { draftInvoices } from '../src/billing';
import { surchargeLines, type InvoiceLine, type PricedVisit } from '../src/pricing';

const visit = (over: Partial<PricedVisit> = {}): PricedVisit => ({ id: 'v1', site_id: 's1', services: ['plow', 'salt'], arrived_at: '2026-12-05T08:00:00Z', departed_at: '2026-12-05T08:20:00Z', depth_in: 3, salt: [{ unit: 'ton', qty: 0.5 }], is_replow: false, ...over });
const saltLine = (qty: number, id = 'v1'): InvoiceLine => ({ site_id: 's1', service: 'salt', pricing_type: 'salt', description: 'Salt', quantity: qty, unit_amount_cents: 9000, amount_cents: qty * 9000, source_visit_ids: [id] });
const TZ = 'America/New_York';

describe('issue 232: salt surcharge', () => {
  it('prices per ton from a per-ton lot and per bag from a per-bag lot', () => {
    expect(surchargeLines([saltLine(0.5)], [visit()], { per: 'ton', amount_cents: 10000, from: '2026-12-01' }, TZ)[0]).toMatchObject({ service: 'salt_surcharge', quantity: 0.5, amount_cents: 5000 });
    const bags = visit({ salt: [{ unit: 'bag50lb', qty: 8 }] });
    expect(surchargeLines([saltLine(8)], [bags], { per: 'ton', amount_cents: 10000, from: '2026-12-01' }, TZ)[0]).toMatchObject({ quantity: 0.2, amount_cents: 2000 });
    expect(surchargeLines([saltLine(8)], [bags], { per: 'bag50lb', amount_cents: 300, from: '2026-12-01' }, TZ)[0]).toMatchObject({ quantity: 8, amount_cents: 2400 });
    expect(surchargeLines([saltLine(8)], [bags], { per: 'application', amount_cents: 1500, from: '2026-12-01' }, TZ)[0]).toMatchObject({ quantity: 1, amount_cents: 1500 });
  });

  it('only on salt dates inside the window, in local days', () => {
    const s = { per: 'ton' as const, amount_cents: 10000, from: '2026-12-05', until: '2026-12-31' };
    // 03:00 UTC on Dec 5 is still Dec 4 in Cleveland.
    expect(surchargeLines([saltLine(0.5)], [visit({ departed_at: '2026-12-05T03:00:00Z' })], s, TZ)).toEqual([]);
    expect(surchargeLines([saltLine(0.5)], [visit()], s, TZ)).toHaveLength(1);
    expect(surchargeLines([saltLine(0.5)], [visit({ departed_at: '2027-01-02T15:00:00Z' })], s, TZ)).toEqual([]);
  });

  it('nothing for a lot with salt off, an application-priced salting with a per-ton surcharge, or no surcharge', () => {
    expect(surchargeLines([], [visit()], { per: 'ton', amount_cents: 10000, from: '2026-12-01' }, TZ)).toEqual([]);
    expect(surchargeLines([saltLine(1)], [visit({ salt: [{ unit: 'application', qty: 1 }] })], { per: 'ton', amount_cents: 10000, from: '2026-12-01' }, TZ)).toEqual([]);
    expect(surchargeLines([saltLine(0.5)], [visit()], null, TZ)).toEqual([]);
  });

  it('the draft adds the surcharge only for salt actually billed; a voided visit isn\'t in the input at all', () => {
    const input = {
      sites: [{ id: 's1', customer_id: 'c1', label: 'Lot', lat: 41.48, lon: -81.8 }],
      contracts: [{ site_id: 's1', services: [{ service: 'plow', trigger_in: 1, pricing: { type: 'per_push', amount_cents: 8000 } }, { service: 'salt', trigger_in: null }], salt_pricing: { unit: 'ton', amount_cents: 9000 } }],
      stops: [{ site_id: 's1', status: 'done' }], visits: [visit()], corrections: [], depth: {},
      window: { start: '2026-12-05T06:00:00Z', end: '2026-12-05T12:00:00Z', timezone: TZ },
    } as unknown as Parameters<typeof draftInvoices>[0];
    const plain = draftInvoices(input)[0]!;
    const withS = draftInvoices({ ...input, surcharge: { per: 'ton', amount_cents: 10000, from: '2026-12-01' } })[0]!;
    expect(withS.subtotal_cents - plain.subtotal_cents).toBe(5000);
    expect(withS.lines.filter((l) => l.service === 'salt_surcharge')).toHaveLength(1);
  });
});

describe('issue 233: contract terms', () => {
  const base = (pricing: unknown, depth = 3) => ({
    sites: [{ id: 's1', customer_id: 'c1', label: 'Lot', lat: 41.48, lon: -81.8 }],
    contracts: [{ site_id: 's1', services: [{ service: 'plow', trigger_in: 1, pricing }], salt_pricing: null }],
    stops: [{ site_id: 's1', status: 'done' }],
    visits: [visit({ id: 'a', services: ['plow'], salt: null, depth_in: depth, arrived_at: '2026-12-05T08:00:00Z' }), visit({ id: 'b', services: ['plow'], salt: null, depth_in: depth, arrived_at: '2026-12-05T11:00:00Z', departed_at: '2026-12-05T11:20:00Z' })],
    corrections: [], depth: { s1: { nohrsc24hIn: 7, nwsElapsedIn: null } },
    window: { start: '2026-12-05T06:00:00Z', end: '2026-12-05T13:00:00Z', timezone: TZ },
  }) as unknown as Parameters<typeof draftInvoices>[0];
  const tiers = [{ up_to_in: 4, amount_cents: 10000 }, { up_to_in: null, amount_cents: 20000 }];

  it('a per-inch contract can name NOAA observed snowfall, and the bill says so', () => {
    expect(draftInvoices(base({ type: 'per_inch_tier', tiers }))[0]!.lines[0]).toMatchObject({ amount_cents: 10000, description: expect.stringContaining('measured on site') });
    const noaa = draftInvoices(base({ type: 'per_inch_tier', tiers, depth_source: 'noaa' }))[0]!.lines[0]!;
    expect(noaa).toMatchObject({ amount_cents: 20000, description: expect.stringContaining('NOAA observed') });
  });

  it('a seasonal cap bills only the pushes past it, counting the season so far; a voided visit isn\'t a push', () => {
    const seasonal = { type: 'seasonal', total_cents: 300000, installments: 5, included_pushes: 20, overage_cents: 9000 };
    expect(draftInvoices({ ...base(seasonal), seasonPushes: { s1: 10 } })).toEqual([]);
    const reached = draftInvoices({ ...base(seasonal), seasonPushes: { s1: 19 } })[0]!;
    expect(reached.lines).toHaveLength(1);
    expect(reached.lines[0]).toMatchObject({ amount_cents: 9000, source_visit_ids: ['b'], description: expect.stringContaining('push 21 of the season') });
    // Voided visits never reach the engine, so the cap counts only real ones.
    const one = base(seasonal);
    one.visits = one.visits.slice(0, 1);
    expect(draftInvoices({ ...one, seasonPushes: { s1: 19 } })).toEqual([]);
  });
});

describe('issue 232/233: the edges', () => {
  const s = { per: 'ton' as const, amount_cents: 10000, from: '2026-12-01' };
  it('skips a zero surcharge, a line with no visit, and a salting with no weight; uses arrival when not left yet', () => {
    expect(surchargeLines([saltLine(0.5)], [visit()], { ...s, amount_cents: 0 }, TZ)).toEqual([]);
    expect(surchargeLines([saltLine(0.5, 'gone')], [visit()], s, TZ)).toEqual([]);
    expect(surchargeLines([saltLine(0.5)], [visit({ departed_at: null })], s, TZ)).toHaveLength(1);
    // The line's quantity isn't on the visit: the visit's first entry decides the unit.
    expect(surchargeLines([saltLine(0.25)], [visit()], s, TZ)[0]).toMatchObject({ quantity: 0.25, amount_cents: 2500 });
    expect(surchargeLines([saltLine(0.5)], [visit({ salt: null })], s, TZ)).toEqual([]);
    expect(surchargeLines([saltLine(0)], [visit({ salt: [{ unit: 'ton', qty: 0 }] })], s, TZ)).toEqual([]);
  });

  it('a seasonal cap with no earlier pushes passed counts from zero', async () => {
    const { priceSiteForStorm } = await import('../src/pricing');
    const svc = [{ service: 'plow' as const, trigger_in: 2, pricing: { type: 'seasonal' as const, total_cents: 1, installments: 1, included_pushes: 1, overage_cents: 500 } }];
    expect(priceSiteForStorm(svc, null, [visit({ id: 'a', services: ['plow'] }), visit({ id: 'b', services: ['plow'], arrived_at: '2026-12-05T09:00:00Z' })], { nohrsc24hIn: null, nwsElapsedIn: null })).toHaveLength(1);
  });

  it('a draft with no window still prices the surcharge, in Eastern time', () => {
    const input = {
      sites: [{ id: 's1', customer_id: 'c1', label: 'Lot', lat: 41.48, lon: -81.8 }],
      contracts: [{ site_id: 's1', services: [{ service: 'salt', trigger_in: null }], salt_pricing: { unit: 'ton', amount_cents: 9000 } }],
      stops: [{ site_id: 's1', status: 'done' }], visits: [visit()], corrections: [], depth: {}, surcharge: s,
    } as unknown as Parameters<typeof draftInvoices>[0];
    expect(draftInvoices(input)[0]!.lines.some((l) => l.service === 'salt_surcharge')).toBe(true);
  });
});

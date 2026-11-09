import { describe, expect, it } from 'vitest';
import { applyCorrections, draftInvoices, flagKey, isDraftClean, type BillingContract, type BillingSite, type BillingVisit, type DraftInput } from '../src/billing';

const LAT = 41.48, LON = -81.8;
const site = (id: string, customer_id: string): BillingSite => ({ id, customer_id, label: id, lat: LAT, lon: LON });
let n = 0;
const v = (site_id: string, over: Partial<BillingVisit> = {}): BillingVisit => ({
  id: `v${++n}`, site_id, services: ['plow'], arrived_at: '2025-12-12T10:00:00Z', departed_at: '2025-12-12T10:20:00Z', depth_in: 3, salt: null, is_replow: false,
  arrive_lat: LAT, arrive_lon: LON, after_photos: 1, ...over,
});
const perPush: BillingContract = { site_id: 's1', services: [{ service: 'plow', pricing: { type: 'per_push', amount_cents: 6500 } }] };
const input = (over: Partial<DraftInput>): DraftInput => ({ sites: [site('s1', 'c1')], contracts: [perPush], stops: [{ site_id: 's1', status: 'done' }], visits: [v('s1')], corrections: [], depth: {}, ...over });
const flagsOf = (i: DraftInput) => draftInvoices(i).flatMap((d) => d.flags.map((f) => f.code));

describe('draftInvoices flags', () => {
  it('a clean visit has no flags', () => {
    const [d] = draftInvoices(input({}));
    expect(d!.subtotal_cents).toBe(6500);
    expect(d!.flags).toEqual([]);
    expect(isDraftClean(d!.flags)).toBe(true);
  });
  it('missing_visit when a stop has no done visit, and not when it was skipped', () => {
    expect(flagsOf(input({ visits: [] }))).toEqual(['missing_visit']);
    expect(flagsOf(input({ visits: [], stops: [{ site_id: 's1', status: 'skipped' }] }))).toEqual([]);
  });
  it('an open visit does not count as done', () => {
    expect(flagsOf(input({ visits: [v('s1', { departed_at: null })] }))).toEqual(['missing_visit']);
  });
  it('duplicate within 60 minutes, not when re-plow or further apart', () => {
    const a = v('s1');
    expect(flagsOf(input({ visits: [v('s1', { arrived_at: '2025-12-12T10:30:00Z', departed_at: '2025-12-12T10:50:00Z' }), a] }))).toEqual(['duplicate']);
    expect(flagsOf(input({ visits: [a, v('s1', { arrived_at: '2025-12-12T10:30:00Z', departed_at: '2025-12-12T10:50:00Z', is_replow: true })] }))).toEqual([]);
    expect(flagsOf(input({ visits: [a, v('s1', { arrived_at: '2025-12-12T11:00:00Z', departed_at: '2025-12-12T11:20:00Z' })] }))).toEqual([]);
  });
  it('no_gps_match when far away or unavailable, using the polygon if drawn', () => {
    expect(flagsOf(input({ visits: [v('s1', { arrive_lat: 41.5 })] }))).toEqual(['no_gps_match']);
    expect(flagsOf(input({ visits: [v('s1', { arrive_lat: null })] }))).toEqual(['no_gps_match']);
    const polygons = { type: 'Polygon' as const, coordinates: [[[LON, LAT], [LON + 0.001, LAT], [LON + 0.001, LAT + 0.001], [LON, LAT]]] };
    expect(flagsOf(input({ sites: [{ ...site('s1', 'c1'), polygons }], visits: [v('s1', { arrive_lat: LAT + 0.0005, arrive_lon: LON + 0.0007 })] }))).toEqual([]);
  });
  it('odd_duration: Done before Arrive anywhere, and over 4 h only on an hourly lot', () => {
    const at = (h: number) => new Date(Date.UTC(2026, 0, 20, h)).toISOString();
    const hourly: BillingContract = { site_id: 's1', services: [{ service: 'plow', pricing: { type: 'hourly', rate_cents: 12000 } }] };
    expect(flagsOf(input({ visits: [v('s1', { arrived_at: at(5), departed_at: at(4) })] }))).toEqual(['odd_duration']);
    expect(flagsOf(input({ contracts: [hourly], visits: [v('s1', { arrived_at: at(3), departed_at: at(12) })] }))).toEqual(['odd_duration']);
    expect(draftInvoices(input({ contracts: [hourly], visits: [v('s1', { arrived_at: at(3), departed_at: at(12) })] }))[0]!.flags[0]!.message).toContain('9 h on site');
    expect(flagsOf(input({ contracts: [hourly], visits: [v('s1', { arrived_at: at(3), departed_at: at(5) })] }))).toEqual([]);
    expect(flagsOf(input({ visits: [v('s1', { arrived_at: at(3), departed_at: at(12) })] }))).toEqual([]);
    expect(flagsOf(input({ visits: [v('s1', { arrived_at: at(3), departed_at: null })] }))).not.toContain('odd_duration');
  });
  it('no_after_photo', () => {
    expect(flagsOf(input({ visits: [v('s1', { after_photos: 0 })] }))).toEqual(['no_after_photo']);
  });
  it('missing_salt_qty for salt with no quantity', () => {
    expect(flagsOf(input({ visits: [v('s1', { services: ['plow', 'salt'] })] }))).toEqual(['missing_salt_qty']);
    expect(flagsOf(input({ visits: [v('s1', { services: ['plow', 'salt'], salt: [{ unit: 'bag50lb', qty: 0 }] })] }))).toEqual(['missing_salt_qty']);
    expect(flagsOf(input({ visits: [v('s1', { services: ['plow', 'salt'], salt: [{ unit: 'bag50lb', qty: 1 }] })] }))).toEqual([]);
  });
  it('seasonal_info is informational and stays clean', () => {
    const contracts: BillingContract[] = [{ site_id: 's1', services: [{ service: 'plow', pricing: { type: 'seasonal', total_cents: 100, installments: 5 } }] }];
    const [d] = draftInvoices(input({ contracts }));
    expect(d!.flags.map((f) => f.code)).toEqual(['seasonal_info']);
    expect(d!.subtotal_cents).toBe(0);
    expect(isDraftClean(d!.flags)).toBe(true);
  });
  it('no_contract when visits exist without one, silent when nothing happened', () => {
    expect(flagsOf(input({ contracts: [] }))).toEqual(['no_contract']);
    expect(flagsOf(input({ contracts: [], visits: [], stops: [{ site_id: 's1', status: 'skipped' }] }))).toEqual([]);
  });
  it('missing_depth when a tier cannot be priced', () => {
    const contracts: BillingContract[] = [{ site_id: 's1', services: [{ service: 'plow', pricing: { type: 'per_inch_tier', tiers: [{ up_to_in: null, amount_cents: 100 }] } }] }];
    expect(flagsOf(input({ contracts, visits: [v('s1', { depth_in: null })] }))).toEqual(['missing_depth']);
    expect(draftInvoices(input({ contracts, visits: [v('s1', { depth_in: null })], depth: { s1: { nohrsc24hIn: 2, nwsElapsedIn: null } } }))[0]!.subtotal_cents).toBe(100);
  });
  it('waived flags are kept but no longer block', () => {
    const base = input({ visits: [v('s1', { after_photos: 0 })] });
    const [before] = draftInvoices(base);
    expect(isDraftClean(before!.flags)).toBe(false);
    const [after] = draftInvoices({ ...base, waived: [flagKey(before!.flags[0]!)] });
    expect(after!.flags[0]!.waived).toBe(true);
    expect(isDraftClean(after!.flags)).toBe(true);
  });
  it('skips sites not in the storm and groups sites by customer', () => {
    const drafts = draftInvoices(input({
      sites: [site('s1', 'c1'), site('s2', 'c1'), site('s3', 'c2')],
      contracts: [perPush, { ...perPush, site_id: 's2' }],
      stops: [{ site_id: 's1', status: 'done' }, { site_id: 's2', status: 'done' }],
      visits: [v('s1'), v('s2')],
    }));
    expect(drafts).toHaveLength(1);
    expect(drafts[0]!.subtotal_cents).toBe(13000);
  });
});

describe('applyCorrections', () => {
  it('removes voided visits and replays only correctable fields in order', () => {
    const a = v('s1'), b = v('s1');
    const out = applyCorrections([a, b], [
      { visit_id: a.id, field: 'voided', new_value: true },
      { visit_id: b.id, field: 'is_replow', new_value: true },
      { visit_id: b.id, field: 'depth_in', new_value: 4 },
      { visit_id: b.id, field: 'depth_in', new_value: 5 },
      { visit_id: b.id, field: 'arrived_at', new_value: '2000-01-01T00:00:00Z' },
    ]);
    expect(out).toHaveLength(1);
    expect(out[0]!.is_replow).toBe(true);
    expect(out[0]!.depth_in).toBe(5);
    expect(out[0]!.arrived_at).toBe(b.arrived_at);
  });
  it('ignores a voided correction that is not true', () => {
    const a = v('s1');
    expect(applyCorrections([a], [{ visit_id: a.id, field: 'voided', new_value: false }])).toHaveLength(1);
  });
});

describe('acceptance: a storm with 20 visits across all 5 pricing types', () => {
  it('totals exactly', () => {
    const sites = ['res', 'tier', 'event', 'season', 'hourly'].map((id) => site(id, `c_${id}`));
    const contracts: BillingContract[] = [
      { site_id: 'res', services: [{ service: 'plow', pricing: { type: 'per_push', amount_cents: 5500 } }] },
      { site_id: 'tier', services: [{ service: 'plow', pricing: { type: 'per_inch_tier', tiers: [{ up_to_in: 4, amount_cents: 15000 }, { up_to_in: null, amount_cents: 25000 }] } }, { service: 'salt' }], salt_pricing: { unit: 'bag50lb', amount_cents: 1800 } },
      { site_id: 'event', services: [{ service: 'plow', pricing: { type: 'per_event', amount_cents: 30000 } }] },
      { site_id: 'season', services: [{ service: 'plow', pricing: { type: 'seasonal', total_cents: 300000, installments: 5 } }] },
      { site_id: 'hourly', services: [{ service: 'plow', pricing: { type: 'hourly', rate_cents: 12000 } }] },
    ];
    const hour = (i: number) => `2025-12-12T${String(i).padStart(2, '0')}:00:00Z`;
    const visits: BillingVisit[] = [];
    for (const id of ['res', 'tier', 'event', 'season', 'hourly']) {
      for (let i = 0; i < 4; i++) {
        visits.push(v(id, {
          arrived_at: hour(i * 2), departed_at: `2025-12-12T${String(i * 2).padStart(2, '0')}:40:00Z`, depth_in: 3 + i,
          ...(id === 'tier' ? { services: ['plow', 'salt'], salt: [{ unit: 'bag50lb', qty: 2 }] } : {}),
        }));
      }
    }
    expect(visits).toHaveLength(20);
    const drafts = draftInvoices({ sites, contracts, stops: sites.map((s) => ({ site_id: s.id, status: 'done' })), visits, corrections: [], depth: {} });
    const total = (id: string) => drafts.find((d) => d.customer_id === `c_${id}`)!.subtotal_cents;
    expect(total('res')).toBe(22000); // 4 pushes x $55
    expect(total('tier')).toBe(25000 + 4 * 3600); // deepest report is 6", so top tier once, + 2 bags on 4 visits
    expect(total('event')).toBe(30000); // once per storm
    expect(total('season')).toBe(0); // seasonal_info only
    expect(total('hourly')).toBe(4 * 9000); // 40 min rounds to 0.75 h x $120
    expect(drafts.every((d) => isDraftClean(d.flags))).toBe(true);
  });
});

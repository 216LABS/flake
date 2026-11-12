import { describe, expect, it } from 'vitest';
import { FLAG_TIER, draftInvoices, type BillingContract, type BillingVisit, type DraftInput } from '../src/billing';
import { currentSeason, liveContract, localHm, nextInvoiceWindow, zonedDayEnd, zonedDayStart } from '../src/time';
import { sumOverlap } from '../src/trigger';

const NY = 'America/New_York';
const LAT = 41.48, LON = -81.8;
let n = 0;
const v = (over: Partial<BillingVisit> = {}): BillingVisit => ({
  id: `v${++n}`, site_id: 's1', services: ['plow'], arrived_at: '2025-12-12T10:00:00Z', departed_at: '2025-12-12T10:20:00Z', depth_in: 3, salt: null, is_replow: false,
  arrive_lat: LAT, arrive_lon: LON, after_photos: 1, ...over,
});
const input = (contract: BillingContract, visits: BillingVisit[]): DraftInput => ({
  sites: [{ id: 's1', customer_id: 'c1', label: 'Lot', lat: LAT, lon: LON }], contracts: [contract], stops: [{ site_id: 's1', status: 'done' }], visits, corrections: [], depth: {},
});
const perPush: BillingContract = { site_id: 's1', services: [{ service: 'plow', trigger_in: 2, pricing: { type: 'per_push', amount_cents: 4500 } }] };
const withSalt: BillingContract = { ...perPush, services: [...perPush.services, { service: 'salt' }], salt_pricing: { unit: 'bag50lb', amount_cents: 1800 } };

describe('issue 2: a finished visit with no service ticked', () => {
  it('is flagged instead of a silent $0, and the flag offers the contract services', () => {
    const [d] = draftInvoices(input(perPush, [v({ services: [] })]));
    expect(d!.subtotal_cents).toBe(0);
    const flag = d!.flags.find((f) => f.code === 'no_service');
    expect(flag?.severity).toBe('review');
    expect(flag?.services).toEqual(['plow']);
  });
  it('is not flagged when plow was ticked', () => {
    expect(draftInvoices(input(perPush, [v()]))[0]!.flags.map((f) => f.code)).not.toContain('no_service');
  });
});

describe('issue 18: salt', () => {
  it('bills salt only when Salt was ticked on the visit', () => {
    const on = draftInvoices(input(withSalt, [v({ services: ['plow', 'salt'], salt: [{ unit: 'bag50lb', qty: 2 }] })]))[0]!;
    const off = draftInvoices(input(withSalt, [v({ services: ['plow'], salt: [{ unit: 'bag50lb', qty: 2 }] })]))[0]!;
    expect(on.subtotal_cents).toBe(4500 + 3600);
    expect(off.subtotal_cents).toBe(4500);
  });
  it('salt ticked with no quantity is flagged in the contract unit, and a salt-only visit is not "no service"', () => {
    const none = draftInvoices(input(withSalt, [v({ services: ['plow', 'salt'], salt: null })]))[0]!;
    expect(none.flags.find((f) => f.code === 'missing_salt_qty')?.unit).toBe('bag50lb');
    expect(none.flags.map((f) => f.code)).not.toContain('salt_unit');
    const saltOnly = draftInvoices(input(withSalt, [v({ services: ['salt'], salt: [{ unit: 'bag50lb', qty: 1 }] })]))[0]!;
    expect(saltOnly.flags.map((f) => f.code)).not.toContain('no_service');
    expect(saltOnly.subtotal_cents).toBe(1800);
    const noUnit = draftInvoices(input(perPush, [v({ services: ['plow', 'salt'], salt: null })]))[0]!;
    expect(noUnit.flags.find((f) => f.code === 'missing_salt_qty')?.unit).toBeUndefined();
  });
  it('flags salt logged in another unit, naming the contract unit', () => {
    const d = draftInvoices(input(withSalt, [v({ services: ['plow', 'salt'], salt: [{ unit: 'ton', qty: 1 }] })]))[0]!;
    const flag = d.flags.find((f) => f.code === 'salt_unit');
    expect(flag?.unit).toBe('bag50lb');
    expect(d.subtotal_cents).toBe(4500);
  });
});

describe('issue 15: invoice texts wait for 8 AM local, on DST days too', () => {
  it('spring forward: 8:00 EDT, not 9:00', () => {
    expect(localHm(nextInvoiceWindow(new Date('2026-03-08T02:30:00Z'), NY), NY)).toEqual({ hm: '08:00', date: '2026-03-08' });
  });
  it('fall back: 8:00 EST, not 7:00', () => {
    expect(localHm(nextInvoiceWindow(new Date('2026-11-01T01:30:00Z'), NY), NY)).toEqual({ hm: '08:00', date: '2026-11-01' });
  });
});

describe('issue 16: a proof day ends at 11:59:59 PM local', () => {
  it('on the spring-forward day', () => {
    expect(localHm(zonedDayEnd('2026-03-08', NY), NY)).toEqual({ hm: '23:59', date: '2026-03-08' });
    expect(zonedDayEnd('2026-03-08', NY).getTime() - zonedDayStart('2026-03-08', NY).getTime()).toBe(23 * 3600_000 - 1000);
  });
  it('on the fall-back day, so a 23:30 visit is inside', () => {
    expect(localHm(zonedDayEnd('2026-11-01', NY), NY)).toEqual({ hm: '23:59', date: '2026-11-01' });
    expect(zonedDayEnd('2026-11-01', NY).getTime()).toBeGreaterThan(Date.parse('2026-11-02T04:30:00Z'));
  });
});

describe('issue 17: the season turns over in the company time zone', () => {
  const at = new Date('2027-07-01T01:00:00Z'); // 9 PM June 30 in Ohio
  it('is still last season in Ohio', () => {
    expect(currentSeason(at, NY)).toBe('2026-27');
    expect(currentSeason(at, 'UTC')).toBe('2027-28');
  });
  it("so next winter's renewal doesn't price that evening's storm", () => {
    const list = [{ id: 'renewal', season: '2027-28' }, { id: 'now', season: '2026-27' }];
    expect(liveContract(list, at, NY)?.id).toBe('now');
  });
});

describe('issue 13: NWS hours count only the part inside the storm', () => {
  const H = 3600_000;
  const t0 = Date.parse('2026-12-01T09:00:00Z');
  const buckets = [0, 1, 2, 3].map((i) => ({ t: t0 + i * H, v: 1 }));
  it('a storm from 9:40 to 11:00 gets a third of the 9:00 hour and all of the 10:00 hour', () => {
    expect(sumOverlap(buckets, t0 + 40 * 60_000, t0 + 2 * H)).toBe(1.3);
  });
  it('unavailable hours are skipped, and a storm with no known hours is unavailable, not zero', () => {
    expect(sumOverlap([{ t: t0, v: null }, ...buckets.slice(1)], t0, t0 + 2 * H)).toBe(1);
    expect(sumOverlap(buckets, t0 + 10 * H, t0 + 11 * H)).toBeNull();
  });
  it('the hour after the close is not counted', () => {
    expect(sumOverlap(buckets, t0, t0 + 2 * H + 15 * 60_000)).toBe(2.3);
  });
});

describe('issue 78: the location flag says what happened, and every flag has a tier', () => {
  const gps = (over: Partial<BillingVisit>) => draftInvoices(input(perPush, [v(over)]))[0]!.flags.find((f) => f.code === 'no_gps_match')?.message;
  it('no location at all is not the same as a location in the wrong place', () => {
    expect(gps({ arrive_lat: null, arrive_lon: null })).toMatch(/didn't share its location/);
    expect(gps({ arrive_lat: LAT + 0.009, arrive_lon: LON })).toMatch(/about 1(\.0)? km from the lot/);
    expect(gps({ arrive_lat: LAT + 0.0025, arrive_lon: LON })).toMatch(/about 280 m from the lot/);
    expect(gps({})).toBeUndefined();
  });
  it('measures from the drawn lot boundary when there is one', () => {
    const d = 0.0005;
    const square = { type: 'Polygon' as const, coordinates: [[[LON - d, LAT - d], [LON + d, LAT - d], [LON + d, LAT + d], [LON - d, LAT + d], [LON - d, LAT - d]]] };
    const withLot: DraftInput = { ...input(perPush, [v({ arrive_lat: LAT + 0.0035, arrive_lon: LON })]), sites: [{ id: 's1', customer_id: 'c1', label: 'Lot', lat: LAT, lon: LON, polygons: square }] };
    // About 390 m from the center, but about 330 m from the boundary's edge.
    expect(draftInvoices(withLot)[0]!.flags.find((f) => f.code === 'no_gps_match')?.message).toMatch(/about 33\d m from the lot/);
  });
  it('money first, then proof, then lots not reached', () => {
    expect([FLAG_TIER.no_service, FLAG_TIER.no_after_photo, FLAG_TIER.missing_visit, FLAG_TIER.seasonal_info]).toEqual(['money', 'proof', 'not_done', 'info']);
  });
});

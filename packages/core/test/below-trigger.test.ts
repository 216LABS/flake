import { describe, expect, it } from 'vitest';
import { draftInvoices, flagKey, noBillKey, type BillingContract, type BillingVisit, type DraftInput } from '../src/billing';

const LAT = 41.48, LON = -81.8;
let n = 0;
const v = (over: Partial<BillingVisit> = {}): BillingVisit => ({
  id: `v${++n}`, site_id: 's1', services: ['plow'], arrived_at: '2026-12-12T10:00:00Z', departed_at: '2026-12-12T10:20:00Z', depth_in: 1.5, salt: null, is_replow: false,
  arrive_lat: LAT, arrive_lon: LON, after_photos: 1, ...over,
});
const contract = (trigger_in: number | null, type: 'per_push' | 'seasonal' = 'per_push'): BillingContract => ({
  site_id: 's1',
  services: [{ service: 'plow', trigger_in, pricing: type === 'seasonal' ? { type, total_cents: 60000, installments: 3 } : { type, amount_cents: 15000 } }, { service: 'salt', trigger_in: null }],
  salt_pricing: { unit: 'bag50lb', amount_cents: 2000 },
});
const input = (over: Partial<DraftInput>): DraftInput => ({ sites: [{ id: 's1', customer_id: 'c1', label: 'Plaza', lat: LAT, lon: LON }], contracts: [contract(2)], stops: [{ site_id: 's1', status: 'done' }], visits: [v()], corrections: [], depth: {}, ...over });
const codes = (i: DraftInput) => draftInvoices(i).flatMap((d) => d.flags.map((f) => f.code));

describe('a storm under the contract trigger', () => {
  it('flags a plow billed for a 1.5" storm on a 2" contract, as money at risk', () => {
    const [d] = draftInvoices(input({}));
    expect(d!.subtotal_cents).toBe(15000);
    const f = d!.flags.find((x) => x.code === 'below_trigger')!;
    expect(f.message).toBe('Plaza: this storm measured 1.5" here, under the 2" this contract starts at, but plow is billed. Bill it only if the customer asked for it.');
    expect(f.severity).toBe('review');
  });
  it('uses the deepest reading, so a weather total over the trigger clears it', () => {
    expect(codes(input({ depth: { s1: { nohrsc24hIn: 2.5, nwsElapsedIn: null } } }))).not.toContain('below_trigger');
  });
  it('does not flag at the trigger, with no trigger, with a zero trigger, or with no depth anywhere', () => {
    expect(codes(input({ visits: [v({ depth_in: 2 })] }))).not.toContain('below_trigger');
    expect(codes(input({ contracts: [contract(null)] }))).not.toContain('below_trigger');
    expect(codes(input({ contracts: [contract(0)] }))).not.toContain('below_trigger');
    expect(codes(input({ visits: [v({ depth_in: null })] }))).not.toContain('below_trigger');
  });
  it('does not flag a seasonal contract or a visit without that service', () => {
    expect(codes(input({ contracts: [contract(2, 'seasonal')] }))).not.toContain('below_trigger');
    expect(codes(input({ visits: [v({ services: ['salt'], salt: [{ unit: 'bag50lb', qty: 2 }] })] }))).not.toContain('below_trigger');
  });
  it('Bill it anyway waives the flag and keeps the charge', () => {
    const flag = draftInvoices(input({}))[0]!.flags.find((x) => x.code === 'below_trigger')!;
    const [d] = draftInvoices(input({ waived: [flagKey(flag)] }));
    expect(d!.subtotal_cents).toBe(15000);
    expect(d!.flags.find((x) => x.code === 'below_trigger')!.waived).toBe(true);
  });
  it("Don't bill takes the lot off this storm's bill and says so", () => {
    const [d] = draftInvoices(input({ waived: [noBillKey('s1')] }));
    expect(d!.subtotal_cents).toBe(0);
    expect(d!.lines).toEqual([]);
    const f = d!.flags.find((x) => x.code === 'below_trigger')!;
    expect(f.waived).toBe(true);
    expect(f.message).toMatch(/Not billed for this storm\.$/);
  });
});

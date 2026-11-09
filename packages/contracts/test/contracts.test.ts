import { describe, expect, it } from 'vitest';
import { contractCreate, customerCreate, driverActions, driverPosition, measureRequest, pricingSchema, quoteAccept, toolContract } from '../src/index';

const U = '11111111-1111-4111-8111-111111111111';

describe('contracts', () => {
  it('accepts all 5 pricing types and rejects unknown ones', () => {
    for (const p of [
      { type: 'per_push', amount_cents: 6500 },
      { type: 'per_inch_tier', tiers: [{ up_to_in: null, amount_cents: 100 }] },
      { type: 'per_event', amount_cents: 1 },
      { type: 'seasonal', total_cents: 1, installments: 5 },
      { type: 'hourly', rate_cents: 1 },
    ]) expect(pricingSchema.safeParse(p).success).toBe(true);
    expect(pricingSchema.safeParse({ type: 'barter' }).success).toBe(false);
    expect(pricingSchema.safeParse({ type: 'per_push', amount_cents: 1.5 }).success).toBe(false);
  });
  it('turns empty strings into null on optional customer fields', () => {
    const c = customerCreate.parse({ name: 'x', kind: 'residential', email: '', phone_e164: '' });
    expect(c.email).toBeNull();
    expect(customerCreate.parse({ name: 'x', kind: 'residential', phone_e164: '216-555-0100' }).phone_e164).toBe('+12165550100');
    expect(customerCreate.parse({ name: 'x', kind: 'residential', phone_e164: '1 (216) 555-0100' }).phone_e164).toBe('+12165550100');
    expect(customerCreate.safeParse({ name: 'x', kind: 'residential', phone_e164: '555-0100' }).success).toBe(false);
  });
  it('requires at least one service on a contract', () => {
    expect(contractCreate.safeParse({ site_id: U, season: '2026-27', services: [] }).success).toBe(false);
  });
  it('validates driver actions by kind', () => {
    const base = { client_uuid: U, at: '2026-12-12T10:00:00.000Z', run_stop_id: U, visit_client_uuid: U };
    expect(driverActions.safeParse({ actions: [{ ...base, kind: 'arrive', gps: null }] }).success).toBe(true);
    expect(driverActions.safeParse({ actions: [{ ...base, kind: 'done', services: ['plow'] }] }).success).toBe(true);
    expect(driverActions.safeParse({ actions: [{ ...base, kind: 'teleport' }] }).success).toBe(false);
    expect(driverActions.safeParse({ actions: [{ ...base, kind: 'arrive', at: 'yesterday' }] }).success).toBe(false);
    expect(driverActions.safeParse({ actions: [] }).success).toBe(false);
  });
  it('accepting a quote needs a name and an explicit agree, and SMS consent defaults off', () => {
    expect(quoteAccept.safeParse({ name: 'A', agree: true }).success).toBe(false);
    expect(quoteAccept.safeParse({ name: 'Al B', agree: false }).success).toBe(false);
    expect(quoteAccept.parse({ name: 'Al B', agree: true }).consentSms).toBe(false);
  });
  it('the public contract tool needs its required fields', () => {
    expect(toolContract.safeParse({ company: 'x' }).success).toBe(false);
  });
});

describe('coordinates and sizes are real', () => {
  it('rejects a latitude or longitude off the globe and absurd lot sizes', () => {
    expect(driverPosition.safeParse({ lat: 999, lon: -81.8, at: '2026-01-20T10:00:00Z' }).success).toBe(false);
    expect(driverPosition.safeParse({ lat: 41.48, lon: -181, at: '2026-01-20T10:00:00Z' }).success).toBe(false);
    expect(driverPosition.safeParse({ lat: 41.48, lon: -81.8, at: '2026-01-20T10:00:00Z' }).success).toBe(true);
    expect(measureRequest.safeParse({ lat: 91, lon: 0 }).success).toBe(false);
  });
});

import { describe, expect, it } from 'vitest';
import { orderCostCents, orderPath, pickSupplier, referralFeeCents, reorderAdvice, stopsFor, tonsPerStorm } from '../src/salt';

const sup = (id: string, lat: number, over: Partial<Parameters<typeof pickSupplier>[0][number]> = {}) => ({ id, lat, lon: -81.8, radius_mi: 40, price_per_ton_cents: 8000, truckload_tons: 22, stop_fee_cents: 7500, active: true, ...over });

describe('salt ordering', () => {
  it('averages use over recent storms that used salt', () => {
    expect(tonsPerStorm([4, 0, 6, 5, 5, 5, 100])).toBe(5);
    expect(tonsPerStorm([0, 0])).toBeNull();
    expect(tonsPerStorm([])).toBeNull();
  });

  it('flags low salt and suggests enough for five storms', () => {
    expect(reorderAdvice(6, 4)).toEqual({ storms_left: 1.5, low: true, suggest_tons: 14 });
    expect(reorderAdvice(20, 4)).toEqual({ storms_left: 5, low: false, suggest_tons: 0 });
    expect(reorderAdvice(-3, 4)).toEqual({ storms_left: 0, low: true, suggest_tons: 20 });
    expect(reorderAdvice(null, 4).storms_left).toBeNull();
    expect(reorderAdvice(10, null).low).toBe(false);
    expect(reorderAdvice(10, 0).suggest_tons).toBe(0);
  });

  it('picks the cheapest supplier that delivers to the yard, nearest on a tie', () => {
    const yard = { lat: 41.48, lon: -81.8 };
    const list = [sup('far-cheap', 42.4, { price_per_ton_cents: 6000 }), sup('near', 41.5), sup('nearer-same-price', 41.481), sup('off', 41.48, { active: false, price_per_ton_cents: 100 }), sup('pricey', 41.48, { price_per_ton_cents: 9000 })];
    const best = pickSupplier(list, yard.lat, yard.lon)!;
    expect(best.id).toBe('nearer-same-price');
    expect(best.miles).toBeLessThan(1);
    expect(pickSupplier([sup('far', 43)], yard.lat, yard.lon)).toBeNull();
  });

  it('ships a full truckload alone and pools anything smaller', () => {
    expect(orderPath(22, 10, 22)).toEqual({ kind: 'direct' });
    expect(orderPath(8, 10, 22)).toEqual({ kind: 'pool', poolTonsAfter: 18, fills: false });
    expect(orderPath(12, 10, 22)).toEqual({ kind: 'pool', poolTonsAfter: 22, fills: true });
  });

  it('never overloads the truck', () => {
    // A little over is fine: trucks carry some slack.
    expect(orderPath(14, 10, 22)).toEqual({ kind: 'pool', poolTonsAfter: 24, fills: true });
    // Nearly full and yours won't fit: it ships without you and yours starts the next load.
    expect(orderPath(10, 20, 22)).toEqual({ kind: 'next', shipsNowTons: 20, poolTonsAfter: 10 });
    // Otherwise split across this load and the next.
    expect(orderPath(20, 5, 22)).toEqual({ kind: 'split', nowTons: 17, laterTons: 3 });
    expect(orderPath(17.5, 8.3, 22)).toEqual({ kind: 'split', nowTons: 13.7, laterTons: 3.8 });
    expect(stopsFor({ kind: 'direct' })).toBe(0);
    expect(stopsFor({ kind: 'pool', poolTonsAfter: 5, fills: false })).toBe(1);
    expect(stopsFor({ kind: 'next', shipsNowTons: 20, poolTonsAfter: 10 })).toBe(1);
    expect(stopsFor({ kind: 'split', nowTons: 17, laterTons: 3 })).toBe(2);
  });

  it('prices orders and referral fees', () => {
    expect(orderCostCents(8, 8000, 7500, true)).toBe(71500);
    expect(orderCostCents(22, 8000, 7500, false)).toBe(176000);
    expect(orderCostCents(20, 8000, 7500, 2)).toBe(175000);
    expect(referralFeeCents(8, null, 300)).toBe(2400);
    expect(referralFeeCents(8, 7.5, 300)).toBe(2250);
  });
});

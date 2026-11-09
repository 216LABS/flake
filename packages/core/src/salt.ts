import { distanceMeters } from './geo';

/**
 * Salt ordering. Contractors order bulk salt in Flake and a partner distributor delivers. Bulk only comes by the
 * truckload (about 22 tons), so smaller orders pool with others near the same supplier until a truck fills.
 */

export interface SaltSupplierLike {
  id: string;
  lat: number;
  lon: number;
  radius_mi: number;
  price_per_ton_cents: number;
  truckload_tons: number;
  stop_fee_cents: number;
  active: boolean;
}

const MI = 1609.344;

/** Average tons used per storm over the recent storms that used any, newest first. Null with no history. */
export function tonsPerStorm(tonsByStorm: number[], recent = 5): number | null {
  const used = tonsByStorm.filter((t) => t > 0).slice(0, recent);
  if (!used.length) return null;
  return used.reduce((a, b) => a + b, 0) / used.length;
}

export interface ReorderAdvice {
  storms_left: number | null;
  /** True when salt on hand covers fewer than LOW_STORMS storms. */
  low: boolean;
  /** Tons to order to get back to TARGET_STORMS storms of cover, rounded up to whole tons. 0 when not low. */
  suggest_tons: number;
}

export const LOW_STORMS = 2;
export const TARGET_STORMS = 5;

export function reorderAdvice(onHandTons: number | null, perStorm: number | null): ReorderAdvice {
  if (onHandTons === null || perStorm === null || perStorm <= 0) return { storms_left: null, low: false, suggest_tons: 0 };
  const left = Math.max(0, onHandTons) / perStorm;
  const low = left < LOW_STORMS;
  return { storms_left: Math.round(left * 10) / 10, low, suggest_tons: low ? Math.ceil(TARGET_STORMS * perStorm - Math.max(0, onHandTons)) : 0 };
}

/** Delivered price per ton for this yard: the cheapest active supplier whose area covers it, nearest on a tie. */
export function pickSupplier<T extends SaltSupplierLike>(suppliers: T[], lat: number, lon: number): (T & { miles: number }) | null {
  const covering = suppliers
    .filter((s) => s.active)
    .map((s) => ({ ...s, miles: distanceMeters(lat, lon, s.lat, s.lon) / MI }))
    .filter((s) => s.miles <= s.radius_mi)
    .sort((a, b) => a.price_per_ton_cents - b.price_per_ton_cents || a.miles - b.miles);
  return covering[0] ?? null;
}

export type OrderPath = { kind: 'direct' } | { kind: 'pool'; poolTonsAfter: number; fills: boolean };

/** A full truckload ships on its own. Anything smaller joins the open pool, which ships once it reaches a truckload. */
export function orderPath(orderTons: number, openPoolTons: number, truckloadTons: number): OrderPath {
  if (orderTons >= truckloadTons) return { kind: 'direct' };
  const after = openPoolTons + orderTons;
  return { kind: 'pool', poolTonsAfter: after, fills: after >= truckloadTons };
}

/** What the contractor will pay the supplier, before tax: tons at the delivered price, plus a stop fee on pooled loads. */
export function orderCostCents(tons: number, pricePerTonCents: number, stopFeeCents: number, pooled: boolean): number {
  return Math.round(tons * pricePerTonCents) + (pooled ? stopFeeCents : 0);
}

/** 216LABS's referral fee on an order, counted on what was delivered when known. */
export function referralFeeCents(tons: number, deliveredTons: number | null, feePerTonCents: number): number {
  return Math.round((deliveredTons ?? tons) * feePerTonCents);
}

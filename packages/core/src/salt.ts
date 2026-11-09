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

export type OrderPath =
  | { kind: 'direct' }
  | { kind: 'pool'; poolTonsAfter: number; fills: boolean }
  /** The open load is nearly full and yours won't fit, so it ships now without you and yours starts the next one. */
  | { kind: 'next'; shipsNowTons: number; poolTonsAfter: number }
  /** Yours won't fit: part of it fills the open load, the rest starts the next one. Two drops. */
  | { kind: 'split'; nowTons: number; laterTons: number };

/** A truck can take a little over its nominal load, but not a second load's worth. */
export const OVERFILL = 0.1;
/** An open load this full ships as is when the next order won't fit on it. */
export const SHIP_AS_IS = 0.85;

const r1 = (n: number) => Math.round(n * 10) / 10;

/**
 * A full truckload ships on its own. Anything smaller joins the open pool, which ships once it reaches a truckload. An order
 * that would overflow the truck either waits for the next load (when the open one is nearly full anyway) or is split.
 */
export function orderPath(orderTons: number, openPoolTons: number, truckloadTons: number): OrderPath {
  if (orderTons >= truckloadTons) return { kind: 'direct' };
  const after = openPoolTons + orderTons;
  if (after <= truckloadTons * (1 + OVERFILL)) return { kind: 'pool', poolTonsAfter: after, fills: after >= truckloadTons };
  if (openPoolTons >= truckloadTons * SHIP_AS_IS) return { kind: 'next', shipsNowTons: openPoolTons, poolTonsAfter: orderTons };
  const nowTons = r1(truckloadTons - openPoolTons);
  return { kind: 'split', nowTons, laterTons: r1(orderTons - nowTons) };
}

/** Stops the supplier makes for this order: none extra on its own truck, one on a shared load, two when split. */
export function stopsFor(path: OrderPath): number {
  return path.kind === 'direct' ? 0 : path.kind === 'split' ? 2 : 1;
}

/** What the contractor will pay the supplier, before tax: tons at the delivered price, plus a stop fee per shared-load drop. */
export function orderCostCents(tons: number, pricePerTonCents: number, stopFeeCents: number, stops: number | boolean): number {
  return Math.round(tons * pricePerTonCents) + Number(stops) * stopFeeCents;
}

/** 216LABS's referral fee on an order, counted on what was delivered when known. */
export function referralFeeCents(tons: number, deliveredTons: number | null, feePerTonCents: number): number {
  return Math.round((deliveredTons ?? tons) * feePerTonCents);
}

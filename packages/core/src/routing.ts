import { distanceMeters } from './geo';

/**
 * Suggested stop order for one truck. Priority 1 sites come first, then 2, and so on (plow practice:
 * set the tiers, then cut drive time inside each one). Inside a tier the order is built nearest-first,
 * then improved by reversing runs and moving single stops until nothing gets shorter. Missing an
 * "open by" deadline costs far more than extra driving, so deadlines win ties.
 * No map service: straight-line distance stretched for real roads, at a storm driving speed.
 */

export interface RouteSite {
  id: string;
  lat: number;
  lon: number;
  priority: number;
  open_by?: string | null;
  sqft?: number | null;
  /** Minutes on site, when known better than the size estimate. 0 for a starting point that isn't a lot. */
  service_min?: number;
}

export interface RouteOptions {
  /** Clock time the truck starts the first stop, 'HH:MM'. */
  start?: string;
  /** Leave the current first stop first (the stop nearest the yard, say). */
  keepFirst?: boolean;
  /** 'full' (the default) adds Or-opt moves; 'basic' is the earlier search, kept for comparisons (issue 42). */
  search?: 'basic' | 'full';
  /** Stop improving after this long. The best order so far is returned. */
  budgetMs?: number;
}

export interface PlannedStop { id: string; arrive: string; finish: string; drive_min: number; service_min: number; late: boolean }
export interface RoutePlan { stops: PlannedStop[]; drive_min: number; total_min: number; late: number }

export const ROAD_FACTOR = 1.3;
export const STORM_MPH = 25;
const LATE_WEIGHT = 5;

/** Mid-size lot about 25 minutes, big retail lot about 90; unknown size about 20. */
export function serviceMinutes(sqft: number | null | undefined): number {
  if (!sqft || sqft <= 0) return 20;
  return Math.round(15 + sqft / 4000);
}

export function driveMinutes(a: { lat: number; lon: number }, b: { lat: number; lon: number }): number {
  const miles = (distanceMeters(a.lat, a.lon, b.lat, b.lon) * ROAD_FACTOR) / 1609.344;
  return (miles / STORM_MPH) * 60;
}

const toMin = (hm: string) => {
  const m = /^(\d{1,2}):(\d{2})$/.exec(hm);
  return m ? Number(m[1]) * 60 + Number(m[2]) : NaN;
};
const toHm = (min: number) => {
  const m = Math.round(min) % 1440;
  return `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
};

/** A deadline earlier on the clock than the start means the next morning. */
function deadline(openBy: string | null | undefined, start: number): number | null {
  const d = openBy ? toMin(openBy) : NaN;
  if (Number.isNaN(d)) return null;
  return d < start ? d + 1440 : d;
}

function score(order: RouteSite[], start: number) {
  let clock = start;
  let drive = 0;
  let lateMin = 0;
  let late = 0;
  const stops: PlannedStop[] = [];
  for (let i = 0; i < order.length; i++) {
    const s = order[i]!;
    const leg = i === 0 ? 0 : driveMinutes(order[i - 1]!, s);
    drive += leg;
    clock += leg;
    const arrive = clock;
    const service = s.service_min ?? serviceMinutes(s.sqft);
    clock += service;
    const due = deadline(s.open_by, start);
    const over = due === null ? 0 : clock - due;
    if (over > 0) { late++; lateMin += over; }
    stops.push({ id: s.id, arrive: toHm(arrive), finish: toHm(clock), drive_min: Math.round(leg), service_min: service, late: over > 0 });
  }
  return { plan: { stops, drive_min: Math.round(drive), total_min: Math.round(clock - start), late }, cost: drive + LATE_WEIGHT * lateMin };
}

export function evaluateRoute(order: RouteSite[], opts: RouteOptions = {}): RoutePlan {
  return score(order, startOf(opts)).plan;
}

function startOf(opts: RouteOptions) {
  const s = toMin(opts.start ?? '04:00');
  return Number.isNaN(s) ? 240 : s;
}

/** Nearest next stop, tier by tier, from a given first stop. */
function nearestFirst(first: RouteSite | null, tiers: RouteSite[][]): RouteSite[] {
  const out: RouteSite[] = first ? [first] : [];
  for (const tier of tiers) {
    const left = tier.filter((s) => s !== first);
    while (left.length) {
      const here = out[out.length - 1];
      let best = 0;
      if (here) {
        for (let i = 1; i < left.length; i++) if (driveMinutes(here, left[i]!) < driveMinutes(here, left[best]!)) best = i;
      }
      out.push(left.splice(best, 1)[0]!);
    }
  }
  return out;
}

export function suggestRoute(sites: RouteSite[], opts: RouteOptions = {}): RouteSite[] {
  if (sites.length < 3) return opts.keepFirst ? [...sites] : [...sites].sort((a, b) => a.priority - b.priority);
  const start = startOf(opts);
  const fixed = opts.keepFirst ? sites[0]! : null;
  const rest = fixed ? sites.slice(1) : sites;
  const levels = [...new Set(rest.map((s) => s.priority))].sort((a, b) => a - b);
  const tiers = levels.map((p) => rest.filter((s) => s.priority === p));

  // Start from the current order when it already keeps the tiers, so asking twice gives the same answer.
  // A nearest-first build from any top-tier opener replaces it only when strictly cheaper.
  const tiered = rest.every((s, i) => i === 0 || rest[i - 1]!.priority <= s.priority);
  let order = tiered ? [...sites] : nearestFirst(fixed, tiers);
  let best = score(order, start).cost;
  const built = nearestFirst(fixed, tiers);
  if (score(built, start).cost < best) { order = built; best = score(built, start).cost; }
  if (!fixed) {
    for (const opener of tiers[0]!) {
      const tried = nearestFirst(opener, tiers);
      const c = score(tried, start).cost;
      if (c < best) { best = c; order = tried; }
    }
  }

  // Positions [lo, hi) of each tier inside the order; moves never cross a tier or touch a kept first stop.
  const bounds: [number, number][] = [];
  let at = fixed ? 1 : 0;
  for (const t of tiers) { bounds.push([at, at + t.length]); at += t.length; }

  let cost = score(order, start).cost;
  const full = (opts.search ?? 'full') === 'full';
  const until = Date.now() + (opts.budgetMs ?? 4000);
  for (let pass = 0, better = true; better && pass < 50 && Date.now() < until; pass++) {
    better = false;
    for (const [lo, hi] of bounds) {
      for (let i = lo; i < hi - 1; i++) {
        for (let j = i + 1; j < hi; j++) {
          // Reverse the run i..j.
          const flipped = [...order.slice(0, i), ...order.slice(i, j + 1).reverse(), ...order.slice(j + 1)];
          const c1 = score(flipped, start).cost;
          if (c1 < cost - 1e-9) { order = flipped; cost = c1; better = true; }
          // Move stop i to just after j, and stop j to just before i.
          const later = [...order];
          later.splice(j, 0, later.splice(i, 1)[0]!);
          const c2 = score(later, start).cost;
          if (c2 < cost - 1e-9) { order = later; cost = c2; better = true; }
          const sooner = [...order];
          sooner.splice(i, 0, sooner.splice(j, 1)[0]!);
          const c3 = score(sooner, start).cost;
          if (c3 < cost - 1e-9) { order = sooner; cost = c3; better = true; }
        }
      }
    }
    // Or-opt: lift a run of 2 or 3 stops and drop it anywhere else in its tier, either way round. Single moves and
    // reversals can't fix a cluster sitting in the wrong part of town; this can (issue 42). Only once the cheap moves
    // have stalled, so a big route spends its time budget on them first.
    if (full && !better && Date.now() < until) {
      for (const [lo, hi] of bounds) {
        for (let k = 2; k <= 3; k++) {
          for (let i = lo; i + k <= hi; i++) {
            for (let p = lo; p <= hi - k; p++) {
              if (p === i) continue;
              for (const rev of [false, true]) {
                const rest = [...order.slice(0, i), ...order.slice(i + k)];
                const seg = order.slice(i, i + k);
                const moved = [...rest.slice(0, p), ...(rev ? seg.reverse() : seg), ...rest.slice(p)];
                const c = score(moved, start).cost;
                if (c < cost - 1e-9) { order = moved; cost = c; better = true; }
              }
            }
          }
        }
      }
    }
  }
  return order;
}

/**
 * Current plan next to the suggested one. When the current order already keeps the tiers and is no
 * worse, the suggestion is the current order, so the button never proposes a change for its own sake.
 */
export function compareRoute(sites: RouteSite[], opts: RouteOptions = {}) {
  const start = startOf(opts);
  const now = score(sites, start);
  let order = suggestRoute(sites, opts);
  const tiered = sites.slice(opts.keepFirst ? 1 : 0).every((s, i, a) => i === 0 || a[i - 1]!.priority <= s.priority);
  if (tiered && score(order, start).cost >= now.cost - 1e-9) order = [...sites];
  const changed = order.some((s, i) => s.id !== sites[i]!.id);
  return { current: now.plan, suggested: score(order, start).plan, changed };
}

/**
 * Mid-storm: order a truck's remaining stops starting from where the truck is now. The truck's position is a
 * starting point with no time on site; tiers and open-by times work as they do for a master route.
 */
export function replanFrom(at: { lat: number; lon: number }, remaining: RouteSite[], opts: Omit<RouteOptions, 'keepFirst'> = {}) {
  const truck: RouteSite = { id: '__truck', lat: at.lat, lon: at.lon, priority: 0, service_min: 0 };
  const r = compareRoute([truck, ...remaining], { ...opts, keepFirst: true });
  const drop = (p: RoutePlan): RoutePlan => ({ ...p, stops: p.stops.slice(1) });
  return { current: drop(r.current), suggested: drop(r.suggested), changed: r.changed };
}

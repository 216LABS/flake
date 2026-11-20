import { compareRoute, legMinutesWith, routeCost, serviceMinutes, type RouteOptions, type RoutePlan, type RouteSite } from './routing';

/**
 * Plan all routes (issue 68): split a set of lots across several trucks, then order each truck's stops.
 *
 * 1. Sweep: sort the lots by bearing from the yard (or the middle of the lots) and cut the circle into one slice per
 *    truck, each about the same work in minutes, not the same number of stops. Several starting bearings are tried.
 * 2. Each slice goes to the route that already holds most of its lots, so as few lots change route as possible.
 * 3. Moves between trucks: hand one lot to another truck (relocate), or swap two (exchange), whenever that lowers the
 *    total driving, waiting and lateness plus the time the last truck finishes.
 * 4. Each truck's order is then improved with the same search as Suggest order. Priority tiers stay in order.
 *
 * Nothing here saves anything. The plan is never worse than the routes as they are: when it can't beat them, the
 * current routes come back unchanged.
 */

export interface FleetTruck {
  /** The route this truck runs. */
  id: string;
  /** Site ids on the route now, in order. Lots not in `sites` are dropped. */
  current: string[];
  /** Out from the yard and back (the route's own setting). Default true when there is a yard. */
  yard_trip?: boolean;
}

export interface FleetOptions {
  start?: string;
  yard?: { lat: number; lon: number } | null;
  legMinutes?: RouteOptions['legMinutes'];
  /** Stop searching after this long; the best plan so far is used. */
  budgetMs?: number;
  /**
   * Issue 194. 'keep' (the default): keep each route's lots, and move one only when that saves at least `churnMinutes`,
   * with at most `maxMoveShare` of the routed lots moving. 'add_only': put lots on no route onto the best route, and move
   * no routed lot. 'fresh': split everything again from scratch.
   */
  mode?: FleetMode;
  churnMinutes?: number;
  maxMoveShare?: number;
}

export type FleetMode = 'keep' | 'add_only' | 'fresh';
/** A lot that changes route, and about how much nearer it is to its new route's other lots than its old one's. */
export interface FleetMove { site_id: string; from: string | null; to: string; closer_min: number }

export interface FleetRoute { id: string; site_ids: string[]; plan: RoutePlan; before: RoutePlan; moved_in: number }
export interface FleetTotals { drive_min: number; late: number; /** Minutes until the last truck is done. */ longest_min: number; stops: number }
export interface FleetPlan { routes: FleetRoute[]; before: FleetTotals; after: FleetTotals; moved: number; changed: boolean; mode: FleetMode; moves: FleetMove[] }

/**
 * How much uneven days count against driving. The balance term is sqrt(k * sum of each truck's minutes squared): equal to
 * the fleet's total minutes when every truck has the same day, and higher the more uneven they are. Unlike "the longest
 * day", it still drops when one of three equally long trucks hands a lot to a short one, so the search doesn't stall.
 */
const BALANCE = 1;

type Assign = string[][];

export function planFleet(sites: RouteSite[], trucks: FleetTruck[], opts: FleetOptions = {}): FleetPlan {
  if (!trucks.length) throw new Error('planFleet needs at least one truck');
  const byId = new Map(sites.map((s) => [s.id, s]));
  const until = Date.now() + (opts.budgetMs ?? 5000);
  const k = trucks.length;
  const ro = (t: number): RouteOptions => ({ start: opts.start, yard: trucks[t]!.yard_trip === false ? null : (opts.yard ?? null), legMinutes: opts.legMinutes ?? null });
  const legOf = (a: RouteSite, b: { lat: number; lon: number }) => legMinutesWith(ro(0), a, b);

  // Each lot counted once, on the first route that has it.
  const seen = new Set<string>();
  const current: Assign = trucks.map((t) => t.current.filter((id) => byId.has(id) && !seen.has(id) && Boolean(seen.add(id))));
  const loose = sites.filter((s) => !seen.has(s.id)).map((s) => s.id);

  const evalRoute = (t: number, ids: string[]) => (ids.length ? routeCost(ids.map((id) => byId.get(id)!), ro(t)) : { plan: emptyPlan(), cost: 0 });
  // A new, empty route means splitting things up again, unless the caller says otherwise.
  const mode: FleetMode = opts.mode ?? (current.some((ids) => !ids.length) ? 'fresh' : 'keep');
  // A routed lot that leaves its route costs this many minutes in the search, so a move has to be worth it (issue 194).
  const churn = mode === 'keep' ? (opts.churnMinutes ?? 5) : 0;
  const homeOf = new Map(current.flatMap((ids, t) => ids.map((id) => [id, t] as const)));
  const routedCount = homeOf.size;
  const maxMoves = mode === 'keep' ? Math.max(1, Math.floor(routedCount * (opts.maxMoveShare ?? 0.2))) : Infinity;
  const offRoute = (assign: Assign) => assign.reduce((n, ids, t) => n + ids.filter((id) => homeOf.has(id) && homeOf.get(id) !== t).length, 0);
  // Filling a route that started empty (a new truck) isn't churn for the cap.
  const capped = (assign: Assign) => assign.reduce((n, ids, t) => n + (current[t]!.length ? ids.filter((id) => homeOf.has(id) && homeOf.get(id) !== t).length : 0), 0);
  const objective = (costs: { plan: RoutePlan; cost: number }[], assign?: Assign) => costs.reduce((a, c) => a + c.cost, 0) + BALANCE * Math.sqrt(k * costs.reduce((a, c) => a + c.plan.total_min ** 2, 0)) + (assign ? churn * offRoute(assign) : 0);
  const allowed = (assign: Assign) => mode !== 'add_only' && capped(assign) <= maxMoves;

  // The routes as they are, with any lot on no route yet added where it's cheapest, so "before" is a real plan of the
  // same lots and the new plan has to beat it.
  const asIs = current.map((ids) => [...ids]);
  for (const id of loose) insertCheapest(asIs, id);
  const beforeCosts = asIs.map((ids, t) => evalRoute(t, ids));

  // 1. Sweep.
  const centre = opts.yard ?? { lat: avg(sites.map((s) => s.lat)), lon: avg(sites.map((s) => s.lon)) };
  const bearing = (s: RouteSite) => Math.atan2(s.lat - centre.lat, (s.lon - centre.lon) * Math.cos((centre.lat * Math.PI) / 180));
  const circle = [...sites].sort((a, b) => bearing(a) - bearing(b) || a.id.localeCompare(b.id));
  const work = new Map(circle.map((s) => {
    let near = Infinity;
    for (const o of circle) if (o !== s) near = Math.min(near, legOf(s, o));
    return [s.id, (s.service_min ?? serviceMinutes(s.sqft)) + (Number.isFinite(near) ? near : 0)];
  }));
  const total = circle.reduce((a, s) => a + work.get(s.id)!, 0);
  let best: Assign = asIs;
  let bestScore = Infinity;
  // Keep and add-only start from the routes as they are: a fresh split by bearing from a yard off to one side doesn't
  // line up with neighborhoods, and route names would stop meaning anything (issue 194).
  const tries = mode === 'fresh' ? Math.min(circle.length, 12) : 0;
  for (let r = 0; r < tries; r++) {
    const offset = Math.floor((r * circle.length) / tries);
    const turned = [...circle.slice(offset), ...circle.slice(0, offset)];
    const slices: Assign = Array.from({ length: k }, () => []);
    let done = 0;
    for (const s of turned) {
      const w = work.get(s.id)!;
      // The slice whose share this lot's midpoint falls in.
      const i = Math.min(k - 1, Math.floor(((done + w / 2) / total) * k));
      slices[i]!.push(s.id);
      done += w;
    }
    const ordered = matchToTrucks(slices, current).map((ids) => quickOrder(ids));
    const sc = objective(ordered.map((ids, t) => evalRoute(t, ids)));
    if (sc < bestScore) { bestScore = sc; best = ordered; }
  }

  // 3. Moves between trucks. None in add-only mode.
  let plan = best.map((ids) => [...ids]);
  let costs = plan.map((ids, t) => evalRoute(t, ids));
  let score = objective(costs, plan);
  for (let pass = 0, better = mode !== 'add_only'; better && pass < 30 && Date.now() < until; pass++) {
    better = false;
    for (let a = 0; a < k && Date.now() < until; a++) {
      for (let i = 0; i < plan[a]!.length && Date.now() < until; i++) {
        const id = plan[a]![i]!;
        // Relocate this lot to the truck where it fits best.
        for (let b = 0; b < k; b++) {
          if (b === a) continue;
          const fromA = plan[a]!.filter((x) => x !== id);
          const toB = withInserted(plan[b]!, id);
          const tryPlan = plan.map((ids, t) => (t === a ? fromA : t === b ? toB : ids));
          if (!allowed(tryPlan)) continue;
          const ca = evalRoute(a, fromA);
          const cb = evalRoute(b, toB);
          const next = costs.map((c, t) => (t === a ? ca : t === b ? cb : c));
          const sc = objective(next, tryPlan);
          if (sc < score - 1e-6) {
            plan[a] = fromA; plan[b] = toB; costs = next; score = sc; better = true;
            i--;
            break;
          }
        }
      }
    }
    // Exchange: swap a lot with one of the three nearest lots on another truck.
    for (let a = 0; a < k && Date.now() < until; a++) {
      for (const id of [...plan[a]!]) {
        if (!plan[a]!.includes(id)) continue;
        const s = byId.get(id)!;
        for (let b = a + 1; b < k; b++) {
          const near = [...plan[b]!].sort((x, y) => legOf(s, byId.get(x)!) - legOf(s, byId.get(y)!)).slice(0, 3);
          let swapped = false;
          for (const other of near) {
            const fromA = withInserted(plan[a]!.filter((x) => x !== id), other);
            const fromB = withInserted(plan[b]!.filter((x) => x !== other), id);
            const tryPlan = plan.map((ids, t) => (t === a ? fromA : t === b ? fromB : ids));
            if (!allowed(tryPlan)) continue;
            const ca = evalRoute(a, fromA);
            const cb = evalRoute(b, fromB);
            const next = costs.map((c, t) => (t === a ? ca : t === b ? cb : c));
            const sc = objective(next, tryPlan);
            if (sc < score - 1e-6) {
              plan[a] = fromA; plan[b] = fromB; costs = next; score = sc; better = true; swapped = true;
              break;
            }
          }
          if (swapped) break;
        }
      }
    }
    // Tidy each truck's order between passes, so the next moves are priced against good orders.
    const tidied = plan.map((ids, t) => tidy(t, ids, until, 250));
    const tc = tidied.map((ids, t) => evalRoute(t, ids));
    const ts = objective(tc, tidied);
    if (ts < score - 1e-6) { plan = tidied; costs = tc; score = ts; better = true; }
  }

  // 4. A last, full search on each truck's order, with whatever time is left.
  plan = plan.map((ids, t) => tidy(t, ids, Math.max(until, Date.now() + 300), 1500));
  costs = plan.map((ids, t) => evalRoute(t, ids));
  score = objective(costs, plan);

  const beforeScore = objective(beforeCosts, asIs);
  const changed = score < beforeScore - 1e-6 && plan.some((ids, t) => ids.join() !== trucks[t]!.current.join());
  const final = changed ? plan : asIs;
  const finalCosts = changed ? costs : beforeCosts;
  const routes: FleetRoute[] = trucks.map((t, i) => ({
    id: t.id,
    site_ids: final[i]!,
    plan: finalCosts[i]!.plan,
    before: evalRoute(i, current[i]!).plan,
    moved_in: final[i]!.filter((id) => !current[i]!.includes(id)).length,
  }));
  return {
    routes,
    before: totals(current.map((ids, t) => evalRoute(t, ids).plan)),
    after: totals(finalCosts.map((c) => c.plan)),
    moved: routes.reduce((a, r) => a + r.moved_in, 0),
    changed: routes.some((r, i) => r.site_ids.join() !== trucks[i]!.current.join()),
    mode,
    moves: final.flatMap((ids, t) => ids.filter((id) => homeOf.get(id) !== t).map((id) => {
      const from = homeOf.has(id) ? homeOf.get(id)! : null;
      // How much nearer its new neighbors are than its old ones: the reason a person can check on a map.
      const nearest = (list: string[]) => Math.min(Infinity, ...list.filter((x) => x !== id).map((x) => legOf(byId.get(id)!, byId.get(x)!)));
      const was = from === null ? Infinity : nearest(current[from]!);
      const now = nearest(ids);
      return { site_id: id, from: from === null ? null : trucks[from]!.id, to: trucks[t]!.id, closer_min: Number.isFinite(was) && Number.isFinite(now) ? Math.round(was - now) : 0 };
    })),
  };

  /** Puts a lot where it adds the least driving, inside its priority tier. */
  function withInserted(ids: string[], id: string): string[] {
    const s = byId.get(id)!;
    const stops = ids.map((x) => byId.get(x)!);
    let lo = 0;
    let hi = stops.length;
    stops.forEach((o, i) => {
      if (o.priority < s.priority) lo = i + 1;
    });
    for (let i = stops.length - 1; i >= 0; i--) if (stops[i]!.priority > s.priority) hi = i;
    if (hi < lo) [lo, hi] = [hi, lo];
    let bestAt = hi;
    let bestAdd = Infinity;
    for (let p = lo; p <= hi; p++) {
      const prev = stops[p - 1] ?? opts.yard ?? null;
      const next = stops[p] ?? opts.yard ?? null;
      const add = (prev ? legOf(s, prev) : 0) + (next ? legOf(s, next) : 0) - (prev && next ? legMinutesWith(ro(0), prev, next) : 0);
      if (add < bestAdd - 1e-9) { bestAdd = add; bestAt = p; }
    }
    return [...ids.slice(0, bestAt), id, ...ids.slice(bestAt)];
  }

  function insertCheapest(assign: Assign, id: string) {
    let bestT = 0;
    let bestCost = Infinity;
    let bestIds: string[] = [];
    for (let t = 0; t < assign.length; t++) {
      const ids = withInserted(assign[t]!, id);
      const c = evalRoute(t, ids).cost - evalRoute(t, assign[t]!).cost;
      if (c < bestCost) { bestCost = c; bestT = t; bestIds = ids; }
    }
    assign[bestT] = bestIds;
  }

  /** Priority tiers in order, nearest-first inside each, from the yard or the first lot. Cheap; good enough to compare. */
  function quickOrder(ids: string[]): string[] {
    const left = ids.map((id) => byId.get(id)!).sort((a, b) => a.priority - b.priority);
    const out: RouteSite[] = [];
    let here: { lat: number; lon: number } | null = opts.yard ?? null;
    while (left.length) {
      const tier = left[0]!.priority;
      let pick = 0;
      if (here) {
        for (let i = 1; i < left.length && left[i]!.priority === tier; i++) if (legOf(left[i]!, here) < legOf(left[pick]!, here)) pick = i;
      }
      const s = left.splice(pick, 1)[0]!;
      out.push(s);
      here = s;
    }
    return out.map((s) => s.id);
  }

  /** The Suggest order search on one truck, with a share of the time left. */
  function tidy(t: number, ids: string[], end: number, cap: number): string[] {
    if (ids.length < 3) return ids;
    const left = Math.max(50, Math.floor((end - Date.now()) / k));
    const r = compareRoute(ids.map((id) => byId.get(id)!), { ...ro(t), budgetMs: Math.min(left, cap), restarts: ids.length <= 30 ? 2 : 0 });
    return r.suggested.stops.map((s) => s.id);
  }
}

/** Gives each slice to the route that already has most of its lots, biggest overlaps first. */
function matchToTrucks(slices: Assign, current: Assign): Assign {
  const pairs: { s: number; t: number; n: number }[] = [];
  slices.forEach((ids, s) => current.forEach((cur, t) => pairs.push({ s, t, n: ids.filter((id) => cur.includes(id)).length })));
  pairs.sort((a, b) => b.n - a.n || a.s - b.s || a.t - b.t);
  const out: Assign = Array.from({ length: current.length }, () => []);
  const usedS = new Set<number>();
  const usedT = new Set<number>();
  for (const p of pairs) {
    if (usedS.has(p.s) || usedT.has(p.t)) continue;
    out[p.t] = slices[p.s]!;
    usedS.add(p.s);
    usedT.add(p.t);
  }
  return out;
}

function totals(plans: RoutePlan[]): FleetTotals {
  return {
    drive_min: plans.reduce((a, p) => a + p.drive_min, 0),
    late: plans.reduce((a, p) => a + p.late, 0),
    longest_min: Math.max(0, ...plans.map((p) => p.total_min)),
    stops: plans.reduce((a, p) => a + p.stops.length, 0),
  };
}

const emptyPlan = (): RoutePlan => ({ stops: [], drive_min: 0, total_min: 0, late: 0, wait_min: 0, break_min: 0, work_min: 0 });
const avg = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0);

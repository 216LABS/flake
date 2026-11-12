# Suggest order v2: design (issue 42)

Status: ready to slice. Slice 1 (Or-opt and a time budget) shipped with this note. The rest is listed under "Slices" at the end.

## What it does today

`packages/core/src/routing.ts`, called from `POST /api/routes/:id/suggest` and from mid-storm Re-plan (`planRun`).

- Stops stay in priority tiers (1, then 2, then 3). No move crosses a tier.
- Inside a tier it builds a nearest-first order from each top-tier opener (or from the kept first stop), then improves it with 2-opt reversals and single-stop moves.
- Since this note, it also moves runs of 2 or 3 stops (Or-opt, either way round) once those cheap moves stall, all within a 4 second budget.
- Drive time is straight-line distance × 1.3 at 25 mph. There is no map service.
- `open_by` is a deadline. Each late minute costs as much as 5 minutes of driving.
- Service time comes from lot size, or 20 minutes when the size is unknown.
- Mid-storm re-plan starts from the truck's last GPS fix, or the lot it is on.
- Nothing is saved until the dispatcher taps "Use this order".

## 1. Objective and constraints

Minimize **drive minutes + 5 × late minutes**, the cost used today. Planned changes:

- **Priority tiers stay hard.** Plow companies set them on purpose: hospitals and the 6 AM retail lots first. A soft tier would surprise them. A future setting could let a tier yield when the saving is large; no one has asked for it.
- **`open_by` stays a weighted deadline, not a hard one.** On a heavy night some deadlines are impossible. A hard constraint would then return no plan at all; a weighted one returns the least-late plan and shows the late stops, as the preview already does.
- **Add `not_before` (optional, per site).** For example a church lot that shouldn't be plowed while cars are still parked for evening service. Arriving early costs waiting time. It is never a violation.
- **Add a depot** (section 5).
- **Equipment** (loader sites, salt-only trucks) is out of v2. In the demo data, loader yards already sit on their own route. Mixing equipment in one route needs truck types, and no one has asked for that yet.

## 2. Algorithm

**Per route** (what one truck does), keep the current construction and local search, plus:

1. Or-opt (segment moves of 2 to 3 stops, either orientation), run only after 2-opt and relocate stall. **Shipped.**
2. A time budget (4 s default, best-so-far returned). **Shipped.** Before this, a 200-stop route could block the request for 9 s, close to the function limit.
3. Multi-start is already partly there (every top-tier opener is tried). Adding 3 to 5 randomized restarts is the next cheap win for 30 to 80 stops. Measure first; don't assume.

**Several trucks** ("split these 60 lots across 3 trucks"):

- Construction by **sweep** around the depot, or by **parallel cheapest insertion**, balancing total minutes (not stop count) across trucks.
- Then the same per-route local search, plus inter-route **relocate** and **exchange** moves.
- This is a new feature with its own UI: a "Plan all routes" screen, previewed and accepted like Suggest order. It does not change Suggest order on one route.

Not recommended for now: LKH, OR-Tools or a commercial VRP. They are a native dependency on Vercel Hobby, a lot to operate, and at 5 to 80 stops a route the gains over a good local search are small.

## 3. Distances

Straight-line × 1.3 is wrong where the road network bends. The Rocky River valley, the lake shore and I-90 crossings in Lakewood are all places it misleads. Plan:

- **Pilot: OpenRouteService (decided by Flip, Nov 11).** Its free tier includes a Matrix API (N×N durations for driving-hgv or driving-car) with a daily request quota that easily covers a pilot. Each Suggest order or re-plan is one matrix call per route; the cache below keeps repeats free. The API key is a server env var (`ORS_API_KEY`) and is never sent to the browser.
- **Later: self-hosted OSRM** (an Ohio extract from Geofabrik, `table` service) if usage outgrows the ORS free tier. The router sits behind one small interface (`matrix(points) -> minutes[][]`), so swapping it is a config change, not a rewrite.
- **Straight-line × 1.3 is acceptable for the first pilot** (also Flip's call), so road times are an improvement, not a blocker.
- **Fallback, always:** when the matrix service fails or misses a point, use today's straight-line estimate for those pairs. The UI keeps saying "estimates" unless every pair came from the router.
- **Cache:** one matrix per (tenant, set of site ids), keyed by a hash of the sorted coordinates. Lots don't move, so it is valid until a site is re-pinned. Store it in a table or `app_setting` JSON. 80 stops is 6,400 numbers, about 25 KB.

## 4. Time windows

- `open_by`: unchanged, weighted at 5 (see 1).
- `not_before`: a new optional field in `site.service_window` (it is already JSON, so **no migration**). The clock waits until it opens.
- The preview already lists late stops; add early waits the same way.

## 5. Depot

- New company setting: **yard location** (address plus geocoded lat/lon). There is already a salt-delivery yard address; reuse it and geocode it once.
- Suggest order gets "Start from the yard" and "End at the yard" checkboxes. Both default on when a yard is set.
- The yard is a stop with 0 service minutes, the same as the truck's position in mid-storm re-plan, so the engine needs no new concept.
- "Keep the first stop first" stays for companies with no yard set.

## 6. UX

Unchanged rules:

- The preview shows each stop's ETA, drive time saved and the late count.
- Nothing saves until "Use this order".
- Mid-storm re-plan uses the same engine from the truck's latest GPS.

Additions:

- The source of the drive times ("road times" or "straight-line estimates").
- Waits for `not_before`.

## 7. Limits

| Stops | Today (measured, this machine) | Plan |
|---|---|---|
| 5 to 10 | under 5 ms | as is |
| 30 | about 15 ms | as is, plus restarts |
| 80 | about 0.5 s | as is; matrix fetch about 0.3 s from OSRM |
| 200 | about 5 s, budget-bound | budget 4 s; suggest splitting the route |

If the router is down or slow (over 3 s), use straight-line for that request. If the cached matrix is stale (a site was re-pinned), refetch only the rows for that site.

## 8. Out of scope for v2

Live traffic, truck turn restrictions, and automatically splitting one route into two trucks. The multi-truck planner above is opt-in and previewed; it never splits a route by itself.

## Comparison (slice 1)

From `pnpm --filter @flake/core exec tsx scripts/compare-routing.ts`, which is deterministic. Each cell is drive minutes / late stops.

| Route | Stops | As entered | Basic (before) | With Or-opt (now) |
|---|---|---|---|---|
| demo West Lakewood | 9 | 18 / 1 | 15 / 0 | 15 / 0 |
| demo East Lakewood | 9 | 35 / 0 | 20 / 0 | 20 / 0 |
| demo Rocky River | 6 | 18 / 0 | 16 / 0 | 16 / 0 |
| random, seed 1 | 80 | 639 / 13 | 235 / 8 | 230 / 8 |
| random, seed 2 | 80 | 692 / 14 | 241 / 10 | **219** / 10 |
| random, seed 3 | 80 | 616 / 15 | 225 / 11 | 224 / 11 |
| random, seed 1 | 200 | 1617 / 29 | 349 / 25 (4.9 s) | 349 / 25 (4.2 s) |
| random, seed 3 | 200 | 1658 / 37 | 370 / 32 (9.0 s) | 372 / 32 (5.1 s) |

Summary:

- The demo routes are already optimal under the straight-line model. Their real gain will come from road distances (slice 3), not the search.
- On 80-stop routes Or-opt saves up to 9% of driving.
- At 200 stops it matches the old search within 0.5% and caps the wait at about 5 s instead of 9.

Missed windows don't change, because these instances have deadlines that no order can meet.

## Slices (implementation tickets to file)

1. **Or-opt and a time budget.** Done in this change, with unit tests in `packages/core/test/routing-oropt.test.ts`.
2. **Yard location and depot start/end.** Done (issue 64). Settings, Company has a yard address, geocoded once when saved (`tenant.yard`). Each route has "Start and end at the yard", on by default (`route.yard_trip`, migration `20261111200000_yard.sql`). Suggest order plans out from the yard and back; mid-storm re-plan heads back to it.
3. **Road-time matrix through OpenRouteService.** Done (issue 65). `ORS_API_KEY` on Vercel (free tier, set by STAR). `RouteMatrix` provider (live: ORS Matrix, driving-car, 4 s timeout, up to 50 points; mock for tests; none without a key). Matrices are cached 30 days in `cached_lookup` per set of points, so a route's repeat Suggest costs nothing. Mid-storm re-plan uses road times between lots and the yard; the leg from the truck's moving position stays an estimate so every press isn't a new call. Any failure, a quota answer or more than 50 points plans on straight-line estimates, and the preview says which it used. Watch the free plan's Matrix quota in the ORS dashboard; it is separate from, and smaller than, the directions quota.
4. **`not_before` windows.** Site editor field and engine waits. About half a day.
5. **Randomized restarts for 30 to 80 stops.** Done (issue 67). Measured with `scripts/measure-restarts.ts` (8 seeded routes per size):

   | Stops | Restarts | Mean drive min | Mean wait | Routes improved |
   |---|---|---|---|---|
   | 30 | 0 / 5 / 10 | 116.6 / 116.4 / 114.8 | 21 / 94 / 160 ms | - / 1 of 8 / 2 of 8 |
   | 50 | 0 / 5 / 10 | 167.0 / 166.1 / 166.0 | 0.1 / 0.5 / 0.8 s | - / 2 of 8 / 2 of 8 |
   | 80 | 0 / 5 / 10 | 225.6 / 222.9 / 223.5 | 0.5 / 2.3 / 3.8 s | - / 5 of 8 / 4 of 8 |

   1 to 1.5% less driving, never worse, no change in late stops. On by default (5 restarts) up to 50 stops, where it adds under half a second; off above 50, where the wait isn't worth about 1%.
6. **Plan all routes (multi-truck).** Sweep or insertion plus inter-route moves, with a preview screen. About 3 to 4 days.

## Decisions

- **Road distances (Flip, Nov 11):** no paid server yet. Use the OpenRouteService free tier, switch to OSRM only if usage grows. Straight-line × 1.3 is fine for the first pilot.
- **Still open:** should start-and-end-at-the-yard default on once a yard is set? This doc assumes yes.

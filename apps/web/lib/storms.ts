import { and, asc, asService, contract, crew_member, customer, desc, driver_position, eq, inArray, invoice_draft, problem_report, route, route_stop, run_stop, serviceDb, site, site_pin, sql, storm, storm_run, tenant, trigger_alert, truck, visit, visit_photo, visitNotVoided, withUser, sms_consent, sub_company, type Tx } from '@flake/db';
import { CREW_SUBJECT } from '@flake/core/messages';
import { clock12 } from './labels';
import { isLate, liveContracts, localHm } from '@flake/core/time';
import { replanFrom } from '@flake/core/routing';
import { z } from 'zod';
import { stormCreate, runStopPatch, stormNotify } from '@flake/contracts';
import { HttpError } from './http';
import { baseUrl } from './env';
import { enqueue } from './jobs';
import { canTextFrom, notifyParty, shortLink } from './messaging';
import { retiredLinkKey } from './driver';
import { setSetting } from './providers';
import { decryptToken, encryptToken, hashToken, newToken } from './tokens';
import { latestSnapshotIds, stormWeather, tenantWeatherHeader } from './weather';
import { roadTimes } from './road-times';
import { generateDrafts } from './billing';
import { log } from './log';
import { requireCoveredSubs } from './subs';
import { stampStormBranch, yardForRoute } from './branches';

export interface Ctx { userId: string; tenantId: string; branchIds?: string[] | null }

const FAR_FUTURE_DAYS = 14;

function newLink() {
  const token = newToken();
  return { token, hash: hashToken(token), enc: encryptToken(token), expires: new Date(Date.now() + FAR_FUTURE_DAYS * 86400000).toISOString() };
}

/** Snapshots master routes into runs. "Publish, then move": the list is never rebuilt after this. */
/**
 * Lots whose customer declined the quote and that have no signed contract (issue 218). They stay off new storms and
 * Plan all, so no one plows them for free. A lot with no quote at all (a handshake customer) still goes, flagged as before.
 */
export async function declinedLots(tx: Tx, siteIds: string[]): Promise<Set<string>> {
  if (!siteIds.length) return new Set();
  const rows = await tx.select({ id: contract.site_id }).from(contract)
    .where(and(inArray(contract.site_id, siteIds), eq(contract.status, 'declined'), sql`not exists (select 1 from contract k where k.site_id = ${contract.site_id} and k.status = 'accepted')`));
  return new Set(rows.map((r) => r.id));
}

export async function createStorm(ctx: Ctx, raw: z.input<typeof stormCreate>) {
  const input = { ...raw, routeIds: [...new Set(raw.routeIds ?? [])], crewAssignments: raw.crewAssignments ?? {}, skipBusy: raw.skipBusy ?? false };
  const snapshotIds = await latestSnapshotIds(ctx.tenantId);
  return withUser(ctx.userId, async (tx) => {
    let alertSnapshotIds: string[] = [];
    if (input.triggerAlertId) {
      const [a] = await tx.select().from(trigger_alert).where(eq(trigger_alert.id, input.triggerAlertId));
      if (!a) throw new HttpError(404, 'Alert not found');
      if (a.status !== 'open') throw new HttpError(409, 'This alert was already handled.', 'alert_handled');
      alertSnapshotIds = a.snapshot_ids;
      // Conditional, so a double tap on Dispatch makes one storm, not two.
      const took = await tx.update(trigger_alert).set({ status: 'dispatched' }).where(and(eq(trigger_alert.id, a.id), eq(trigger_alert.status, 'open'))).returning({ id: trigger_alert.id });
      if (!took.length) throw new HttpError(409, 'This alert was already handled.', 'alert_handled');
    }
    // One new storm at a time per company, so two people starting storms at once can't both miss each other's lots.
    await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${`new_storm:${ctx.tenantId}`}))`);
    // A lot already live on another storm would get two route links and two trucks (issue 24).
    const busy = await tx.select({ site_id: run_stop.site_id, label: site.label, storm: storm.name }).from(run_stop)
      .innerJoin(storm_run, eq(storm_run.id, run_stop.storm_run_id)).innerJoin(storm, eq(storm.id, storm_run.storm_id)).innerJoin(site, eq(site.id, run_stop.site_id))
      .where(eq(storm.status, 'active'));
    const busyIds = new Set(busy.map((b) => b.site_id));
    const plans: { r: typeof route.$inferSelect; chosen: { site_id: string; sub_company_id: string | null }[] }[] = [];
    const taken = new Set<string>();
    const clash: typeof busy = [];
    const leftDeclined = new Set<string>();
    for (const routeId of input.routeIds) {
      const [r] = await tx.select().from(route).where(eq(route.id, routeId));
      if (!r) throw new HttpError(404, 'Route not found');
      if (r.archived_at) throw new HttpError(409, `${r.name} is archived. Restore it on Routes to use it in a storm.`, 'route_archived');
      // Retired sites stay on old storms but don't join new ones.
      const stops = await tx.select({ site_id: route_stop.site_id, sub_company_id: site.sub_company_id }).from(route_stop).innerJoin(site, eq(site.id, route_stop.site_id)).where(and(eq(route_stop.route_id, routeId), eq(site.active, true))).orderBy(asc(route_stop.seq));
      // A lot on two of the chosen routes goes on the first one only, so it isn't plowed twice (issue 26).
      const declined = await declinedLots(tx, stops.map((x) => x.site_id));
      for (const x of stops) if (declined.has(x.site_id)) leftDeclined.add(x.site_id);
      const chosen = (input.siteIds ? stops.filter((x) => input.siteIds!.includes(x.site_id)) : stops).filter((x) => !taken.has(x.site_id) && !declined.has(x.site_id));
      for (const x of chosen) {
        taken.add(x.site_id);
        if (busyIds.has(x.site_id)) clash.push(busy.find((b) => b.site_id === x.site_id)!);
      }
      plans.push({ r, chosen });
    }
    // From an alert, lots already being plowed are simply left out: the running storm is handling them.
    if (clash.length && !input.skipBusy && !input.triggerAlertId) {
      const names = clash.slice(0, 3).map((c) => c.label).join(', ') + (clash.length > 3 ? ` and ${clash.length - 3} more` : '');
      throw new HttpError(409, `${clash.length === 1 ? 'This lot is' : `${clash.length} lots are`} already on ${clash[0]!.storm}, which is still running: ${names}. Close that storm first, or start this one without ${clash.length === 1 ? 'it' : 'them'}.`, 'busy_sites');
    }
    // Lots given to a sub company (issue 226) go on that sub's own run, unless the route's driver already works for it.
    const crewFor = (r: typeof route.$inferSelect) => (r.id in input.crewAssignments ? input.crewAssignments[r.id] : r.default_crew_id) ?? null;
    const routeCrew = await crewCompanies(tx, plans.map((x) => crewFor(x.r)));
    const subLots = new Map<string, { site_id: string }[]>();
    for (const plan of plans) {
      const mine = routeCrew.get(crewFor(plan.r) ?? '') ?? null;
      plan.chosen = plan.chosen.filter((x) => {
        if (!x.sub_company_id || x.sub_company_id === mine || busyIds.has(x.site_id)) return true;
        subLots.set(x.sub_company_id, [...(subLots.get(x.sub_company_id) ?? []), x]);
        return false;
      });
    }
    const subRuns = await subDrivers(tx, [...subLots.keys()]);
    // The insurance block, when the company turned it on: no lapsed sub goes out on a run.
    await requireCoveredSubs(tx, ctx.tenantId, [...plans.filter((x) => x.chosen.some((c) => !busyIds.has(c.site_id))).map((x) => crewFor(x.r)), ...subRuns.values()]);
    const [s] = await tx.insert(storm).values({
      tenant_id: ctx.tenantId,
      name: input.name,
      started_at: new Date().toISOString(),
      trigger_alert_id: input.triggerAlertId ?? null,
      forecast_snapshot_ids: [...new Set([...alertSnapshotIds, ...snapshotIds])],
    }).returning();
    const runs = [];
    for (const { r, chosen: all } of plans) {
      const routeId = r.id;
      const chosen = all.filter((x) => !busyIds.has(x.site_id));
      if (!chosen.length) continue;
      const link = newLink();
      // A driver the office cleared stays cleared; only a route nobody touched falls back to its usual driver.
      const crewId = routeId in input.crewAssignments ? input.crewAssignments[routeId] : r.default_crew_id;
      const [run] = await tx.insert(storm_run).values({
        tenant_id: ctx.tenantId, storm_id: s!.id, route_id: routeId, crew_id: await activeCrew(tx, crewId), truck_id: await activeTruck(tx, r.default_truck_id),
        link_token_hash: link.hash, link_token_enc: link.enc, link_expires_at: link.expires,
      }).returning();
      await tx.insert(run_stop).values(chosen.map((x, i) => ({ tenant_id: ctx.tenantId, storm_run_id: run!.id, site_id: x.site_id, seq: i + 1 })));
      runs.push(run!);
    }
    for (const [subId, lots] of subLots) {
      const link = newLink();
      const [run] = await tx.insert(storm_run).values({
        tenant_id: ctx.tenantId, storm_id: s!.id, route_id: null, crew_id: subRuns.get(subId) ?? null,
        link_token_hash: link.hash, link_token_enc: link.enc, link_expires_at: link.expires,
      }).returning();
      await tx.insert(run_stop).values(lots.map((x, i) => ({ tenant_id: ctx.tenantId, storm_run_id: run!.id, site_id: x.site_id, seq: i + 1 })));
      runs.push(run!);
    }
    // An alert for lots this storm now covers has been acted on, so it leaves the dashboard (issue 5).
    if (runs.length) await settleAlerts(tx, s!.id);
    // The storm belongs to the branch its routes share (issue 227).
    if (runs.length) await stampStormBranch(tx, s!.id);
    if (!runs.length && clash.length) throw new HttpError(409, `Every lot on these routes is already on ${clash[0]!.storm}, which is still running. Add to that storm from its board instead.`, 'all_busy');
    if (!runs.length) throw new HttpError(422, leftDeclined.size ? 'There is nothing to plow: the only lots on these routes have a declined quote and no signed contract.' : 'There is nothing to plow: none of these sites is on a route. Add them to a route first.', 'no_stops');
    return { storm: s!, runs, left_out: clash.length, left_declined: leftDeclined.size };
  });
}

/** Open trigger alerts whose lots are all on this storm are marked dispatched. */
async function settleAlerts(tx: Tx, stormId: string) {
  await tx.execute(sql`
    update trigger_alert set status = 'dispatched'
    where status = 'open' and site_ids <@ (
      select coalesce(array_agg(rs.site_id), '{}') from run_stop rs join storm_run r on r.id = rs.storm_run_id where r.storm_id = ${stormId}
    )`);
}

/** Changing who drives what, or messaging about it, only makes sense while the storm is on. */
async function requireActiveStorm(tx: Tx, where: { stormId?: string; runId?: string }) {
  const [s] = where.stormId
    ? await tx.select({ status: storm.status }).from(storm).where(eq(storm.id, where.stormId))
    : await tx.select({ status: storm.status }).from(storm_run).innerJoin(storm, eq(storm.id, storm_run.storm_id)).where(eq(storm_run.id, where.runId!));
  if (!s) throw new HttpError(404, where.stormId ? 'Storm not found' : 'Run not found');
  if (s.status !== 'active') throw new HttpError(409, 'This storm is closed.', 'closed');
}

/** Each driver's sub company, for the drivers given. */
async function crewCompanies(tx: Tx, crewIds: (string | null)[]): Promise<Map<string, string | null>> {
  const ids = [...new Set(crewIds.filter((x): x is string => !!x))];
  if (!ids.length) return new Map();
  const rows = await tx.select({ id: crew_member.id, sub: crew_member.sub_company_id }).from(crew_member).where(inArray(crew_member.id, ids));
  return new Map(rows.map((r) => [r.id, r.sub]));
}

/** The driver a sub company's run goes to: its first active driver by name. The office can swap on the board. */
async function subDrivers(tx: Tx, subIds: string[]): Promise<Map<string, string>> {
  if (!subIds.length) return new Map();
  const rows = await tx.select({ id: crew_member.id, sub: crew_member.sub_company_id }).from(crew_member).where(and(inArray(crew_member.sub_company_id, subIds), eq(crew_member.active, true))).orderBy(asc(crew_member.name));
  const out = new Map<string, string>();
  for (const r of rows) if (r.sub && !out.has(r.sub)) out.set(r.sub, r.id);
  return out;
}

/** A route's usual driver may have left since it was set: a run gets nobody rather than someone who's gone. */
/** A truck still in service, or none: a retired truck isn't put on a new storm. */
async function activeTruck(tx: Tx, truckId: string | null | undefined): Promise<string | null> {
  if (!truckId) return null;
  const [t] = await tx.select({ id: truck.id }).from(truck).where(and(eq(truck.id, truckId), eq(truck.active, true)));
  return t?.id ?? null;
}

async function activeCrew(tx: Tx, crewId: string | null | undefined): Promise<string | null> {
  if (!crewId) return null;
  const [c] = await tx.select({ id: crew_member.id }).from(crew_member).where(and(eq(crew_member.id, crewId), eq(crew_member.active, true)));
  return c?.id ?? null;
}

/** A second pass over the same routes. Visits on it count as re-plows. */
export async function addPass(ctx: Ctx, stormId: string) {
  return withUser(ctx.userId, async (tx) => {
    // Locked, so a double tap on Plow again makes one new pass, not two copies of it.
    const [st] = await tx.select({ status: storm.status }).from(storm).where(eq(storm.id, stormId)).for('update');
    if (!st) throw new HttpError(404, 'Storm not found');
    if (st.status !== 'active') throw new HttpError(409, 'This storm is closed.', 'closed');
    const runs = await tx.select().from(storm_run).where(eq(storm_run.storm_id, stormId));
    if (!runs.length) throw new HttpError(404, 'Storm not found');
    const latest = Math.max(...runs.map((r) => r.pass));
    // A second tap moments later gets the pass the first one made, not another one on top.
    const fresh = runs.filter((r) => r.pass === latest && latest > 1 && Date.now() - Date.parse(r.created_at ?? '') < 15_000);
    if (fresh.length) return { pass: latest, runs: fresh };
    const pass = latest + 1;
    const created = [];
    for (const old of runs.filter((r) => r.pass === pass - 1)) {
      const stops = await tx.select().from(run_stop).where(eq(run_stop.storm_run_id, old.id)).orderBy(asc(run_stop.seq));
      // Every stop may have been moved off this run, and then there is nothing to plow again.
      if (!stops.length) continue;
      const link = newLink();
      const [run] = await tx.insert(storm_run).values({ tenant_id: ctx.tenantId, storm_id: stormId, route_id: old.route_id, crew_id: await activeCrew(tx, old.crew_id), truck_id: await activeTruck(tx, old.truck_id), pass, link_token_hash: link.hash, link_token_enc: link.enc, link_expires_at: link.expires }).returning();
      await tx.insert(run_stop).values(stops.map((x, i) => ({ tenant_id: ctx.tenantId, storm_run_id: run!.id, site_id: x.site_id, seq: i + 1 })));
      created.push(run!);
    }
    if (!created.length) throw new HttpError(409, 'There are no stops on the last pass to plow again.', 'no_stops');
    return { pass, runs: created };
  });
}

export async function publishStorm(ctx: Ctx, stormId: string) {
  const runs = await withUser(ctx.userId, async (tx) => {
    await requireActiveStorm(tx, { stormId });
    const list = await tx.select().from(storm_run).where(eq(storm_run.storm_id, stormId));
    if (!list.length) throw new HttpError(404, 'This storm has no runs');
    const unassigned = list.filter((r) => !r.crew_id);
    if (unassigned.length) throw new HttpError(409, `${unassigned.length} run(s) have no driver. Assign one first.`, 'no_crew');
    await tx.update(storm_run).set({ published_at: new Date().toISOString() }).where(and(eq(storm_run.storm_id, stormId), sql`published_at is null`));
    return list;
  });
  for (const r of runs) await enqueue('storm.publish_links', { tenantId: ctx.tenantId, runId: r.id }, { dedupeKey: `publish:${r.id}` });
  return { runs: runs.length };
}

export function runLink(run: { link_token_enc: string | null }) {
  return run.link_token_enc ? `${baseUrl()}/d/${decryptToken(run.link_token_enc)}` : null;
}

/** storm.publish_links: SMS when the tenant is verified and the driver consented, email always, QR on screen. */
export async function sendRunLink(tenantId: string, runId: string) {
  const db = serviceDb();
  const [row] = await db.select({ run: storm_run, crew: crew_member, route, tenant }).from(storm_run)
    .innerJoin(tenant, eq(tenant.id, storm_run.tenant_id))
    .leftJoin(crew_member, eq(crew_member.id, storm_run.crew_id))
    .leftJoin(route, eq(route.id, storm_run.route_id))
    .where(and(eq(storm_run.id, runId), eq(storm_run.tenant_id, tenantId)));
  if (!row?.crew) return;
  const stops = await db.select({ id: run_stop.id }).from(run_stop).where(and(eq(run_stop.tenant_id, tenantId), eq(run_stop.storm_run_id, runId)));
  const url = runLink(row.run);
  if (!url) return;
  const link = await shortLink(tenantId, new URL(url).pathname);
  // Drivers get texts only, never email (D16). Without texting, the board shows the QR code and copy link.
  await notifyParty(row.tenant, { phone: row.crew.phone_e164 }, {
    template: 'crew_link',
    vars: { route: row.route?.name ?? (row.crew.language === 'es' ? 'tu ruta' : 'your route'), n: stops.length, link },
    subject: CREW_SUBJECT[(row.crew.language === 'es' ? 'es' : 'en') as 'en' | 'es'].crew_link(row.tenant.name),
    lang: (row.crew.language === 'es' ? 'es' : 'en') as 'en' | 'es',
    key: `crew_link:${runId}:${row.crew.id}`,
    related: { storm_run_id: runId },
  });
}

/** Reassign, reorder or skip. Moving a stop tells both drivers; their PWAs also poll, so they see it within 10 s. */
export async function patchRunStop(ctx: Ctx, stopId: string, patch: z.infer<typeof runStopPatch>) {
  const out = await withUser(ctx.userId, async (tx) => {
    // Locked so a driver arriving on site can't slip in between this check and the move.
    const [stop] = await tx.select().from(run_stop).where(eq(run_stop.id, stopId)).for('update');
    if (!stop) throw new HttpError(404, 'Stop not found');
    await requireActiveStorm(tx, { runId: stop.storm_run_id });
    const set: Partial<typeof run_stop.$inferInsert> = { updated_at: new Date().toISOString() };
    let moved: { from: string; to: string } | null = null;
    if (patch.storm_run_id && patch.storm_run_id !== stop.storm_run_id) {
      if (stop.status === 'onsite') throw new HttpError(409, 'The driver is on site. Wait until they finish.', 'onsite');
      // A finished stop stays with the truck that did it, so pay and records credit the right driver.
      if (stop.status === 'done') throw new HttpError(409, 'That stop is already done. Add a pass to send a truck back.', 'done');
      const [target] = await tx.select().from(storm_run).where(eq(storm_run.id, patch.storm_run_id));
      const [source] = await tx.select().from(storm_run).where(eq(storm_run.id, stop.storm_run_id));
      if (!target || target.storm_id !== source!.storm_id) throw new HttpError(422, 'That run is not in this storm');
      await requireCoveredSubs(tx, ctx.tenantId, [target.crew_id]);
      const [{ max } = { max: 0 }] = await tx.select({ max: sql<number>`coalesce(max(seq), 0)` }).from(run_stop).where(eq(run_stop.storm_run_id, target.id));
      set.storm_run_id = target.id;
      set.seq = patch.seq ?? Number(max) + 1;
      set.previous_run_ids = [...stop.previous_run_ids, stop.storm_run_id];
      if (stop.status === 'enroute' || stop.status === 'problem') set.status = 'open';
      moved = { from: stop.storm_run_id, to: target.id };
    } else if (patch.seq !== undefined) {
      set.seq = patch.seq;
    }
    // The same rule as moving: skipping a lot someone is standing on, or one already done, would show "skipped" beside
    // a finished visit that still bills (found testing the storm rules).
    if (patch.status === 'skipped' && stop.status === 'onsite') throw new HttpError(409, 'The driver is on site. Wait until they finish.', 'onsite');
    if (patch.status === 'skipped' && stop.status === 'done') throw new HttpError(409, 'That stop is already done.', 'done');
    // Reopen is for a skipped lot. A done one already has its visit, so a driver arriving again would be refused as a
    // second visit; a new pass is how trucks go back.
    if (patch.status === 'open' && stop.status === 'onsite') throw new HttpError(409, 'The driver is on site. Wait until they finish.', 'onsite');
    if (patch.status === 'open' && stop.status === 'done') throw new HttpError(409, 'That stop is already done. Add a pass to send a truck back.', 'done');
    if (patch.status) set.status = patch.status;
    const [updated] = await tx.update(run_stop).set(set).where(eq(run_stop.id, stopId)).returning();
    return { stop: updated!, moved };
  });
  if (out.moved) {
    for (const runId of [out.moved.from, out.moved.to]) {
      await enqueue('notify.route_changed', { tenantId: ctx.tenantId, runId, stopId, at: out.stop.updated_at }, { dedupeKey: `moved:${stopId}:${runId}:${out.stop.updated_at}` });
    }
  }
  return out.stop;
}

/**
 * A customer calls mid-storm, or a lot that wasn't on tonight's routes needs doing. The stop goes to the end of
 * that truck's list and the driver's phone shows it on its next refresh, with a "Your route changed" notice.
 */
export async function addStopToRun(ctx: Ctx, runId: string, siteId: string) {
  const stop = await withUser(ctx.userId, async (tx) => {
    const [run] = await tx.select({ run: storm_run, storm }).from(storm_run).innerJoin(storm, eq(storm.id, storm_run.storm_id)).where(eq(storm_run.id, runId));
    if (!run) throw new HttpError(404, 'Run not found');
    if (run.storm.status !== 'active') throw new HttpError(409, 'This storm is closed.');
    // Two people adding the same lot at once would both pass the check below; one at a time per storm.
    await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${`add_stop:${run.storm.id}`}))`);
    const [st] = await tx.select({ id: site.id }).from(site).where(and(eq(site.id, siteId), eq(site.active, true)));
    if (!st) throw new HttpError(404, 'Site not found');
    const runs = await tx.select({ id: storm_run.id }).from(storm_run).where(eq(storm_run.storm_id, run.storm.id));
    const [already] = await tx.select({ id: run_stop.id }).from(run_stop).where(and(inArray(run_stop.storm_run_id, runs.map((r) => r.id)), eq(run_stop.site_id, siteId)));
    if (already) throw new HttpError(409, 'That site is already in this storm. Move it or reopen it on the board.', 'already_in_storm');
    const [{ max } = { max: 0 }] = await tx.select({ max: sql<number>`coalesce(max(seq), 0)` }).from(run_stop).where(eq(run_stop.storm_run_id, runId));
    const [created] = await tx.insert(run_stop).values({ tenant_id: ctx.tenantId, storm_run_id: runId, site_id: siteId, seq: Number(max) + 1 }).returning();
    return created!;
  });
  await enqueue('notify.route_changed', { tenantId: ctx.tenantId, runId, stopId: stop.id, at: stop.updated_at }, { dedupeKey: `added:${stop.id}` });
  return stop;
}

/** The office reorders one truck's stops. The phone shows the new order on its next refresh. */
export async function reorderRun(ctx: Ctx, runId: string, stopIds: string[]) {
  return withUser(ctx.userId, async (tx) => {
    const stops = await tx.select({ id: run_stop.id }).from(run_stop).where(eq(run_stop.storm_run_id, runId));
    if (!stops.length) throw new HttpError(404, 'Run not found');
    await requireActiveStorm(tx, { runId });
    const have = new Set(stops.map((x) => x.id));
    if (stopIds.length !== have.size || !stopIds.every((id) => have.has(id))) throw new HttpError(409, 'The route changed while you were editing. Reload and try again.', 'stale');
    const now = new Date().toISOString();
    for (const [i, id] of stopIds.entries()) await tx.update(run_stop).set({ seq: i + 1, updated_at: now }).where(eq(run_stop.id, id));
    return { ok: true };
  });
}

/**
 * Mid-storm re-plan for one truck: its open stops, ordered from where the truck last reported (or the lot it's on).
 * Nothing changes until the office accepts, through reorderRun.
 */
export async function planRun(ctx: Ctx & { timezone: string }, runId: string) {
  const data = await withUser(ctx.userId, async (tx) => {
    const stops = await tx.select({ stop: run_stop, site }).from(run_stop).innerJoin(site, eq(site.id, run_stop.site_id)).where(eq(run_stop.storm_run_id, runId)).orderBy(asc(run_stop.seq));
    if (!stops.length) throw new HttpError(404, 'Run not found');
    const [pos] = await tx.select().from(driver_position).where(eq(driver_position.storm_run_id, runId)).orderBy(desc(driver_position.device_at)).limit(1);
    const [trip] = await tx.select({ yard_trip: route.yard_trip, yard: tenant.yard, route_id: storm_run.route_id }).from(storm_run).leftJoin(route, eq(route.id, storm_run.route_id)).innerJoin(tenant, eq(tenant.id, storm_run.tenant_id)).where(eq(storm_run.id, runId));
    // A branch's routes start and end at that branch's yard (issue 227).
    const yardAt = trip ? await yardForRoute(tx, trip.route_id, trip.yard) : null;
    return { stops, pos, trip: trip ? { ...trip, yard: yardAt } : trip };
  });
  const onsite = data.stops.find((x) => x.stop.status === 'onsite');
  const open = data.stops.filter((x) => ['open', 'enroute', 'problem'].includes(x.stop.status));
  // With nobody on a lot and no GPS from the phone, start from the lot this truck finished last (issue 77), and say so.
  const lastDone = data.stops.filter((x) => x.stop.status === 'done').sort((a, b) => Date.parse(b.stop.updated_at ?? '') - Date.parse(a.stop.updated_at ?? ''))[0];
  // A phone only reports while the route page is on screen, so after a lot finished since, its last report can be the
  // yard where the driver opened the link. The newer of the two wins (found walking the app after issue 184).
  const posFresh = data.pos && !(lastDone && Date.parse(lastDone.stop.updated_at ?? '') > Date.parse(data.pos.device_at));
  const from = onsite ? { lat: onsite.site.lat, lon: onsite.site.lon, kind: 'lot' as const }
    : posFresh ?{ lat: data.pos.lat, lon: data.pos.lon, kind: 'truck' as const }
    : lastDone ? { lat: lastDone.site.lat, lon: lastDone.site.lon, kind: 'last_done' as const } : null;
  if (!from || open.length < 2) return { from: from?.kind ?? null, changed: false, order: data.stops.map((x) => x.stop.id), suggested: null, current: null };
  const endAt = data.trip?.yard && data.trip.yard_trip !== false ? { lat: data.trip.yard.lat, lon: data.trip.yard.lon } : null;
  // Road times between the lots and the yard, which don't move, so they're cached. The leg from the truck's latest
  // position is an estimate rather than a fresh router call on every press (issue 65).
  const road = await roadTimes([...open.map((x) => ({ lat: x.site.lat, lon: x.site.lon })), ...(endAt ? [endAt] : [])]);
  const plan = replanFrom(from, open.map((x) => ({ id: x.stop.id, lat: x.site.lat, lon: x.site.lon, priority: x.site.priority, open_by: x.site.service_window?.open_by ?? null, not_before: x.site.service_window?.not_before ?? null, sqft: x.site.area_confirmed_sqft ?? x.site.area_estimate_sqft })), { start: localHm(Date.now(), ctx.timezone).hm, endAt, legMinutes: road.legMinutes });
  // Done, skipped and on-site stops keep their places at the front; the re-planned open ones follow.
  const fixed = data.stops.filter((x) => !open.includes(x)).map((x) => x.stop.id);
  const label = new Map(data.stops.map((x) => [x.stop.id, x.site.label]));
  const named = (p: typeof plan.suggested) => ({ ...p, stops: p.stops.map((x) => ({ ...x, label: label.get(x.id) ?? '' })) });
  return { times_label: road.label, from: from.kind, from_label: from.kind === 'last_done' ? lastDone!.site.label : null, position_at: from.kind === 'truck' ? data.pos!.device_at : null, changed: plan.changed, order: [...fixed, ...plan.suggested.stops.map((x) => x.id)], suggested: named(plan.suggested), current: named(plan.current) };
}

export async function notifyRouteChanged(tenantId: string, runId: string, key: string) {
  const db = serviceDb();
  const [row] = await db.select({ run: storm_run, crew: crew_member, tenant }).from(storm_run).innerJoin(tenant, eq(tenant.id, storm_run.tenant_id)).leftJoin(crew_member, eq(crew_member.id, storm_run.crew_id)).where(and(eq(storm_run.id, runId), eq(storm_run.tenant_id, tenantId)));
  const url = row && runLink(row.run);
  // A route that was never sent to the crew hasn't changed for them: nothing goes out until the office confirms Send
  // routes to crew, which sends the whole route (issue 91).
  if (!row?.crew || !url || !row.run.published_at) return;
  const link = await shortLink(tenantId, new URL(url).pathname);
  await notifyParty(row.tenant, { phone: row.crew.phone_e164 }, { template: 'route_changed', vars: { link }, subject: CREW_SUBJECT[(row.crew.language === 'es' ? 'es' : 'en') as 'en' | 'es'].route_changed(row.tenant.name), lang: (row.crew.language === 'es' ? 'es' : 'en') as 'en' | 'es', key: `route_changed:${key}:${runId}`, related: { storm_run_id: runId } });
}

/** Each site gets one message per template per storm, however many times the button is pressed. */
export async function notifyCustomers(ctx: Ctx, stormId: string, input: z.infer<typeof stormNotify>) {
  const unreachable = await withUser(ctx.userId, async (tx) => {
    await requireActiveStorm(tx, { stormId });
    // Only lots on this storm: a stray id must not tell some other customer their plow is late.
    const onStorm = await tx.select({ site_id: run_stop.site_id }).from(run_stop).innerJoin(storm_run, eq(storm_run.id, run_stop.storm_run_id)).where(and(eq(storm_run.storm_id, stormId), inArray(run_stop.site_id, input.siteIds)));
    const ok = new Set(onStorm.map((x) => x.site_id));
    if (input.siteIds.some((id) => !ok.has(id))) throw new HttpError(422, 'Some of those sites are not on this storm.', 'not_on_storm');
    // The same test the send uses: texts turned on with a phone, or email turned on with an address. Anyone else gets
    // nothing, and the office should know that instead of reading "sending" (found in a QA pass).
    const who = await tx.select({ label: site.label, customer }).from(site).innerJoin(customer, eq(customer.id, site.customer_id)).where(inArray(site.id, input.siteIds));
    return who.filter(({ customer: c }) => !((c.notify_sms && c.phone_e164) || (c.email && c.notify_email !== false))).map((x) => x.label);
  });
  for (const siteId of input.siteIds) {
    await enqueue('notify.customer', { tenantId: ctx.tenantId, siteId, stormId, template: input.template, time: input.time ?? '', key: `${input.template}:${stormId}:${siteId}` }, { dedupeKey: `notify:${input.template}:${stormId}:${siteId}` });
  }
  return { queued: input.siteIds.length - unreachable.length, unreachable };
}

export async function notifyCustomer(p: { tenantId: string; siteId: string; template: 'late' | 'on_the_way' | 'done' | 'done_no_photo'; time?: string; link?: string; key: string; stormId?: string; visitId?: string }) {
  const db = serviceDb();
  const [row] = await db.select({ site, customer, tenant }).from(site).innerJoin(customer, eq(customer.id, site.customer_id)).innerJoin(tenant, eq(tenant.id, site.tenant_id)).where(and(eq(site.id, p.siteId), eq(site.tenant_id, p.tenantId)));
  if (!row) return;
  const subjects = { late: 'Running late', on_the_way: 'Your plow is on the way', done: 'Service completed', done_no_photo: 'Service completed' };
  await notifyParty(row.tenant, { phone: row.customer.notify_sms ? row.customer.phone_e164 : null, email: row.customer.email, wantsEmail: row.customer.notify_email }, {
    template: p.template,
    vars: { site: row.site.label, time: p.time ?? '', link: p.link ?? '' },
    subject: `${row.tenant.name}: ${subjects[p.template]} - ${row.site.label}`,
    key: p.key,
    related: { site_id: p.siteId, storm_id: p.stormId, visit_id: p.visitId },
  });
}

/** Closing is blocked while anyone is on site unless forced. Links stay alive for 24 h after close. */
export async function closeStorm(ctx: Ctx, stormId: string, force: boolean) {
  return (await closeStormOnce(ctx, stormId, force)).storm;
}

async function closeStormOnce(ctx: Ctx, stormId: string, force: boolean) {
  return withUser(ctx.userId, async (tx) => {
    const [s] = await tx.select().from(storm).where(eq(storm.id, stormId)).for('update');
    if (!s) throw new HttpError(404, 'Storm not found');
    // Closing twice (a double tap, or an old tab) must not reopen links or pull a billed storm back to closed.
    if (s.status !== 'active') return { storm: s, closedNow: false };
    const runs = await tx.select({ id: storm_run.id }).from(storm_run).where(eq(storm_run.storm_id, stormId));
    const ids = runs.map((r) => r.id);
    const onsite = ids.length ? await tx.select({ id: run_stop.id }).from(run_stop).where(and(inArray(run_stop.storm_run_id, ids), eq(run_stop.status, 'onsite'))) : [];
    if (onsite.length && !force) throw new HttpError(409, `${onsite.length} stop(s) still have a driver on site.`, 'onsite');
    const now = new Date();
    const snapshotIds = await latestSnapshotIds(ctx.tenantId);
    const [closed] = await tx.update(storm).set({ status: 'closed', closed_at: now.toISOString(), forecast_snapshot_ids: [...new Set([...(s.forecast_snapshot_ids ?? []), ...snapshotIds])] }).where(eq(storm.id, stormId)).returning();
    if (ids.length) await tx.update(storm_run).set({ link_expires_at: new Date(now.getTime() + 24 * 3600000).toISOString() }).where(inArray(storm_run.id, ids));
    // An alert that came in during the storm about its own lots was this storm. It doesn't stay up after the close.
    await settleAlerts(tx, stormId);
    return { storm: closed!, closedNow: true };
  });
}

/**
 * Close, then draft the invoices, so Billing review already has them when the office lands there (issue 48). The close
 * stands even if drafting fails: the billing page offers Generate drafts, and the failure is logged.
 */
export async function closeStormAndDraft(ctx: Ctx, stormId: string, force: boolean) {
  const { storm: closed, closedNow } = await closeStormOnce(ctx, stormId, force);
  let drafted: number | null = null;
  // Only the close that ended the storm drafts. A second tap gets the storm back and leaves Billing as it is.
  if (closedNow) {
    try {
      drafted = (await generateDrafts(ctx, stormId)).length;
    } catch (e) {
      log.error('storm.close_draft_failed', e, { tenant_id: ctx.tenantId, storm_id: stormId });
    }
  }
  return { ...closed, drafted };
}

/**
 * Closed by mistake, or more snow came: back to active, with route links live again. Only while nothing from it has
 * been approved for billing, so new work can't land beside an invoice that already went out. Drafts still in review
 * are dropped; closing again makes them fresh.
 */
export async function reopenStorm(ctx: Ctx, stormId: string) {
  return withUser(ctx.userId, async (tx) => {
    const [s] = await tx.select().from(storm).where(eq(storm.id, stormId)).for('update');
    if (!s) throw new HttpError(404, 'Storm not found');
    if (s.status === 'active') return s;
    // Billed with a bill past review can't take more work. Billed with nothing ever approved (only seasonal lots, say,
    // or every bill voided) can: nothing went out yet.
    const drafts = await tx.select({ status: invoice_draft.status }).from(invoice_draft).where(eq(invoice_draft.storm_id, stormId));
    if (drafts.some((d) => d.status !== 'draft' && d.status !== 'void')) throw new HttpError(409, s.status === 'billed' ? 'This storm is billed. Start a new storm for more work.' : 'Invoices from this storm were already approved. Start a new storm for more work.', s.status === 'billed' ? 'billed' : 'approved');
    const runs = await tx.select({ id: storm_run.id }).from(storm_run).where(eq(storm_run.storm_id, stormId));
    const stops = runs.length ? await tx.select({ site_id: run_stop.site_id }).from(run_stop).where(inArray(run_stop.storm_run_id, runs.map((r) => r.id))) : [];
    // The same rule as starting a storm: a lot can be live on one storm at a time.
    const busy = stops.length ? await tx.select({ name: storm.name }).from(run_stop).innerJoin(storm_run, eq(storm_run.id, run_stop.storm_run_id)).innerJoin(storm, eq(storm.id, storm_run.storm_id))
      .where(and(eq(storm.status, 'active'), inArray(run_stop.site_id, stops.map((x) => x.site_id)))).limit(1) : [];
    if (busy.length) throw new HttpError(409, `Some of these lots are on ${busy[0]!.name}, which is running now. Close it first.`, 'busy_sites');
    if (drafts.length) await asService(tx, ctx.tenantId, () => tx.delete(invoice_draft).where(and(eq(invoice_draft.storm_id, stormId), eq(invoice_draft.tenant_id, ctx.tenantId), eq(invoice_draft.status, 'draft'))));
    const [open] = await tx.update(storm).set({ status: 'active', closed_at: null }).where(eq(storm.id, stormId)).returning();
    if (runs.length) await tx.update(storm_run).set({ link_expires_at: new Date(Date.now() + FAR_FUTURE_DAYS * 86400000).toISOString() }).where(inArray(storm_run.id, runs.map((r) => r.id)));
    return open!;
  });
}

export async function revokeRunLink(ctx: Ctx, runId: string) {
  const link = newLink();
  const [old] = await withUser(ctx.userId, (tx) => tx.select({ hash: storm_run.link_token_hash, crewId: storm_run.crew_id }).from(storm_run).where(eq(storm_run.id, runId)));
  if (!old) throw new HttpError(404, 'Run not found');
  // A new link is live again. For someone who left the crew, that would undo taking their access away.
  if (old.crewId && !(await withUser(ctx.userId, (tx) => activeCrew(tx, old.crewId)))) throw new HttpError(422, 'That driver is no longer on your crew. Assign someone else first.', 'inactive_crew');
  // The phone holding the old link may have finished work it hasn't sent yet. See resolveToken.
  await setSetting(retiredLinkKey(old.hash), { runId, at: new Date().toISOString() });
  return withUser(ctx.userId, async (tx) => {
    const [r] = await tx.update(storm_run).set({ link_token_hash: link.hash, link_token_enc: link.enc, link_revoked_at: null, link_opened_at: null }).where(eq(storm_run.id, runId)).returning();
    if (!r) throw new HttpError(404, 'Run not found');
    return r;
  });
}

/** Which truck runs this route in this storm. Retired trucks can't be picked; none clears it. */
export async function assignRunTruck(ctx: Ctx, runId: string, truckId: string | null) {
  return withUser(ctx.userId, async (tx) => {
    if (truckId && !(await activeTruck(tx, truckId))) throw new HttpError(422, 'That truck is retired. Bring it back in Settings, Equipment, or pick another.', 'inactive_truck');
    const [r] = await tx.update(storm_run).set({ truck_id: truckId }).where(eq(storm_run.id, runId)).returning();
    if (!r) throw new HttpError(404, 'Run not found');
    return r;
  });
}

/** Assigns or swaps a run's driver. After publish, the new driver gets the link right away. */
export async function assignRunDriver(ctx: Ctx, runId: string, crewId: string) {
  const run = await withUser(ctx.userId, async (tx) => {
    await requireActiveStorm(tx, { runId });
    if (!(await activeCrew(tx, crewId))) throw new HttpError(422, 'That person is no longer on your crew.', 'inactive_crew');
    await requireCoveredSubs(tx, ctx.tenantId, [crewId]);
    // A new driver hasn't opened it yet, so the board asks again (issue 86). The same driver picked again keeps it.
    const [was] = await tx.select({ crew_id: storm_run.crew_id }).from(storm_run).where(eq(storm_run.id, runId));
    const [r] = await tx.update(storm_run).set({ crew_id: crewId, link_opened_at: sql`case when ${storm_run.crew_id} is not distinct from ${crewId} then ${storm_run.link_opened_at} end` }).where(eq(storm_run.id, runId)).returning();
    if (!r) throw new HttpError(404, 'Run not found');
    return { ...r, previous: was?.crew_id ?? null };
  });
  // A run changing hands mid-storm, for the after-storm crew report (issue 234). Done visits keep their own driver.
  if (run.previous && run.previous !== crewId) {
    const { logHandoff } = await import('./noshow');
    await logHandoff(ctx.tenantId, run.storm_id, { run_id: runId, from: run.previous, to: crewId, at: new Date().toISOString(), how: 'office' });
  }
  if (run.published_at) await enqueue('storm.publish_links', { tenantId: ctx.tenantId, runId }, { dedupeKey: `publish:${runId}:${crewId}` });
  return run;
}

/** Everything the live board shows. Reads as the signed-in user so RLS applies. */
export async function stormLive(ctx: Ctx & { timezone: string; role: 'owner' | 'dispatcher' | 'viewer' }, stormId: string) {
  const [company] = await serviceDb().select().from(tenant).where(eq(tenant.id, ctx.tenantId));
  const textable = company && canTextFrom(company)
    ? new Set((await serviceDb().select().from(sms_consent).where(eq(sms_consent.tenant_id, ctx.tenantId))).filter((c) => c.opted_in_at && !c.opted_out_at).map((c) => c.phone_e164))
    : new Set<string | null>();
  const data = await withUser(ctx.userId, async (tx) => {
    const [s] = await tx.select().from(storm).where(eq(storm.id, stormId));
    if (!s) throw new HttpError(404, 'Storm not found');
    const runs = await tx.select({ run: storm_run, crew: crew_member, route }).from(storm_run).leftJoin(crew_member, eq(crew_member.id, storm_run.crew_id)).leftJoin(route, eq(route.id, storm_run.route_id)).where(eq(storm_run.storm_id, stormId)).orderBy(asc(storm_run.pass), asc(storm_run.created_at));
    const runIds = runs.map((r) => r.run.id);
    const stops = runIds.length ? await tx.select({ stop: run_stop, site, customer }).from(run_stop).innerJoin(site, eq(site.id, run_stop.site_id)).innerJoin(customer, eq(customer.id, site.customer_id)).where(inArray(run_stop.storm_run_id, runIds)).orderBy(asc(run_stop.seq)) : [];
    const visits = await tx.select().from(visit).where(and(eq(visit.storm_id, stormId), visitNotVoided));
    // By the storm, not a list of thousands of visit ids (issue 228).
    const photoCounts = visits.length ? await tx.select({ visit_id: visit_photo.visit_id, n: sql<number>`count(*)::int`, after: sql<number>`(count(*) filter (where ${visit_photo.phase} = 'after'))::int` }).from(visit_photo).innerJoin(visit, eq(visit.id, visit_photo.visit_id)).where(eq(visit.storm_id, stormId)).groupBy(visit_photo.visit_id) : [];
    const problems = runIds.length ? await tx.select().from(problem_report).where(and(inArray(problem_report.storm_run_id, runIds), sql`resolved_at is null`)).orderBy(desc(problem_report.created_at)) : [];
    const positions = runIds.length ? await tx.selectDistinctOn([driver_position.storm_run_id]).from(driver_position).where(inArray(driver_position.storm_run_id, runIds)).orderBy(driver_position.storm_run_id, desc(driver_position.device_at)) : [];
    const pins = stops.length ? await tx.select().from(site_pin).where(inArray(site_pin.site_id, stops.map((x) => x.site.id))) : [];
    const crew = await tx.select({ id: crew_member.id, name: crew_member.name, kind: crew_member.kind }).from(crew_member).where(eq(crew_member.active, true)).orderBy(asc(crew_member.name));
    // The same rule billing uses: a renewal signed only for next winter doesn't cover this storm.
    // The contract in force at the storm's start, per lot: whether it bills, and what the driver can tick (issue 192).
    const inForce = stops.length ? liveContracts(await tx.select({ site_id: contract.site_id, season: contract.season, services: contract.services }).from(contract).where(and(eq(contract.status, 'accepted'), inArray(contract.site_id, stops.map((x) => x.site.id)))).orderBy(desc(contract.created_at)), s!.started_at, ctx.timezone) : [];
    const contracted = new Map(inForce.map((c) => [c.site_id, ((c.services ?? []) as { service: string }[]).map((x) => x.service)]));
    const trucks = await tx.select({ id: truck.id, name: truck.name }).from(truck).where(eq(truck.active, true)).orderBy(asc(truck.name));
    // A sub company's own run (issue 226) is named for the sub.
    const subIds = [...new Set(runs.filter((r) => !r.route && r.crew?.sub_company_id).map((r) => r.crew!.sub_company_id!))];
    const subNames = new Map((subIds.length ? await tx.select({ id: sub_company.id, name: sub_company.name }).from(sub_company).where(inArray(sub_company.id, subIds)) : []).map((x) => [x.id, x.name]));
    return { s: s!, runs, stops, visits, photoCounts, problems, positions, pins, crew, contracted, trucks, subNames };
  });
  const now = Date.now();
  const started = Date.parse(data.s.started_at);
  const alerts: { kind: string; text: string; at?: string | null; stop_id?: string; problem_id?: string }[] = [];
  // Late only means something while the crew is still out, and a lot on two passes is one late lot (issue 121).
  const lateSites = new Set<string>();
  // Where each driver stands, standby drivers and hand-offs (issue 234).
  const { askedPhones, driverStatus, handoffsFor, standbyFor } = await import('./noshow');
  const { fatigueFor } = await import('./fatigue');
  const tired = data.s.status === 'active' ? await fatigueFor(ctx.tenantId, [...new Set(data.runs.map((x) => x.crew?.id).filter((x): x is string => Boolean(x)))]) : new Map();
  const [asked, standby, handoffs, crewPhones] = await Promise.all([askedPhones(ctx.tenantId, stormId), standbyFor(ctx.tenantId, stormId), handoffsFor(ctx.tenantId, stormId), serviceDb().select({ id: crew_member.id, phone: crew_member.phone_e164, name: crew_member.name }).from(crew_member).where(eq(crew_member.tenant_id, ctx.tenantId))]);
  // Looked up by key, not by scanning: a 600-lot storm on its fifth pass has 3,000 stops and visits (issue 228).
  const group = <T, K>(rows: T[], key: (r: T) => K) => {
    const m = new Map<K, T[]>();
    for (const r of rows) {
      const k = key(r);
      const list = m.get(k);
      if (list) list.push(r);
      else m.set(k, [r]);
    }
    return m;
  };
  const stopsByRun = group(data.stops, (x) => x.stop.storm_run_id);
  const visitsByStop = group(data.visits, (v) => v.run_stop_id);
  const photosByVisit = new Map(data.photoCounts.map((p) => [p.visit_id, p]));
  const problemsBySite = group(data.problems, (p) => p.site_id);
  const positionByRun = new Map(data.positions.map((p) => [p.storm_run_id, p]));
  const boards = data.runs.map(({ run, crew, route: r }) => {
    const stops = (stopsByRun.get(run.id) ?? []).map(({ stop, site: st, customer: c }) => {
      const stopVisits = visitsByStop.get(stop.id) ?? [];
      const open = stopVisits.find((v) => !v.departed_device_at);
      const finished = stopVisits.filter((v) => v.departed_device_at).at(-1);
      const photos = stopVisits.reduce((n, v) => n + (photosByVisit.get(v.id)?.n ?? 0), 0);
      // Billing asks for an after photo; the board says when there isn't one, so the two agree (issue 75).
      const afterPhotos = finished ? (photosByVisit.get(finished.id)?.after ?? 0) : 0;
      const problem = (problemsBySite.get(st.id) ?? []).find((p) => p.storm_run_id === run.id || stop.previous_run_ids.includes(p.storm_run_id ?? ''));
      const late = data.s.status === 'active' && (stop.status === 'open' || stop.status === 'enroute') && isLate(st.service_window, started, now, ctx.timezone);
      if (late && !lateSites.has(st.id)) {
        lateSites.add(st.id);
        alerts.push({ kind: 'late', text: `${st.label} is past its ${clock12(st.service_window?.open_by)} deadline`, stop_id: stop.id });
      }
      return { id: stop.id, seq: stop.seq, status: stop.status, late, priority: st.priority, site_id: st.id, label: st.label, address: st.address, lat: st.lat, lon: st.lon, customer: c.name, no_contract: !data.contracted.has(st.id), services: data.contracted.get(st.id) ?? ['plow'], arrived_at: stop.status === 'onsite' ? (open?.arrived_device_at ?? null) : null, done_at: finished?.departed_device_at ?? null, depth_in: finished?.depth_in === null || finished?.depth_in === undefined ? null : Number(finished.depth_in), photos, after_photos: afterPhotos, problem: problem ? { kind: problem.kind, note: problem.note } : null };
    }).sort((a, b) => Number(b.late && b.priority <= 2) - Number(a.late && a.priority <= 2) || a.seq - b.seq);
    if (crew?.kind === 'sub' && run.published_at && !run.started_at && now - Date.parse(run.published_at) > 30 * 60000) {
      alerts.push({ kind: 'not_started', text: `${crew.name} has not started 30 minutes after publish`, at: run.published_at });
    }
    const pos = positionByRun.get(run.id);
    return {
      id: run.id, pass: run.pass, name: r?.name ?? (crew?.sub_company_id ? data.subNames.get(crew.sub_company_id) : null) ?? 'Run', truck_id: run.truck_id, crew: crew ? { id: crew.id, name: crew.name, kind: crew.kind, callout_reply: crew.callout_reply_at && Date.parse(crew.callout_reply_at) >= started ? crew.callout_reply : null, reachable: textable.has(crew.phone_e164), reach: { email: false, text: textable.has(crew.phone_e164) } } : null,
      // Hours on shift and rest before it (issue 235), while the storm runs.
      fatigue: crew ? tired.get(crew.id) ?? null : null,
      driver_status: driverStatus({ crew: Boolean(crew), reply: crew?.callout_reply_at && Date.parse(crew.callout_reply_at) >= started ? crew.callout_reply : null, asked: Boolean(crew?.phone_e164 && asked.has(crew.phone_e164)), opened: Boolean(run.link_opened_at) }),
      published_at: run.published_at, started_at: run.started_at, opened_at: run.link_opened_at, // The link exists from the start; showing a QR in person shouldn't need Publish, which messages the crew (issue 58).
      link: ctx.role !== 'viewer' ? runLink(run) : null, stops,
      position: pos ? { lat: pos.lat, lon: pos.lon, at: pos.device_at } : null,
    };
  });
  const siteById = new Map(data.stops.map((x) => [x.site.id, x.site]));
  for (const p of data.problems) {
    const site_ = siteById.get(p.site_id ?? '');
    const st = site_ ? { site: site_ } : undefined;
    alerts.push({ kind: 'problem', problem_id: p.id, text: `${p.kind} at ${st?.site.label ?? 'a site'}${p.note ? `: ${p.note}` : ''}`, at: p.created_at });
  }
  const all = boards.flatMap((b) => b.stops);
  const siteIds = [...new Set(data.stops.map((x) => x.site.id))];
  return {
    storm: data.s,
    crew: data.crew,
    trucks: data.trucks,
    runs: boards,
    alerts,
    standby,
    // Salt rationing for this storm (issue 232): its own setting, else the company's.
    ration: await (await import('./salt-policy')).stormRation(ctx.tenantId, stormId),
    // Who was asked, who answered, who never opened their link, and runs that changed hands, per driver (issue 234).
    crew_report: crewPhones.filter((c) => asked.has(c.phone ?? '') || boards.some((b) => b.crew?.id === c.id) || handoffs.some((h) => h.from === c.id || h.to === c.id)).map((c) => ({
      id: c.id, name: c.name, asked: asked.has(c.phone ?? ''),
      reply: data.runs.find((x) => x.crew?.id === c.id)?.crew?.callout_reply_at && Date.parse(data.runs.find((x) => x.crew?.id === c.id)!.crew!.callout_reply_at!) >= started ? data.runs.find((x) => x.crew?.id === c.id)!.crew!.callout_reply : null,
      no_show: boards.some((b) => b.crew?.id === c.id && (b.driver_status === 'no_reply' || b.driver_status === 'not_opened' || b.driver_status === 'declined')),
      handed_off: handoffs.filter((h) => h.from === c.id).length, took_over: handoffs.filter((h) => h.to === c.id).length,
    })),
    counts: { done: all.filter((x) => x.status === 'done').length, open: all.filter((x) => ['open', 'enroute', 'problem'].includes(x.status)).length, onsite: all.filter((x) => x.status === 'onsite').length, skipped: all.filter((x) => x.status === 'skipped').length, late: all.filter((x) => x.late).length, total: all.length },
    // That storm's weather, and while it runs, the live forecast for its lots too (issue 45).
    weather: data.s.status === 'active' ? await tenantWeatherHeader(ctx.tenantId, siteIds) : null,
    storm_weather: await stormWeather(ctx.tenantId, data.s, siteIds),
  };
}

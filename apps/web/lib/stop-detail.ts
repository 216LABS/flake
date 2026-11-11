import { and, asc, crew_member, customer, desc, eq, inArray, or, problem_report, route, run_stop, site, sql, storm, storm_run, visit, visit_correction, visit_photo, withUser } from '@flake/db';
import { HttpError } from './http';
import { signedUrl } from './blob';

/**
 * Everything the office can see about one stop on a storm: who did it, when, what they logged, where the phone was,
 * any problem the driver reported, and the photos (issue 41). Read as the signed-in user, so RLS decides. Driver
 * links are never part of it.
 */
export async function stopDetail(userId: string, stopId: string) {
  return withUser(userId, async (tx) => {
    const [row] = await tx.select({ stop: run_stop, site, customer, run: storm_run, route, crew: crew_member, storm })
      .from(run_stop)
      .innerJoin(site, eq(site.id, run_stop.site_id))
      .innerJoin(customer, eq(customer.id, site.customer_id))
      .innerJoin(storm_run, eq(storm_run.id, run_stop.storm_run_id))
      .innerJoin(storm, eq(storm.id, storm_run.storm_id))
      .leftJoin(route, eq(route.id, storm_run.route_id))
      .leftJoin(crew_member, eq(crew_member.id, storm_run.crew_id))
      .where(eq(run_stop.id, stopId));
    if (!row) throw new HttpError(404, 'Stop not found');
    // A visit belongs to this stop; one synced from a link that predates a move is matched by lot and storm.
    const visits = await tx.select({ visit, crew: crew_member.name }).from(visit).leftJoin(crew_member, eq(crew_member.id, visit.crew_id))
      .where(and(eq(visit.storm_id, row.storm.id), or(eq(visit.run_stop_id, stopId), and(eq(visit.site_id, row.site.id), sql`${visit.run_stop_id} is null`))))
      .orderBy(asc(visit.arrived_device_at));
    const ids = visits.map((v) => v.visit.id);
    const photos = ids.length ? await tx.select({ id: visit_photo.id, visit_id: visit_photo.visit_id, phase: visit_photo.phase, taken_at: visit_photo.taken_device_at, received_at: visit_photo.received_at })
      .from(visit_photo).where(inArray(visit_photo.visit_id, ids)).orderBy(asc(visit_photo.taken_device_at)) : [];
    const voidedRows = new Map(ids.length ? [...(await tx.select({ id: visit_correction.visit_id, v: visit_correction.new_value }).from(visit_correction).where(and(inArray(visit_correction.visit_id, ids), eq(visit_correction.field, 'voided'))).orderBy(asc(visit_correction.created_at)))
      .reduce((m, c) => m.set(c.id, c.v === true), new Map<string, boolean>())] : []);
    const runIds = [row.run.id, ...row.stop.previous_run_ids];
    const problems = await tx.select().from(problem_report).where(and(inArray(problem_report.storm_run_id, runIds), eq(problem_report.site_id, row.site.id))).orderBy(desc(problem_report.created_at));
    return {
      id: row.stop.id,
      status: row.stop.status,
      seq: row.stop.seq,
      storm: { id: row.storm.id, name: row.storm.name, status: row.storm.status },
      site: { id: row.site.id, label: row.site.label, address: row.site.address, lat: row.site.lat, lon: row.site.lon, priority: row.site.priority, open_by: row.site.service_window?.open_by ?? null },
      customer: { id: row.customer.id, name: row.customer.name },
      run: { name: row.route?.name ?? 'Run', pass: row.run.pass, crew: row.crew?.name ?? null },
      visits: visits.map(({ visit: v, crew }) => ({
        id: v.id,
        crew,
        arrived_at: v.arrived_device_at,
        departed_at: v.departed_device_at,
        services: v.services,
        depth_in: v.depth_in === null ? null : Number(v.depth_in),
        salt: v.salt,
        notes: v.notes,
        replow: Boolean(v.is_replow),
        voided: voidedRows.get(v.id) === true,
        gps: v.arrive_lat !== null && v.arrive_lon !== null ? { lat: v.arrive_lat, lon: v.arrive_lon, accuracy_m: v.arrive_acc_m, matched: v.gps_match } : null,
        photos: photos.filter((p) => p.visit_id === v.id).map((p) => ({ id: p.id, phase: p.phase, taken_at: p.taken_at, received_at: p.received_at })),
      })),
      problems: problems.map((p) => ({ id: p.id, kind: p.kind, note: p.note, at: p.created_at, resolved_at: p.resolved_at })),
    };
  });
}

/** A short-lived URL for one visit photo, if RLS lets this user see it. */
export async function officePhotoUrl(userId: string, photoId: string, thumb: boolean) {
  const [p] = await withUser(userId, (tx) => tx.select({ path: visit_photo.storage_path }).from(visit_photo).where(eq(visit_photo.id, photoId)));
  if (!p) return null;
  return (thumb && (await signedUrl('photos', `${p.path}.thumb.jpg`))) || signedUrl('photos', p.path);
}

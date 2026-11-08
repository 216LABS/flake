import { and, crew_member, customer, eq, isNotNull, proof_packet, visit_correction, run_stop, serviceDb, site, sql, storm, storm_run, tenant, visit, visit_photo, weather_snapshot } from '@flake/db';
import { fmtLocal, isLate } from '@flake/core/time';
import { billInstallments, chargeDraft } from './billing';
import { getBlob, putBlob } from './blob';
import { baseUrl } from './env';
import { drainJobs, enqueue, type JobHandler } from './jobs';
import { notifyParty, queueNotify, queuePush, sendEmail, sendOfficePush, sendSms, shortLink } from './messaging';
import { renderProof } from './proof';
import { setTollFreeStatus, submitTollFree } from './sms-admin';
import { notifyCustomer, notifyRouteChanged, sendRunLink } from './storms';
import { decryptToken, sha256Hex } from './tokens';
import { evaluateTenant, fetchAlerts, fetchCell, fetchNohrsc } from './weather';

async function photoLink(tenantId: string, visitId: string): Promise<string | null> {
  const [p] = await serviceDb().select().from(visit_photo).where(and(eq(visit_photo.tenant_id, tenantId), eq(visit_photo.visit_id, visitId), eq(visit_photo.phase, 'after'))).limit(1);
  return p ? shortLink(tenantId, `photo:${p.id}`) : null;
}

/**
 * The customer's message links the photos, and on a weak signal they land after the Done. Give them a while, then send
 * anyway: a message can't wait forever on a photo that may never come.
 */
async function holdForPhotos(p: { tenantId: string; visitId: string; photosComing?: number; queuedAt?: number }) {
  if (!p.photosComing || !p.queuedAt || Date.now() - p.queuedAt > 10 * 60000) return;
  const photos = await serviceDb().select({ id: visit_photo.id }).from(visit_photo).where(and(eq(visit_photo.tenant_id, p.tenantId), eq(visit_photo.visit_id, p.visitId)));
  if (photos.length < p.photosComing) throw Object.assign(new Error('Waiting for the driver\'s photos'), { retryAfterSeconds: 30, notAFailure: true });
}

/** The driver tapped Undo after this job was queued, so nothing should go out about this visit. */
async function isVoided(tenantId: string, visitId: string) {
  const rows = await serviceDb().select({ id: visit_correction.id }).from(visit_correction).where(and(eq(visit_correction.tenant_id, tenantId), eq(visit_correction.visit_id, visitId), eq(visit_correction.field, 'voided')));
  return rows.length > 0;
}

/** "Done" with an after-photo link. Waits briefly so the photo has a chance to finish uploading. */
async function visitDone(tenantId: string, visitId: string) {
  const db = serviceDb();
  const [row] = await db.select({ visit, tenant }).from(visit).innerJoin(tenant, eq(tenant.id, visit.tenant_id)).where(and(eq(visit.id, visitId), eq(visit.tenant_id, tenantId)));
  if (!row?.visit.departed_device_at || (await isVoided(tenantId, visitId))) return;
  const link = (await photoLink(tenantId, visitId)) ?? `${baseUrl()}/b/${row.tenant.slug}`;
  await notifyCustomer({ tenantId, siteId: row.visit.site_id, template: 'done', time: fmtLocal(row.visit.departed_device_at, row.tenant.timezone, { hour: 'numeric', minute: '2-digit' }), link, key: `done:${visitId}`, stormId: row.visit.storm_id, visitId });
}

/** report.completion: per-visit email to commercial and HOA customers within 30 minutes of Done. */
async function completionReport(tenantId: string, visitId: string) {
  const db = serviceDb();
  const [row] = await db.select({ visit, site, customer, tenant, crew: crew_member }).from(visit).innerJoin(site, eq(site.id, visit.site_id)).innerJoin(customer, eq(customer.id, site.customer_id)).innerJoin(tenant, eq(tenant.id, visit.tenant_id)).innerJoin(crew_member, eq(crew_member.id, visit.crew_id)).where(and(eq(visit.id, visitId), eq(visit.tenant_id, tenantId)));
  if (!row || row.customer.kind === 'residential' || !row.customer.email || !row.visit.departed_device_at || (await isVoided(tenantId, visitId))) return;
  const tz = row.tenant.timezone;
  const when = (iso: string) => fmtLocal(iso, tz);
  const photos = await db.select().from(visit_photo).where(and(eq(visit_photo.tenant_id, tenantId), eq(visit_photo.visit_id, visitId)));
  const links: string[] = [];
  for (const p of photos) links.push(`${p.phase}: ${await shortLink(tenantId, `photo:${p.id}`)}`);
  const salt = (row.visit.salt ?? []).map((s) => `${s.qty} ${s.unit}`).join(', ') || 'none recorded';
  const text = [
    `Service record for ${row.site.label}`,
    row.site.address,
    '',
    `Arrived: ${when(row.visit.arrived_device_at)}`,
    `Departed: ${when(row.visit.departed_device_at)}`,
    `Services: ${row.visit.services.join(', ') || 'unavailable'}`,
    `Depth reported: ${row.visit.depth_in === null ? 'unavailable' : `${row.visit.depth_in}"`}`,
    `Salt: ${salt}`,
    `Crew: ${row.crew.name}`,
    `GPS at arrival: ${row.visit.arrive_lat === null ? 'unavailable' : `${row.visit.arrive_lat}, ${row.visit.arrive_lon}`}`,
    '',
    ...(links.length ? ['Photos (links expire shortly after opening):', ...links] : ['No photos on this visit.']),
  ].join('\n');
  await sendEmail(row.tenant, { to: row.customer.email, template: 'completion_report', subject: `${row.tenant.name}: service record, ${row.site.label}`, text, key: `report:${visitId}`, related: { site_id: row.site.id, visit_id: visitId, storm_id: row.visit.storm_id } });
}

/** photo.process: confirm the stored bytes still match the hash and make a thumbnail. The original is never altered. */
async function processPhoto(tenantId: string, photoId: string) {
  const [p] = await serviceDb().select().from(visit_photo).where(and(eq(visit_photo.id, photoId), eq(visit_photo.tenant_id, tenantId)));
  if (!p) return;
  const bytes = await getBlob('photos', p.storage_path);
  if (!bytes) throw new Error('Photo missing from storage');
  if (sha256Hex(bytes) !== p.sha256) throw new Error('Photo hash mismatch');
  const sharp = (await import('sharp')).default;
  const thumb = await sharp(bytes).rotate().resize(800, 800, { fit: 'inside' }).jpeg({ quality: 78 }).toBuffer().catch(() => null);
  if (thumb) await putBlob('photos', `${p.storage_path}.thumb.jpg`, thumb, 'image/jpeg', { upsert: true });
}

/** storm.late_check: flags stops past their window and tells the dispatcher once per stop. */
export async function lateCheck() {
  const db = serviceDb();
  const active = await db.select({ storm, tenant }).from(storm).innerJoin(tenant, eq(tenant.id, storm.tenant_id)).where(eq(storm.status, 'active'));
  let late = 0;
  for (const { storm: s, tenant: t } of active) {
    const stops = await db.select({ stop: run_stop, site }).from(run_stop).innerJoin(storm_run, eq(storm_run.id, run_stop.storm_run_id)).innerJoin(site, eq(site.id, run_stop.site_id)).where(and(eq(storm_run.storm_id, s.id), eq(run_stop.tenant_id, t.id), sql`${run_stop.status} in ('open','enroute')`, isNotNull(storm_run.published_at)));
    for (const { site: st } of stops) {
      if (!isLate(st.service_window, Date.parse(s.started_at), Date.now(), t.timezone)) continue;
      late++;
      await queuePush(t.id, { title: 'Late site', body: `${st.label} is past its ${st.service_window?.open_by} deadline.`, url: `/storms/${s.id}`, key: `late:${s.id}:${st.id}`, related: { storm_id: s.id } });
      const owners = (await db.execute(sql`select u.email from membership m join auth.users u on u.id = m.user_id where m.tenant_id = ${t.id} and m.role in ('owner','dispatcher') and u.email is not null`)) as unknown as { email: string }[];
      for (const o of owners) {
        await queueNotify(t.id, { email: o.email }, { template: 'owner_alert', vars: { headline: `${st.label} is past its ${st.service_window?.open_by} deadline.`, link: `${baseUrl()}/storms/${s.id}` }, subject: `Late: ${st.label}`, key: `late_alert:${s.id}:${st.id}:${o.email}`, related: { storm_id: s.id } });
      }
    }
  }
  return { late };
}

/** A safety net: any completed commercial visit that somehow has no report job gets one. */
export async function queueMissedReports() {
  const db = serviceDb();
  const rows = await db.select({ id: visit.id, tenant_id: visit.tenant_id }).from(visit).where(sql`${visit.departed_device_at} > now() - interval '2 hours'`);
  for (const r of rows) await enqueue('report.completion', { tenantId: r.tenant_id, visitId: r.id }, { dedupeKey: `report:${r.id}` });
  await db.execute(sql`delete from job where done_at < now() - interval '14 days'`);
  const now = new Date();
  await enqueue('billing.installments', {}, { dedupeKey: `installments:${now.getUTCFullYear()}-${now.getUTCMonth() + 1}` });
  return { checked: rows.length };
}

export const JOB_HANDLERS: Record<string, JobHandler> = {
  'weather.fetch_cell': (p) => fetchCell(p.office, p.x, p.y),
  'weather.fetch_alerts': (p) => fetchAlerts(p.tenantId),
  'weather.nohrsc': async (p) => void (await fetchNohrsc(p.hours ?? 24)),
  'trigger.evaluate': async (p) => void (await evaluateTenant(p.tenantId)),
  'storm.publish_links': (p) => sendRunLink(p.tenantId, p.runId),
  'storm.late_check': async () => void (await lateCheck()),
  'notify.customer': (p) => notifyCustomer(p as Parameters<typeof notifyCustomer>[0]),
  'notify.visit_done': async (p) => {
    await holdForPhotos(p as Parameters<typeof holdForPhotos>[0]);
    await visitDone(p.tenantId, p.visitId);
  },
  'notify.push': (p) => sendOfficePush(p.tenantId, p.msg),
  'notify.party': async (p) => {
    const [t] = await serviceDb().select().from(tenant).where(eq(tenant.id, p.tenantId));
    if (t) await notifyParty(t, p.party, p.msg);
  },
  'notify.invoice_sms': async (p) => {
    const [t] = await serviceDb().select().from(tenant).where(eq(tenant.id, p.tenantId));
    if (t) await sendSms(t, { to: p.to, template: 'invoice', vars: p.vars, key: p.key, related: p.related });
  },
  'notify.route_changed': (p) => notifyRouteChanged(p.tenantId, p.runId, `${p.stopId}:${p.at}`),
  'billing.charge': (p) => chargeDraft(p.tenantId, p.draftId, p.attempt),
  'billing.installments': async () => void (await billInstallments()),
  'proof.render': async (p) => void (await renderProof(p as Parameters<typeof renderProof>[0])),
  'report.completion': async (p) => {
    await holdForPhotos(p as Parameters<typeof holdForPhotos>[0]);
    await completionReport(p.tenantId, p.visitId);
  },
  'photo.process': (p) => processPhoto(p.tenantId, p.photoId),
  'sms.tollfree_submit': (p) => submitTollFree(p.tenantId, decryptToken(p.ein)),
  'sms.mock_approve': (p) => setTollFreeStatus({ tenantId: p.tenantId }, 'approved', null),
};

export const runJobs = (limit?: number) => drainJobs(JOB_HANDLERS, { limit });

/** Right after a request queues something urgent. Only the urgent lane, so the request isn't kept busy with reports. */
export const runUrgentJobs = () => drainJobs(JOB_HANDLERS, { maxLane: 0, deadlineMs: 20_000 });

export { proof_packet, weather_snapshot };

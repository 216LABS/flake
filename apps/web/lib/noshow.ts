import { isLate } from '@flake/core/time';
import { and, app_setting, crew_member, eq, inArray, message_log, route, run_stop, serviceDb, site, sql, storm, storm_run, tenant } from '@flake/db';
import { renderTemplate } from '@flake/core/messages';
import { baseUrl } from './env';
import { HttpError } from './http';
import { enqueue } from './jobs';
import { notifyOffice, sendSms } from './messaging';
import { getSetting, setSetting } from './providers';

/**
 * Driver no-shows (issue 234): where each run's driver stands, an office alert when a run is still unanswered close to
 * its first open-by time, standby drivers a run can be offered to (first YES gets it), and a log of hand-offs.
 * Nothing here needs a schema change: standby lists, offers and hand-offs are app_setting records.
 */
export type DriverStatus = 'confirmed' | 'declined' | 'no_reply' | 'opened' | 'not_opened' | 'no_driver';

export const STATUS_WORD: Record<DriverStatus, string> = {
  confirmed: 'Confirmed', declined: 'Declined', no_reply: 'No reply', opened: 'Opened link', not_opened: 'Not opened', no_driver: 'No driver',
};

/** A reply to a call-out sent for this storm wins; then whether they opened the link. */
export function driverStatus(r: { crew: boolean; reply: string | null; asked: boolean; opened: boolean }): DriverStatus {
  if (!r.crew) return 'no_driver';
  if (r.reply === 'YES') return r.opened ? 'opened' : 'confirmed';
  if (r.reply === 'NO') return 'declined';
  if (r.opened) return 'opened';
  return r.asked ? 'no_reply' : 'not_opened';
}

const minutesKey = (tenantId: string) => `noshow_minutes:${tenantId}`;
export const noShowMinutes = async (tenantId: string) => (await getSetting<{ minutes: number }>(minutesKey(tenantId)))?.minutes ?? 30;
export const setNoShowMinutes = (tenantId: string, minutes: number) => setSetting(minutesKey(tenantId), { minutes });

const standbyKey = (tenantId: string, stormId: string) => `standby:${tenantId}:${stormId}`;
export const standbyFor = async (tenantId: string, stormId: string) => (await getSetting<{ crew_ids: string[] }>(standbyKey(tenantId, stormId)))?.crew_ids ?? [];
export const setStandby = (tenantId: string, stormId: string, crewIds: string[]) => setSetting(standbyKey(tenantId, stormId), { crew_ids: [...new Set(crewIds)] });

const handoffKey = (tenantId: string, stormId: string) => `handoffs:${tenantId}:${stormId}`;
export interface Handoff { run_id: string; from: string | null; to: string; at: string; how: 'office' | 'offer' }
export const handoffsFor = async (tenantId: string, stormId: string) => (await getSetting<Handoff[]>(handoffKey(tenantId, stormId))) ?? [];
/** A run changing hands, for the after-storm report. Appended in one statement, so two at once both land. */
export async function logHandoff(tenantId: string, stormId: string, h: Handoff) {
  const key = handoffKey(tenantId, stormId);
  await serviceDb().insert(app_setting).values({ key, value: [h] }).onConflictDoUpdate({ target: app_setting.key, set: { value: sql`${app_setting.value} || ${JSON.stringify([h])}::jsonb` } });
}

/** Phones asked "Can you run ...?" for this storm, from the message log. */
export async function askedPhones(tenantId: string, stormId: string): Promise<Set<string>> {
  const rows = await serviceDb().select({ to: message_log.to_addr }).from(message_log)
    .where(and(eq(message_log.tenant_id, tenantId), eq(message_log.template, 'call_out'), sql`${message_log.related}->>'storm_id' = ${stormId}`, sql`${message_log.status} not in ('blocked', 'failed')`));
  return new Set(rows.map((r) => r.to));
}

/**
 * Runs whose driver hasn't answered or opened their link within the company's warning time (30 min by default) of the
 * run's first open-by deadline: one office alert per run and driver. Runs with the late check every few minutes.
 */
export async function noShowCheck() {
  const db = serviceDb();
  const active = await db.select({ storm, tenant }).from(storm).innerJoin(tenant, eq(tenant.id, storm.tenant_id)).where(eq(storm.status, 'active'));
  let alerted = 0;
  for (const { storm: s, tenant: t } of active) {
    const runs = await db.select({ run: storm_run, crew: crew_member, route }).from(storm_run).leftJoin(crew_member, eq(crew_member.id, storm_run.crew_id)).leftJoin(route, eq(route.id, storm_run.route_id))
      .where(and(eq(storm_run.storm_id, s.id), sql`${storm_run.published_at} is not null`, sql`${storm_run.link_revoked_at} is null`));
    if (!runs.length) continue;
    const ahead = (await noShowMinutes(t.id)) * 60_000;
    const asked = await askedPhones(t.id, s.id);
    const started = Date.parse(s.started_at);
    for (const { run, crew, route: r } of runs) {
      const status = driverStatus({ crew: Boolean(crew), reply: crew?.callout_reply_at && Date.parse(crew.callout_reply_at) >= started ? crew.callout_reply : null, asked: Boolean(crew?.phone_e164 && asked.has(crew.phone_e164)), opened: Boolean(run.link_opened_at) });
      if (status === 'opened' || status === 'confirmed') continue;
      const open = await db.select({ window: site.service_window }).from(run_stop).innerJoin(site, eq(site.id, run_stop.site_id)).where(and(eq(run_stop.storm_run_id, run.id), sql`${run_stop.status} in ('open', 'enroute')`));
      if (!open.some((o) => isLate(o.window, started, Date.now() + ahead, t.timezone))) continue;
      const who = crew?.name ?? 'No driver';
      const name = r?.name ?? 'A route';
      alerted++;
      await notifyOffice(t, {
        subject: `${name}: ${STATUS_WORD[status].toLowerCase()}`,
        headline: `${name} has a lot due soon, and ${status === 'no_driver' ? 'no driver is assigned' : `${who} has ${status === 'declined' ? 'said no' : status === 'no_reply' ? 'not answered the call-out' : 'not opened their route link'}`}. Hand it off or offer it to your standby drivers.`,
        link: `${baseUrl()}/storms/${s.id}`, key: `noshow:${run.id}:${crew?.id ?? 'none'}`, related: { storm_id: s.id },
      });
    }
  }
  return { alerted };
}

const offerPrefix = (tenantId: string) => `offer:${tenantId}:`;
interface Offer { storm_id: string; run_id: string; route: string; crew_ids: string[]; sent_at: string; taken_by: string | null }

/** "Offer this run to standbys": a text to each standby driver who can be texted. The first YES gets the run. */
export async function offerRun(tenantId: string, runId: string) {
  const db = serviceDb();
  const [row] = await db.select({ run: storm_run, route, storm, tenant }).from(storm_run).innerJoin(storm, eq(storm.id, storm_run.storm_id)).innerJoin(tenant, eq(tenant.id, storm_run.tenant_id)).leftJoin(route, eq(route.id, storm_run.route_id)).where(and(eq(storm_run.id, runId), eq(storm_run.tenant_id, tenantId)));
  if (!row) throw new HttpError(404, 'Run not found');
  if (row.storm.status !== 'active') throw new HttpError(409, 'This storm is closed.', 'closed');
  const ids = (await standbyFor(tenantId, row.storm.id)).filter((id) => id !== row.run.crew_id);
  if (!ids.length) throw new HttpError(422, 'Mark someone as standby for this storm first.', 'no_standby');
  const crew = await db.select().from(crew_member).where(and(eq(crew_member.tenant_id, tenantId), inArray(crew_member.id, ids), eq(crew_member.active, true)));
  const name = row.route?.name ?? 'a route';
  const sentTo: string[] = [];
  for (const c of crew) {
    if (!c.phone_e164) continue;
    const ok = await sendSms(row.tenant, { to: c.phone_e164, template: 'run_offer', vars: { company: row.tenant.name, route: name }, lang: c.language === 'es' ? 'es' : 'en', key: `offer:${runId}:${c.id}:${Date.now()}`, related: { storm_id: row.storm.id } });
    if (ok) sentTo.push(c.id);
  }
  if (!sentTo.length) throw new HttpError(422, 'None of your standby drivers can be texted yet. Call them, or hand the run off yourself.', 'no_text');
  const offer: Offer = { storm_id: row.storm.id, run_id: runId, route: name, crew_ids: sentTo, sent_at: new Date().toISOString(), taken_by: null };
  await setSetting(`${offerPrefix(tenantId)}${runId}`, offer);
  return { sent: sentTo.length };
}

/**
 * A YES from a standby driver with an open offer (from the inbound text webhook). One conditional update claims the
 * offer, so two YESes at once give the run to one driver; the others hear it's taken. Offers last 3 hours.
 */
export async function claimOffer(t: typeof tenant.$inferSelect, crewId: string): Promise<string | null> {
  const db = serviceDb();
  const mine = (await db.select().from(app_setting).where(and(sql`${app_setting.key} like ${`${offerPrefix(t.id)}%`}`, sql`${app_setting.value}->'crew_ids' @> ${JSON.stringify([crewId])}::jsonb`, sql`(${app_setting.value}->>'sent_at')::timestamptz > now() - interval '3 hours'`)))
    .map((r) => ({ key: r.key, v: r.value as Offer })).sort((a, b) => a.v.sent_at.localeCompare(b.v.sent_at));
  // The oldest offer still open; if every one was taken by someone else, the newest, so they hear it's taken.
  const offer = mine.find((o) => !o.v.taken_by) ?? mine.filter((o) => o.v.taken_by !== crewId).at(-1);
  if (!offer) return null;
  const [took] = await db.update(app_setting).set({ value: sql`jsonb_set(${app_setting.value}, '{taken_by}', ${JSON.stringify(crewId)}::jsonb)` }).where(and(eq(app_setting.key, offer.key), sql`${app_setting.value}->>'taken_by' is null`)).returning({ key: app_setting.key });
  const [me] = await db.select().from(crew_member).where(eq(crew_member.id, crewId));
  const lang = me?.language === 'es' ? 'es' : 'en';
  if (!took) return renderTemplate('offer_taken', { company: t.name, route: offer.v.route }, lang);
  const [s] = await db.select({ status: storm.status }).from(storm).where(eq(storm.id, offer.v.storm_id));
  if (s?.status !== 'active') return null;
  const [before] = await db.select({ crew_id: storm_run.crew_id }).from(storm_run).where(eq(storm_run.id, offer.v.run_id));
  await db.update(storm_run).set({ crew_id: crewId, link_opened_at: null }).where(and(eq(storm_run.id, offer.v.run_id), eq(storm_run.tenant_id, t.id)));
  await enqueue('storm.publish_links', { tenantId: t.id, runId: offer.v.run_id }, { dedupeKey: `publish:${offer.v.run_id}:${crewId}` });
  await logHandoff(t.id, offer.v.storm_id, { run_id: offer.v.run_id, from: before?.crew_id ?? null, to: crewId, at: new Date().toISOString(), how: 'offer' });
  const others = await db.select().from(crew_member).where(and(eq(crew_member.tenant_id, t.id), inArray(crew_member.id, offer.v.crew_ids.filter((id) => id !== crewId))));
  for (const c of others) {
    if (c.phone_e164) await sendSms(t, { to: c.phone_e164, template: 'offer_taken', vars: { company: t.name, route: offer.v.route }, lang: c.language === 'es' ? 'es' : 'en', key: `offer_taken:${offer.v.run_id}:${c.id}:${offer.v.sent_at}`, related: { storm_id: offer.v.storm_id } });
  }
  await notifyOffice(t, { subject: `${offer.v.route}: ${me?.name ?? 'A standby driver'} took it`, headline: `${me?.name ?? 'A standby driver'} said yes and now has ${offer.v.route}. Their route link is on its way.`, link: `${baseUrl()}/storms/${offer.v.storm_id}`, key: `offer_won:${offer.v.run_id}:${crewId}` });
  return renderTemplate('offer_won', { company: t.name, route: offer.v.route }, lang);
}

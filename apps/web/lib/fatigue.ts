import { DEFAULT_FATIGUE, fatigue, type Fatigue, type FatigueLimits } from '@flake/core/fatigue';
import { crew_member, eq, inArray, serviceDb, sql, storm, storm_run, tenant, and } from '@flake/db';
import { baseUrl } from './env';
import { notifyOffice } from './messaging';
import { getSetting, setSetting } from './providers';

const key = (tenantId: string) => `fatigue:${tenantId}`;
export const fatigueLimits = async (tenantId: string): Promise<FatigueLimits> => ({ ...DEFAULT_FATIGUE, ...((await getSetting<Partial<FatigueLimits>>(key(tenantId))) ?? {}) });
export const setFatigueLimits = (tenantId: string, l: FatigueLimits) => setSetting(key(tenantId), l);

/**
 * Each driver's phone events over the last two days, across every storm, so a shift that ran from one storm into the
 * next is one shift (issue 235). The same events payroll counts: taps, positions, arrivals and departures.
 */
export async function fatigueFor(tenantId: string, crewIds: string[], now = Date.now()): Promise<Map<string, Fatigue>> {
  const out = new Map<string, Fatigue>();
  if (!crewIds.length) return out;
  const since = new Date(now - 48 * 3_600_000).toISOString();
  const ids = sql.join(crewIds.map((id) => sql`${id}::uuid`), sql`, `);
  const rows = (await serviceDb().execute(sql`
    with ev as (
      select r.crew_id, a.device_at as t from driver_action a join storm_run r on r.id = a.storm_run_id where r.tenant_id = ${tenantId}
      union all select r.crew_id, d.device_at from driver_position d join storm_run r on r.id = d.storm_run_id where r.tenant_id = ${tenantId}
      union all select v.crew_id, v.arrived_device_at from visit v where v.tenant_id = ${tenantId}
      union all select v.crew_id, v.departed_device_at from visit v where v.tenant_id = ${tenantId} and v.departed_device_at is not null
    )
    select crew_id, date_trunc('minute', t) as t from ev where crew_id in (${ids}) and t >= ${since} group by 1, 2`)) as unknown as { crew_id: string; t: string | Date }[];
  const limits = await fatigueLimits(tenantId);
  for (const id of crewIds) out.set(id, fatigue(rows.filter((r) => r.crew_id === id).map((r) => new Date(r.t).getTime()), now, limits));
  return out;
}

/** One office alert per driver, shift and threshold: a long shift, or too little rest before this one. */
export async function fatigueCheck() {
  const db = serviceDb();
  const active = await db.select({ storm, tenant }).from(storm).innerJoin(tenant, eq(tenant.id, storm.tenant_id)).where(eq(storm.status, 'active'));
  let alerted = 0;
  for (const { storm: s, tenant: t } of active) {
    const runs = await db.select({ crew_id: storm_run.crew_id }).from(storm_run).where(and(eq(storm_run.storm_id, s.id), sql`${storm_run.crew_id} is not null`));
    const ids = [...new Set(runs.map((r) => r.crew_id!))];
    if (!ids.length) continue;
    const [f, crew, limits] = await Promise.all([fatigueFor(t.id, ids), db.select({ id: crew_member.id, name: crew_member.name }).from(crew_member).where(inArray(crew_member.id, ids)), fatigueLimits(t.id)]);
    for (const c of crew) {
      const x = f.get(c.id);
      if (!x?.on || !x.shift_start) continue;
      if (x.long_shift) {
        alerted++;
        await notifyOffice(t, { subject: `${c.name}: ${limits.warn_hours}+ hours on`, headline: `${c.name} has been out ${x.on_hours} hours. Think about a break or a relief driver.`, link: `${baseUrl()}/storms/${s.id}`, key: `fatigue_long:${c.id}:${x.shift_start}`, related: { storm_id: s.id } });
      }
      if (x.short_rest) {
        alerted++;
        await notifyOffice(t, { subject: `${c.name}: short rest`, headline: `${c.name} started this shift after only ${x.rest_hours} hours off.`, link: `${baseUrl()}/storms/${s.id}`, key: `fatigue_rest:${c.id}:${x.shift_start}`, related: { storm_id: s.id } });
      }
    }
  }
  return { alerted };
}

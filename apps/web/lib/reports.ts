import { app_setting, eq, serviceDb, sql, type Tx } from '@flake/db';
import { hoursOf, saltOnHand, saltTons, shiftsFrom, type HoursRow, type StockEntry } from '@flake/core/reports';
import { fmtLocal, localHm, zonedDayStart } from '@flake/core/time';

const ymd = /^\d{4}-\d{2}-\d{2}$/;
const DAY = 86_400_000;

/** A pay period in the company's time zone. Defaults to the last 14 days, today included. */
export function period(from: string | undefined, to: string | undefined, tz: string) {
  const today = localHm(Date.now(), tz).date;
  const end = to && ymd.test(to) ? to : today;
  const start = from && ymd.test(from) && from <= end ? from : localHm(zonedDayStart(end, tz).getTime() - 13 * DAY, tz).date;
  const next = localHm(zonedDayStart(end, tz).getTime() + DAY + 3 * 3_600_000, tz).date;
  return { from: start, to: end, startAt: zonedDayStart(start, tz).toISOString(), endAt: zonedDayStart(next, tz).toISOString() };
}

type Period = ReturnType<typeof period>;
/** postgres.js hands back timestamps as Date objects. */
const ms = (v: unknown) => new Date(v as string).getTime();
const rowsOf = <T>(r: unknown) => (Array.isArray(r) ? r : ((r as { rows?: T[] }).rows ?? [])) as T[];

/**
 * Shifts from what each driver's phone sent: route taps, GPS fixes and visits, first to last,
 * split on a two-hour quiet gap. Times are the phone's own clock, rounded to the minute.
 */
export async function crewHours(tx: Tx, p: Period, tz: string): Promise<(HoursRow & { crewId: string })[]> {
  const ev = rowsOf<{ crew_id: string; storm_id: string; t: string; n: number }>(await tx.execute(sql`
    with ev as (
      select r.crew_id, r.storm_id, a.device_at as t from driver_action a join storm_run r on r.id = a.storm_run_id
      union all
      select r.crew_id, r.storm_id, d.device_at from driver_position d join storm_run r on r.id = d.storm_run_id
      union all
      select v.crew_id, v.storm_id, v.arrived_device_at from visit v
      union all
      select v.crew_id, v.storm_id, v.departed_device_at from visit v where v.departed_device_at is not null
    )
    select crew_id, storm_id, date_trunc('minute', t) as t, count(*)::int as n from ev
    where crew_id is not null and t >= ${p.startAt} and t < ${p.endAt}
    group by 1, 2, 3`));
  if (!ev.length) return [];
  const names = rowsOf<{ id: string; name: string; kind: 'employee' | 'sub' }>(await tx.execute(sql`select id, name, kind from crew_member`));
  const storms = rowsOf<{ id: string; name: string }>(await tx.execute(sql`select id, name from storm`));
  const done = rowsOf<{ crew_id: string; storm_id: string; t: string }>(await tx.execute(sql`
    select crew_id, storm_id, departed_device_at as t from visit
    where departed_device_at >= ${p.startAt} and departed_device_at < ${p.endAt}`));
  const groups = new Map<string, number[]>();
  for (const e of ev) {
    const k = `${e.crew_id}|${e.storm_id}`;
    groups.set(k, [...(groups.get(k) ?? []), ms(e.t)]);
  }
  const fmt = (ms: number) => fmtLocal(ms, tz, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
  const out: (HoursRow & { crewId: string; start: number })[] = [];
  for (const [k, times] of groups) {
    const [crewId, stormId] = k.split('|') as [string, string];
    const c = names.find((n) => n.id === crewId);
    const shifts = shiftsFrom(times);
    for (const s of shifts) {
      const stops = done.filter((d) => d.crew_id === crewId && d.storm_id === stormId && ms(d.t) >= s.start && ms(d.t) < s.end + 60_000).length;
      out.push({
        crewId, start: s.start, crew: c?.name ?? 'Removed crew member', kind: c?.kind ?? 'employee', storm: storms.find((x) => x.id === stormId)?.name ?? 'Storm',
        clockIn: fmt(s.start), clockOut: fmt(s.end), hours: hoursOf(s), stops,
        note: s.events === 1 ? 'Only one tap, so no length' : shifts.length > 1 ? 'Phone went quiet 2+ hours, so this is split' : '',
      });
    }
  }
  return out.sort((a, b) => a.crew.localeCompare(b.crew) || a.start - b.start).map(({ start: _start, ...r }) => r);
}

interface SaltVisit { at: string; storm: string; salt: { unit: string; qty: number }[] | null }

/** Each visit's salt, as corrected in billing review when it was. */
async function saltVisits(tx: Tx, since: string | null, until?: string): Promise<SaltVisit[]> {
  return rowsOf<SaltVisit>(await tx.execute(sql`
    select v.arrived_device_at as at, s.name as storm,
      coalesce((select c.new_value from visit_correction c where c.visit_id = v.id and c.field = 'salt' order by c.created_at desc limit 1), v.salt) as salt
    from visit v join storm s on s.id = v.storm_id
    where (v.salt is not null or exists (select 1 from visit_correction c where c.visit_id = v.id and c.field = 'salt'))
      and not exists (select 1 from visit_correction c where c.visit_id = v.id and c.field = 'voided' and c.new_value = 'true'::jsonb)
      and (${since}::timestamptz is null or v.arrived_device_at > ${since}::timestamptz)
      and (${until ?? null}::timestamptz is null or v.arrived_device_at < ${until ?? null}::timestamptz)
    order by v.arrived_device_at`)).map((v) => ({ ...v, at: new Date(v.at).toISOString() }));
}

const stockKey = (tenantId: string) => `salt_stock:${tenantId}`;

export async function stockEntries(tenantId: string): Promise<StockEntry[]> {
  const [row] = await serviceDb().select().from(app_setting).where(eq(app_setting.key, stockKey(tenantId)));
  return (row?.value?.entries ?? []) as StockEntry[];
}

/** Appends in one statement, so two people logging a delivery at once both count. */
export async function addStockEntry(tenantId: string, entry: StockEntry) {
  const key = stockKey(tenantId);
  const first = { entries: [entry] };
  await serviceDb().execute(sql`
    insert into app_setting (key, value) values (${key}, ${JSON.stringify(first)}::jsonb)
    on conflict (key) do update set value = jsonb_build_object('entries', coalesce(app_setting.value->'entries', '[]'::jsonb) || ${JSON.stringify([entry])}::jsonb)`);
}

export async function removeStockEntry(tenantId: string, id: string) {
  await serviceDb().execute(sql`
    update app_setting set value = jsonb_build_object('entries', coalesce((select jsonb_agg(e) from jsonb_array_elements(value->'entries') e where e->>'id' <> ${id}), '[]'::jsonb))
    where key = ${stockKey(tenantId)}`);
}

const tonsOfVisit = (v: SaltVisit) => (v.salt ?? []).reduce((n, e) => n + (saltTons(e.unit, Number(e.qty)) ?? 0), 0);

export async function saltReport(tx: Tx, tenantId: string, p: Period) {
  const entries = await stockEntries(tenantId);
  const lastCount = entries.filter((e) => e.kind === 'count').map((e) => e.at).sort().pop() ?? null;
  const sinceCount = await saltVisits(tx, lastCount);
  const stock = saltOnHand(entries, sinceCount.map((v) => ({ at: v.at, tons: tonsOfVisit(v) })));
  const inPeriod = await saltVisits(tx, new Date(Date.parse(p.startAt) - 1).toISOString(), p.endAt);
  const byStorm = new Map<string, { storm: string; visits: number; tons: number; applications: number }>();
  for (const v of inPeriod) {
    const r = byStorm.get(v.storm) ?? { storm: v.storm, visits: 0, tons: 0, applications: 0 };
    r.visits++;
    r.tons += tonsOfVisit(v);
    r.applications += (v.salt ?? []).filter((e) => saltTons(e.unit, 1) === null).reduce((n, e) => n + Number(e.qty), 0);
    byStorm.set(v.storm, r);
  }
  const storms = [...byStorm.values()].map((r) => ({ ...r, tons: Math.round(r.tons * 100) / 100 }));
  const used = storms.filter((s) => s.tons > 0);
  const perStorm = used.length ? used.reduce((n, s) => n + s.tons, 0) / used.length : 0;
  return {
    stock,
    entries: [...entries].sort((a, b) => b.at.localeCompare(a.at)).slice(0, 20),
    storms,
    stormsLeft: perStorm > 0 && stock.tons > 0 ? Math.floor(stock.tons / perStorm) : null,
  };
}

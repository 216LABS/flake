import { maintenanceStatus, meterNow, type MaintenanceStatus, type TruckUse } from '@flake/core/maintenance';
import { and, desc, eq, equipment_log, isNotNull, maintenance_item, sql, truck, type Tx } from '@flake/db';

export interface MaintenanceRow {
  id: string;
  truck_id: string;
  truck_name: string;
  name: string;
  every_hours: number | null;
  every_days: number | null;
  last_done_at: string | null;
  last_done_hours: number | null;
  status: MaintenanceStatus;
}

/** Each truck's latest meter reading and its storm runs: first Arrive to last Done on runs it was set on. */
export async function truckUse(tx: Tx): Promise<Map<string, TruckUse>> {
  const readings = await tx.selectDistinctOn([equipment_log.truck_id], { truck_id: equipment_log.truck_id, hours: equipment_log.hours, at: equipment_log.at })
    .from(equipment_log).where(and(eq(equipment_log.kind, 'hours'), isNotNull(equipment_log.hours))).orderBy(equipment_log.truck_id, desc(equipment_log.at));
  const runs = (await tx.execute(sql`
    select sr.truck_id, min(v.arrived_device_at) as start, max(coalesce(v.departed_device_at, v.arrived_device_at)) as "end"
    from storm_run sr join run_stop rs on rs.storm_run_id = sr.id join visit v on v.run_stop_id = rs.id
    where sr.truck_id is not null
    group by sr.id, sr.truck_id`)) as unknown as { truck_id: string; start: string | Date; end: string | Date }[];
  const out = new Map<string, TruckUse>();
  const get = (id: string) => out.get(id) ?? (out.set(id, { reading: null, runs: [] }), out.get(id)!);
  for (const r of readings) get(r.truck_id).reading = { hours: Number(r.hours), at: r.at };
  for (const r of runs) get(r.truck_id).runs.push({ start: new Date(r.start).toISOString(), end: new Date(r.end).toISOString() });
  return out;
}

/** Every reminder on an active truck, with where it stands. Overdue first, then due soon. */
export async function listMaintenance(tx: Tx, now = new Date()): Promise<MaintenanceRow[]> {
  const rows = await tx.select({ m: maintenance_item, truck_name: truck.name }).from(maintenance_item).innerJoin(truck, eq(truck.id, maintenance_item.truck_id)).where(eq(truck.active, true));
  if (!rows.length) return [];
  const use = await truckUse(tx);
  const rank = { overdue: 0, soon: 1, ok: 2 } as const;
  return rows
    .map(({ m, truck_name }) => ({
      id: m.id, truck_id: m.truck_id, truck_name, name: m.name, every_hours: m.every_hours, every_days: m.every_days, last_done_at: m.last_done_at, last_done_hours: m.last_done_hours,
      status: maintenanceStatus({ ...m, created_at: m.created_at ?? new Date(0).toISOString() }, use.get(m.truck_id) ?? { reading: null, runs: [] }, now),
    }))
    .sort((a, b) => rank[a.status.state] - rank[b.status.state] || a.truck_name.localeCompare(b.truck_name) || a.name.localeCompare(b.name));
}

/** The truck's meter now, or null when no reading was ever logged. */
export async function meterFor(tx: Tx, truckId: string): Promise<number | null> {
  const use = (await truckUse(tx)).get(truckId);
  const m = use ? meterNow(use) : null;
  return m == null ? null : Math.round(m * 10) / 10;
}

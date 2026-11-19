/**
 * Maintenance reminders on a truck (issue 161): "Oil change every 250 hours", "Blade check every 30 days".
 *
 * Hours used since the last service come from the truck's meter when both readings are known (the meter now, less the
 * meter when it was last done). Otherwise they are the hours the truck spent on storm runs since then: first Arrive to
 * last Done on each run it was set on. Due soon at 90% of the interval, overdue past it.
 */

export interface MaintenanceItem {
  every_hours: number | null;
  every_days: number | null;
  last_done_at: string | null;
  last_done_hours: number | null;
  created_at: string;
}

export interface TruckUse {
  /** The latest meter reading the office logged, if any. */
  reading: { hours: number; at: string } | null;
  /** Storm runs this truck was on: when work started and ended. */
  runs: { start: string; end: string }[];
}

export type MaintenanceState = 'ok' | 'soon' | 'overdue';

export interface MaintenanceStatus {
  state: MaintenanceState;
  /** Hours used since last done, rounded to a tenth. Null when the reminder isn't by hours. */
  hours_used: number | null;
  days_used: number | null;
  /** The truck's meter now, when a reading exists: the last reading plus run hours since. */
  meter: number | null;
  /** Plain words, like "230 of 250 h" or "12 days overdue". */
  detail: string;
}

export const SOON_AT = 0.9;

const hoursBetween = (a: string, b: string) => Math.max(0, (Date.parse(b) - Date.parse(a)) / 3_600_000);

/** Run hours after a moment, counting only the part of a run that falls after it. */
export function runHoursSince(runs: TruckUse['runs'], since: string | null): number {
  const from = since ? Date.parse(since) : -Infinity;
  let h = 0;
  for (const r of runs) {
    const s = Math.max(Date.parse(r.start), from);
    const e = Date.parse(r.end);
    if (e > s) h += (e - s) / 3_600_000;
  }
  return h;
}

export function meterNow(use: TruckUse): number | null {
  if (!use.reading) return null;
  return use.reading.hours + runHoursSince(use.runs, use.reading.at);
}

export function maintenanceStatus(item: MaintenanceItem, use: TruckUse, now: Date = new Date()): MaintenanceStatus {
  const meter = meterNow(use);
  const since = item.last_done_at ?? item.created_at;
  let hoursUsed: number | null = null;
  if (item.every_hours) {
    hoursUsed = item.last_done_hours != null && meter != null ? Math.max(0, meter - item.last_done_hours) : runHoursSince(use.runs, since);
    hoursUsed = Math.round(hoursUsed * 10) / 10;
  }
  const daysUsed = item.every_days ? Math.floor(hoursBetween(since, now.toISOString()) / 24) : null;
  const ratios = [item.every_hours && hoursUsed != null ? hoursUsed / item.every_hours : 0, item.every_days && daysUsed != null ? daysUsed / item.every_days : 0];
  const worst = Math.max(...ratios);
  const state: MaintenanceState = worst > 1 ? 'overdue' : worst >= SOON_AT ? 'soon' : 'ok';
  const parts: string[] = [];
  if (item.every_hours && hoursUsed != null) {
    parts.push(hoursUsed > item.every_hours ? `${fmt(hoursUsed - item.every_hours)} h overdue` : `${fmt(hoursUsed)} of ${fmt(item.every_hours)} h`);
  }
  if (item.every_days && daysUsed != null) {
    parts.push(daysUsed > item.every_days ? `${daysUsed - item.every_days} ${daysUsed - item.every_days === 1 ? 'day' : 'days'} overdue` : `${daysUsed} of ${item.every_days} days`);
  }
  return { state, hours_used: hoursUsed, days_used: daysUsed, meter: meter == null ? null : Math.round(meter * 10) / 10, detail: parts.join(', ') };
}

const fmt = (n: number) => (Number.isInteger(n) ? String(n) : n.toFixed(1));

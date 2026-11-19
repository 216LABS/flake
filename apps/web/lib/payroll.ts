import { payPeriods, payroll, workweekOf, type PayRates, type PayRow } from '@flake/core/payroll';
import { zonedDayStart } from '@flake/core/time';
import { crew_member, eq, storm, type Tx } from '@flake/db';
import { SHIFT_REACH_MS, shiftsBetween } from './reports';

export type PayrollSettings = { period?: 'weekly' | 'biweekly'; week_start?: number; anchor?: string; holidays?: string[]; adp_co_code?: string };

const DAY = 86_400_000;

/**
 * The payroll for one period (issue 170): employees only, each with regular, storm, holiday and overtime hours and the
 * shifts behind them. Overtime is per workweek, so shifts from the start of the first workweek are read too.
 */
export async function payrollFor(tx: Tx, tz: string, settings: PayrollSettings, from: string, to: string): Promise<(PayRow & { name: string; payroll_id: string | null })[]> {
  const rules = { tz, weekStart: settings.week_start ?? 0, holidays: settings.holidays ?? [] };
  const startAt = zonedDayStart(from, tz).getTime();
  const endAt = zonedDayStart(new Date(Date.parse(`${to}T00:00:00Z`) + DAY).toISOString().slice(0, 10), tz).getTime();
  const weekFrom = zonedDayStart(workweekOf(startAt, rules), tz).getTime();
  const crew = await tx.select().from(crew_member).where(eq(crew_member.kind, 'employee'));
  const employees = new Map(crew.map((c) => [c.id, c]));
  const storms = new Map((await tx.select({ id: storm.id, name: storm.name }).from(storm)).map((s) => [s.id, s.name]));
  // Read past both ends so a shift across the period edge is seen whole, then keep it by where it started (issue 178).
  const raw = (await shiftsBetween(tx, new Date(weekFrom - SHIFT_REACH_MS).toISOString(), new Date(endAt + SHIFT_REACH_MS).toISOString())).filter((s) => employees.has(s.crewId) && s.start >= weekFrom && s.start < endAt);
  const rates = new Map<string, PayRates>(crew.map((c) => [c.id, { regular_cents: c.pay_regular_cents, ot_cents: c.pay_ot_cents, storm_cents: c.pay_storm_cents, holiday_cents: c.pay_holiday_cents }]));
  const rows = payroll(raw.map((s) => ({ crewId: s.crewId, start: s.start, end: s.end, storm: storms.get(s.stormId) ?? 'Storm' })), rates, rules, (t) => t >= startAt && t < endAt);
  return rows.map((r) => ({ ...r, name: employees.get(r.crewId)!.name, payroll_id: employees.get(r.crewId)!.payroll_id })).sort((a, b) => a.name.localeCompare(b.name));
}

export { payPeriods };

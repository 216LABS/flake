/**
 * Payroll hours (issue 170): each employee's shifts for a pay period, split into regular, storm, holiday and overtime
 * hours, priced at their rates.
 *
 * Rules, written on the Payroll page too:
 * - Overtime is every hour past 40 in one workweek (FLSA). Workweeks start on the company's day (Sunday by default), at
 *   midnight in its time zone. A workweek that straddles the pay period counts all its hours toward the 40.
 * - A shift counts in the period and workweek it started in (issue 140), so an overnight run is never split.
 * - Hours up to 40: a shift that starts on a company holiday is holiday hours; otherwise storm hours when the employee
 *   has a storm rate (every Flake shift is storm work), else regular hours.
 * - Overtime pays the overtime rate, 1.5 times regular when none is set.
 * - Subs are never here. They are paid from Sub pay.
 */

export interface PayShift { crewId: string; start: number; end: number; storm: string }
export interface PayRates { regular_cents: number | null; ot_cents: number | null; storm_cents: number | null; holiday_cents: number | null }
export interface PayRules { tz: string; weekStart: number; holidays: string[] }

export interface PayLine { start: number; end: number; storm: string; hours: number; regular: number; storm_h: number; holiday: number; ot: number }
export interface PayRow { crewId: string; regular: number; storm: number; holiday: number; ot: number; hours: number; amount_cents: number | null; lines: PayLine[] }

const r2 = (n: number) => Math.round(n * 100) / 100;

/** The local calendar day of a moment, YYYY-MM-DD. */
const dayIn = (t: number, tz: string) => new Date(t).toLocaleDateString('en-CA', { timeZone: tz });
const weekdayIn = (t: number, tz: string) => ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].indexOf(new Date(t).toLocaleDateString('en-US', { timeZone: tz, weekday: 'short' }));

/** The local date the workweek holding this moment started on. */
export function workweekOf(t: number, rules: Pick<PayRules, 'tz' | 'weekStart'>): string {
  const back = (weekdayIn(t, rules.tz) - rules.weekStart + 7) % 7;
  const d = dayIn(t, rules.tz);
  return new Date(Date.parse(`${d}T00:00:00Z`) - back * 86_400_000).toISOString().slice(0, 10);
}

export function overtimeRate(r: PayRates): number | null {
  return r.ot_cents ?? (r.regular_cents != null ? Math.round(r.regular_cents * 1.5) : null);
}

/**
 * shifts: every shift of these employees from the start of the first workweek touching the period to its end.
 * inPeriod: whether a shift's start falls in the pay period.
 */
export function payroll(shifts: PayShift[], rates: Map<string, PayRates>, rules: PayRules, inPeriod: (start: number) => boolean): PayRow[] {
  const holidays = new Set(rules.holidays);
  const byCrew = new Map<string, PayShift[]>();
  for (const s of shifts) byCrew.set(s.crewId, [...(byCrew.get(s.crewId) ?? []), s]);
  const out: PayRow[] = [];
  for (const [crewId, list] of byCrew) {
    const rate = rates.get(crewId) ?? { regular_cents: null, ot_cents: null, storm_cents: null, holiday_cents: null };
    const weekHours = new Map<string, number>();
    const lines: PayLine[] = [];
    for (const s of [...list].sort((a, b) => a.start - b.start)) {
      const hours = Math.max(0, (s.end - s.start) / 3_600_000);
      const week = workweekOf(s.start, rules);
      const before = weekHours.get(week) ?? 0;
      weekHours.set(week, before + hours);
      if (!inPeriod(s.start)) continue;
      const straight = Math.max(0, Math.min(hours, 40 - before));
      const ot = hours - straight;
      const holiday = holidays.has(dayIn(s.start, rules.tz));
      const storm = !holiday && rate.storm_cents != null;
      lines.push({ start: s.start, end: s.end, storm: s.storm, hours: r2(hours), regular: !holiday && !storm ? r2(straight) : 0, storm_h: storm ? r2(straight) : 0, holiday: holiday ? r2(straight) : 0, ot: r2(ot) });
    }
    if (!lines.length) continue;
    const sum = (k: 'regular' | 'storm_h' | 'holiday' | 'ot') => r2(lines.reduce((a, l) => a + l[k], 0));
    const row = { regular: sum('regular'), storm: sum('storm_h'), holiday: sum('holiday'), ot: sum('ot') };
    const otRate = overtimeRate(rate);
    const priced = rate.regular_cents != null
      ? Math.round(row.regular * rate.regular_cents + row.storm * (rate.storm_cents ?? rate.regular_cents) + row.holiday * (rate.holiday_cents ?? rate.regular_cents) + row.ot * (otRate ?? 0))
      : null;
    out.push({ crewId, ...row, hours: r2(row.regular + row.storm + row.holiday + row.ot), amount_cents: priced, lines });
  }
  return out;
}

/** The pay periods ending on or before `today`, newest first. Biweekly periods count from `anchor` (a period start). */
export function payPeriods(today: string, opts: { period?: 'weekly' | 'biweekly'; weekStart?: number; anchor?: string }, count = 8): { from: string; to: string }[] {
  const d = (s: string) => Date.parse(`${s}T00:00:00Z`);
  const iso = (t: number) => new Date(t).toISOString().slice(0, 10);
  const len = opts.period === 'biweekly' ? 14 : 7;
  const ws = opts.weekStart ?? 0;
  const dow = new Date(d(today)).getUTCDay();
  let start = d(today) - ((dow - ws + 7) % 7) * 86_400_000;
  if (len === 14) {
    const anchor = opts.anchor && /^\d{4}-\d{2}-\d{2}$/.test(opts.anchor) ? d(opts.anchor) : d('2026-01-04');
    const off = Math.round((start - anchor) / 86_400_000);
    if (((off % 14) + 14) % 14 !== 0) start -= 7 * 86_400_000;
  }
  const out: { from: string; to: string }[] = [];
  for (let i = 0; i < count; i++) {
    const s = start - i * len * 86_400_000;
    out.push({ from: iso(s), to: iso(s + (len - 1) * 86_400_000) });
  }
  return out;
}

const csvCell = (v: string | number) => {
  const s = String(v);
  const safe = !/^-?\d+(\.\d+)?$/.test(s) && /^[=+\-@\t\r]/.test(s) ? `'${s}` : s;
  return /[",\r\n]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
};
const csv = (rows: (string | number)[][]) => rows.map((r) => r.map(csvCell).join(',')).join('\r\n') + '\r\n';

export interface PayExportRow { name: string; payrollId: string | null; regular: number; storm: number; holiday: number; ot: number }

/**
 * Gusto's hours upload (docs/PAYROLL_EXPORTS.md). Gusto matches columns by name; storm hours have no column of their
 * own there, so they go in Regular Hours unless the company adds a "Storm" custom earning in Gusto.
 */
export function gustoCsv(rows: PayExportRow[], opts: { stormAsRegular?: boolean } = {}): string {
  const split = (n: string) => { const parts = n.trim().split(/\s+/); return { first: parts.slice(0, -1).join(' ') || parts[0]!, last: parts.length > 1 ? parts[parts.length - 1]! : '' }; };
  const storm = opts.stormAsRegular !== false;
  return csv([
    ['Employee ID', 'First Name', 'Last Name', 'Regular Hours', 'Overtime Hours', 'Holiday Hours', ...(storm ? [] : ['Storm Hours'])],
    ...rows.map((r) => { const n = split(r.name); return [r.payrollId ?? '', n.first, n.last, (storm ? r.regular + r.storm : r.regular).toFixed(2), r.ot.toFixed(2), r.holiday.toFixed(2), ...(storm ? [] : [r.storm.toFixed(2)])]; }),
  ]);
}

/**
 * ADP Workforce Now paydata import (EPI): company code, batch id, file number, then hours. Storm and holiday hours go
 * in Hours 3 and Hours 4 with the earning codes the company uses in ADP (STM and HOL unless set).
 */
export function adpCsv(rows: PayExportRow[], opts: { coCode: string; batchId: string; stormCode?: string; holidayCode?: string }): string {
  return csv([
    ['Co Code', 'Batch ID', 'File #', 'Employee Name', 'Reg Hours', 'O/T Hours', 'Hours 3 Code', 'Hours 3 Amount', 'Hours 4 Code', 'Hours 4 Amount'],
    ...rows.map((r) => [opts.coCode, opts.batchId, r.payrollId ?? '', r.name, r.regular.toFixed(2), r.ot.toFixed(2), r.storm ? (opts.stormCode ?? 'STM') : '', r.storm ? r.storm.toFixed(2) : '', r.holiday ? (opts.holidayCode ?? 'HOL') : '', r.holiday ? r.holiday.toFixed(2) : '']),
  ]);
}

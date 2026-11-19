import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { adpCsv, gustoCsv, payPeriods, payroll, workweekOf, type PayRates } from '../src/payroll';

const tz = 'America/New_York';
const at = (s: string) => Date.parse(s);
const h = (start: string, hours: number, storm = 'S') => ({ crewId: 'a', start: at(start), end: at(start) + hours * 3_600_000, storm });
const rates = (r: Partial<PayRates> = {}) => new Map([['a', { regular_cents: 2000, ot_cents: null, storm_cents: null, holiday_cents: null, ...r }]]);
const all = () => true;

describe('issue 170: payroll hours', () => {
  it('workweeks start on the company day at local midnight', () => {
    // Sat 11 PM in Cleveland is Sunday 4 AM UTC, still the week that started the Sunday before.
    expect(workweekOf(at('2027-01-10T04:00:00Z'), { tz, weekStart: 0 })).toBe('2027-01-03');
    expect(workweekOf(at('2027-01-10T06:00:00Z'), { tz, weekStart: 0 })).toBe('2027-01-10');
    expect(workweekOf(at('2027-01-10T06:00:00Z'), { tz, weekStart: 1 })).toBe('2027-01-04');
  });

  it('hours past 40 in a workweek are overtime at 1.5x when no rate is set', () => {
    const shifts = [h('2027-01-04T08:00:00Z', 16), h('2027-01-06T08:00:00Z', 16), h('2027-01-08T08:00:00Z', 12)];
    const [row] = payroll(shifts, rates(), { tz, weekStart: 0, holidays: [] }, all);
    expect(row).toMatchObject({ regular: 40, ot: 4, hours: 44, amount_cents: 40 * 2000 + 4 * 3000 });
    // The shift that crosses 40 is split; the overnight run itself isn't.
    expect(row!.lines.map((l) => [l.regular, l.ot])).toEqual([[16, 0], [16, 0], [8, 4]]);
  });

  it('a workweek that straddles the pay period counts all its hours toward 40', () => {
    const shifts = [h('2027-01-04T08:00:00Z', 36), h('2027-01-08T08:00:00Z', 10)];
    const inPeriod = (t: number) => t >= at('2027-01-07T05:00:00Z');
    const [row] = payroll(shifts, rates(), { tz, weekStart: 0, holidays: [] }, inPeriod);
    expect(row).toMatchObject({ regular: 4, ot: 6, hours: 10 });
  });

  it('holiday and storm hours use their rates; subs are never passed in', () => {
    const shifts = [h('2027-01-01T13:00:00Z', 8), h('2027-01-02T13:00:00Z', 8)];
    const [row] = payroll(shifts, rates({ storm_cents: 2500, holiday_cents: 4000 }), { tz, weekStart: 0, holidays: ['2027-01-01'] }, all);
    expect(row).toMatchObject({ holiday: 8, storm: 8, regular: 0, amount_cents: 8 * 4000 + 8 * 2500 });
  });

  it('no pay rate means hours with no amount, not a guess', () => {
    const [row] = payroll([h('2027-01-04T08:00:00Z', 5)], new Map(), { tz, weekStart: 0, holidays: [] }, all);
    expect(row).toMatchObject({ regular: 5, amount_cents: null });
  });
});


describe('issue 170: pay periods and exports', () => {
  it('weekly and biweekly periods, the current one first', () => {
    expect(payPeriods('2027-01-13', { weekStart: 0 }, 2)).toEqual([{ from: '2027-01-10', to: '2027-01-16' }, { from: '2027-01-03', to: '2027-01-09' }]);
    expect(payPeriods('2027-01-13', { period: 'biweekly', weekStart: 0, anchor: '2027-01-03' }, 1)).toEqual([{ from: '2027-01-03', to: '2027-01-16' }]);
  });
  const rows = [{ name: 'Mike De La Cruz', payrollId: '1001', regular: 32, storm: 8, holiday: 0, ot: 4.5 }, { name: '=Bad', payrollId: null, regular: 1, storm: 0, holiday: 8, ot: 0 }];
  it('Gusto and ADP files match the fixtures, formula-safe', () => {
    const fx = (f: string) => readFileSync(join(__dirname, 'fixtures', f), 'utf8');
    expect(gustoCsv(rows)).toBe(fx('payroll-gusto.csv'));
    expect(adpCsv(rows, { coCode: 'AB1', batchId: '270116' })).toBe(fx('payroll-adp.csv'));
  });
});

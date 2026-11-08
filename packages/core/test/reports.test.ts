import { describe, expect, it } from 'vitest';
import { hoursCsv, hoursOf, saltOnHand, saltTons, shiftsFrom } from '../src/reports';

const H = 3_600_000;

describe('crew hours', () => {
  it('runs first tap to last tap and splits on a long quiet gap', () => {
    const s = shiftsFrom([5 * H, 3 * H, 4 * H, NaN, 10 * H, 10.5 * H]);
    expect(s).toEqual([{ start: 3 * H, end: 5 * H, events: 3 }, { start: 10 * H, end: 10.5 * H, events: 2 }]);
    expect(s.map(hoursOf)).toEqual([2, 0.5]);
    expect(shiftsFrom([])).toEqual([]);
  });
  it('writes payroll CSV with safe text', () => {
    const csv = hoursCsv([{ crew: 'Ana "Plow" Diaz', kind: 'sub', storm: '=Dec 12', clockIn: 'Dec 12 3:00 AM', clockOut: 'Dec 12 9:15 AM', hours: 6.25, stops: 14, note: '' }]);
    expect(csv).toBe('Name,Type,Storm,Clock in,Clock out,Hours,Stops done,Note\r\n"Ana ""Plow"" Diaz",Subcontractor,\'=Dec 12,Dec 12 3:00 AM,Dec 12 9:15 AM,6.25,14,\r\n');
    expect(hoursCsv([])).toBe('Name,Type,Storm,Clock in,Clock out,Hours,Stops done,Note\r\n');
    expect(hoursCsv([{ crew: 'B', kind: 'employee', storm: 'S', clockIn: 'a', clockOut: 'b', hours: 1, stops: 0, note: 'x' }])).toContain('B,Employee,S');
  });
});

describe('salt stock', () => {
  it('converts units to tons', () => {
    expect(saltTons('ton', 1.5)).toBe(1.5);
    expect(saltTons('bag50lb', 40)).toBe(1);
    expect(saltTons('lb', 500)).toBe(0.25);
    expect(saltTons('application', 2)).toBeNull();
  });
  it('starts from the latest count, adds deliveries and takes off use after it', () => {
    const entries = [
      { id: '1', kind: 'delivery' as const, at: '2026-11-01T00:00:00Z', tons: 20 },
      { id: '2', kind: 'count' as const, at: '2026-11-10T00:00:00Z', tons: 12 },
      { id: '3', kind: 'delivery' as const, at: '2026-11-12T00:00:00Z', tons: 10 },
      { id: '4', kind: 'count' as const, at: '2026-11-05T00:00:00Z', tons: 99 },
    ];
    const uses = [{ at: '2026-11-08T00:00:00Z', tons: 5 }, { at: '2026-11-15T00:00:00Z', tons: 3.333 }];
    expect(saltOnHand(entries, uses)).toEqual({ tons: 18.67, since: '2026-11-10T00:00:00Z' });
    expect(saltOnHand(entries.slice(0, 1), uses)).toEqual({ tons: 11.67, since: null });
  });
});

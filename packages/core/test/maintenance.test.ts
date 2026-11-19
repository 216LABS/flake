import { describe, expect, it } from 'vitest';
import { maintenanceStatus, meterNow, runHoursSince } from '../src/maintenance';

const item = (over: Partial<Parameters<typeof maintenanceStatus>[0]> = {}) => ({ every_hours: 250, every_days: null, last_done_at: '2026-10-01T00:00:00Z', last_done_hours: 1000, created_at: '2026-09-01T00:00:00Z', ...over });
const reading = (hours: number) => ({ reading: { hours, at: '2026-11-01T00:00:00Z' }, runs: [] });

describe('issue 161: maintenance reminders', () => {
  it('oil change every 250 h, last done at 1,000 h: ok, due soon at 225 h used, overdue past 250', () => {
    expect(maintenanceStatus(item(), reading(1224)).state).toBe('ok');
    expect(maintenanceStatus(item(), reading(1225)).state).toBe('soon');
    expect(maintenanceStatus(item(), reading(1250)).state).toBe('soon');
    const over = maintenanceStatus(item(), reading(1251));
    expect(over.state).toBe('overdue');
    expect(over.detail).toBe('1 h overdue');
    expect(maintenanceStatus(item(), reading(1230)).detail).toBe('230 of 250 h');
  });

  it('adds storm-run hours after the last meter reading', () => {
    const use = { reading: { hours: 1200, at: '2026-11-01T00:00:00Z' }, runs: [
      { start: '2026-10-30T04:00:00Z', end: '2026-10-30T10:00:00Z' }, // before the reading: already on the meter
      { start: '2026-11-05T03:00:00Z', end: '2026-11-05T11:00:00Z' }, // 8 h
      { start: '2026-11-10T04:00:00Z', end: '2026-11-10T21:00:00Z' }, // 17 h
    ] };
    expect(meterNow(use)).toBe(1225);
    expect(maintenanceStatus(item(), use).state).toBe('soon');
  });

  it('without meter readings, counts run hours since it was last done', () => {
    const use = { reading: null, runs: [{ start: '2026-09-20T00:00:00Z', end: '2026-10-01T00:00:00Z' }, { start: '2026-10-02T00:00:00Z', end: '2026-10-02T06:00:00Z' }] };
    const s = maintenanceStatus(item({ last_done_hours: null }), use);
    expect(s.hours_used).toBe(6);
    expect(s.meter).toBeNull();
    // A run that straddles the service counts only after it.
    expect(runHoursSince([{ start: '2026-09-30T20:00:00Z', end: '2026-10-01T02:00:00Z' }], '2026-10-01T00:00:00Z')).toBe(2);
  });

  it('by the calendar: every 30 days', () => {
    const it30 = item({ every_hours: null, every_days: 30, last_done_at: '2026-11-01T00:00:00Z' });
    expect(maintenanceStatus(it30, reading(0), new Date('2026-11-20T00:00:00Z')).state).toBe('ok');
    expect(maintenanceStatus(it30, reading(0), new Date('2026-11-28T00:00:00Z')).state).toBe('soon');
    const late = maintenanceStatus(it30, reading(0), new Date('2026-12-03T00:00:00Z'));
    expect(late.state).toBe('overdue');
    expect(late.detail).toBe('2 days overdue');
  });

  it('a reminder never done counts from when it was added', () => {
    const s = maintenanceStatus(item({ every_hours: null, every_days: 10, last_done_at: null, created_at: '2026-11-01T00:00:00Z' }), reading(0), new Date('2026-11-12T00:00:00Z'));
    expect(s.state).toBe('overdue');
  });

  it('either limit makes it due', () => {
    const both = item({ every_days: 365 });
    expect(maintenanceStatus(both, reading(1260), new Date('2026-10-05T00:00:00Z')).state).toBe('overdue');
  });
});

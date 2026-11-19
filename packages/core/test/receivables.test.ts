import { describe, expect, it } from 'vitest';
import { age, bucketTotals, daysBetween, defaultDueOn, localDay, statement } from '../src/receivables';

describe('issue 168: receivables', () => {
  it('due dates follow the billing mode, and installments get 30 days', () => {
    expect(defaultDueOn('draft', '2026-12-02', 'invoice_net30')).toBe('2027-01-01');
    expect(defaultDueOn('draft', '2026-12-02', 'card_on_file')).toBe('2026-12-02');
    expect(defaultDueOn('installment', '2026-11-15', 'manual')).toBe('2026-12-15');
  });

  it('ages by calendar days in the company time zone', () => {
    // 11:30 PM in Cleveland on Jan 31 is already Feb 1 in UTC; the bill is 30 days late, not 31.
    expect(localDay('2027-02-01T04:30:00Z', 'America/New_York')).toBe('2027-01-31');
    expect(daysBetween('2027-01-01', '2027-01-31')).toBe(30);
    expect(age({ totalCents: 33000, paidCents: 0, dueOn: '2027-01-01' }, '2027-01-31')).toEqual({ balanceCents: 33000, daysLate: 30, bucket: '1-30' });
    expect(age({ totalCents: 33000, paidCents: 13000, dueOn: '2027-01-01' }, '2027-01-01')).toEqual({ balanceCents: 20000, daysLate: 0, bucket: 'current' });
    expect(age({ totalCents: 100, paidCents: 0, dueOn: '2026-10-01' }, '2027-01-01').bucket).toBe('90+');
    expect(age({ totalCents: 100, paidCents: 0, dueOn: '2026-11-01' }, '2027-01-01').bucket).toBe('61-90');
  });

  it('bucket totals add up to the open balance', () => {
    const rows = [{ balanceCents: 100, bucket: 'current' as const }, { balanceCents: 250, bucket: '1-30' as const }, { balanceCents: 50, bucket: '1-30' as const }];
    const t = bucketTotals(rows);
    expect(t).toEqual({ current: 100, '1-30': 300, '31-60': 0, '61-90': 0, '90+': 0 });
  });

  it('a statement carries the opening balance, runs the period in order, and ends where the ledger does', () => {
    const s = statement([
      { day: '2026-11-20', kind: 'bill', ref: 'A', description: 'Nov storm', cents: 10000 },
      { day: '2026-12-05', kind: 'payment', ref: 'chk 101', description: 'Check', cents: 4000 },
      { day: '2026-12-02', kind: 'bill', ref: 'B', description: 'Dec storm', cents: 5000 },
      { day: '2027-01-03', kind: 'payment', ref: 'chk 102', description: 'Check', cents: 1000 },
    ], '2026-12-01', '2026-12-31');
    expect(s.opening).toBe(10000);
    expect(s.lines.map((l) => [l.ref, l.balance])).toEqual([['B', 15000], ['chk 101', 11000]]);
    expect(s.closing).toBe(11000);
  });
});

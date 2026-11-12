import { describe, expect, it } from 'vitest';
import { todayIn } from '../src/time';

describe("today is the company's date, not UTC's", () => {
  it('9 PM in Cleveland is still that day, though UTC has moved on', () => {
    const ninePm = Date.parse('2026-11-13T02:00:00Z');
    expect(todayIn('America/New_York', ninePm)).toBe('2026-11-12');
    expect(todayIn('UTC', ninePm)).toBe('2026-11-13');
    expect(todayIn('America/New_York', new Date(Date.parse('2026-11-13T06:00:00Z')))).toBe('2026-11-13');
  });
  it('defaults to now', () => {
    expect(todayIn('America/New_York')).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });
});

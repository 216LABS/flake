import { describe, expect, it } from 'vitest';
import { fatigue } from '../src/fatigue';

const H = 3_600_000;
const at = (iso: string) => Date.parse(iso);
/** A tap every 30 minutes from a to b. */
const taps = (a: number, b: number) => Array.from({ length: Math.floor((b - a) / (H / 2)) + 1 }, (_, i) => a + (i * H) / 2);

describe('issue 235: driver hours during a storm', () => {
  it('counts a shift that crosses midnight as one, and warns at 14 hours', () => {
    const start = at('2026-12-01T20:00:00-05:00');
    const now = at('2026-12-02T10:30:00-05:00');
    const f = fatigue(taps(start, now), now);
    expect(f.on).toBe(true);
    expect(f.on_hours).toBe(14.5);
    expect(f.long_shift).toBe(true);
    expect(f.rest_hours).toBeNull();
  });

  it('measures the rest before this shift and flags one under 8 hours', () => {
    const first = taps(at('2026-12-01T06:00:00Z'), at('2026-12-01T18:00:00Z'));
    const second = taps(at('2026-12-01T22:00:00Z'), at('2026-12-02T01:00:00Z'));
    const f = fatigue([...first, ...second], at('2026-12-02T01:10:00Z'));
    expect(f.rest_hours).toBe(4);
    expect(f.short_rest).toBe(true);
    expect(f.long_shift).toBe(false);
    expect(f.on_hours).toBe(3.2);
  });

  it('is off shift after two quiet hours, and an 8 hour rest is enough', () => {
    const first = taps(at('2026-12-01T06:00:00Z'), at('2026-12-01T10:00:00Z'));
    expect(fatigue(first, at('2026-12-01T12:30:00Z')).on).toBe(false);
    const second = taps(at('2026-12-01T18:00:00Z'), at('2026-12-01T19:00:00Z'));
    expect(fatigue([...first, ...second], at('2026-12-01T19:05:00Z')).short_rest).toBe(false);
  });

  it('takes the company\'s own limits', () => {
    const now = at('2026-12-01T10:00:00Z');
    expect(fatigue(taps(at('2026-12-01T00:00:00Z'), now), now, { warn_hours: 10, min_rest_hours: 8 }).long_shift).toBe(true);
    expect(fatigue(taps(at('2026-12-01T00:00:00Z'), now), now, { warn_hours: 12, min_rest_hours: 8 }).long_shift).toBe(false);
  });
});

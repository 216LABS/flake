import { SHIFT_GAP_MS, shiftsFrom } from './reports';

/**
 * How long a driver has been out, and how long they rested before (issue 235). From the same phone events payroll uses:
 * a quiet gap of two hours or more ends a shift. A shift still running ends "now"; one that ended doesn't count as on.
 * This shows hours, it doesn't apply any hours-of-service rule.
 */
export interface FatigueLimits { warn_hours: number; min_rest_hours: number }
export const DEFAULT_FATIGUE: FatigueLimits = { warn_hours: 14, min_rest_hours: 8 };

export interface Fatigue {
  /** On shift right now (an event within the last two hours). */
  on: boolean;
  shift_start: number | null;
  on_hours: number;
  /** Rest between the shift before and this one; null when there was no earlier shift in the window. */
  rest_hours: number | null;
  long_shift: boolean;
  short_rest: boolean;
}

const h = (ms: number) => Math.round((ms / 3_600_000) * 10) / 10;

export function fatigue(times: number[], now: number, limits: FatigueLimits = DEFAULT_FATIGUE): Fatigue {
  const shifts = shiftsFrom(times.filter((t) => t <= now));
  const last = shifts.at(-1);
  if (!last || now - last.end >= SHIFT_GAP_MS) return { on: false, shift_start: null, on_hours: 0, rest_hours: null, long_shift: false, short_rest: false };
  const prev = shifts.at(-2);
  const onHours = h(now - last.start);
  const rest = prev ? h(last.start - prev.end) : null;
  return { on: true, shift_start: last.start, on_hours: onHours, rest_hours: rest, long_shift: onHours >= limits.warn_hours, short_rest: rest !== null && rest < limits.min_rest_hours };
}

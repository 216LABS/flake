import { csvText } from './qbo';

/** A gap this long between a driver's taps ends one shift and starts the next. */
export const SHIFT_GAP_MS = 2 * 60 * 60 * 1000;

export interface Shift {
  start: number;
  end: number;
  /** How many taps, GPS fixes and visits the phone sent during the shift. */
  events: number;
}

/**
 * Turns the times a driver's phone sent anything into shifts: first tap to last tap,
 * split wherever the phone went quiet for SHIFT_GAP_MS or longer.
 */
export function shiftsFrom(times: number[], gapMs = SHIFT_GAP_MS): Shift[] {
  const sorted = times.filter((t) => Number.isFinite(t)).sort((a, b) => a - b);
  const out: Shift[] = [];
  for (const t of sorted) {
    const last = out[out.length - 1];
    if (last && t - last.end < gapMs) {
      last.end = t;
      last.events++;
    } else out.push({ start: t, end: t, events: 1 });
  }
  return out;
}

export const hoursOf = (s: Pick<Shift, 'start' | 'end'>) => Math.round(((s.end - s.start) / 3_600_000) * 100) / 100;

export interface HoursRow {
  crew: string;
  kind: 'employee' | 'sub';
  storm: string;
  clockIn: string;
  clockOut: string;
  hours: number;
  stops: number;
  note: string;
}

/** One line per shift, in the plain columns payroll services import. */
export function hoursCsv(rows: HoursRow[]): string {
  const head = 'Name,Type,Storm,Clock in,Clock out,Hours,Stops done,Note';
  const body = rows.map((r) => [csvText(r.crew), r.kind === 'sub' ? 'Subcontractor' : 'Employee', csvText(r.storm), csvText(r.clockIn), csvText(r.clockOut), r.hours.toFixed(2), String(r.stops), csvText(r.note)].join(','));
  return `${[head, ...body].join('\r\n')}\r\n`;
}

/** Pounds in each salt unit a driver can log. An application has no fixed weight. */
const LB: Record<string, number> = { ton: 2000, lb: 1, bag50lb: 50 };

/** Tons, or null for a unit with no weight (an "application"). */
export const saltTons = (unit: string, qty: number): number | null => (LB[unit] === undefined ? null : (qty * LB[unit]!) / 2000);

export interface StockEntry {
  id: string;
  kind: 'delivery' | 'count';
  at: string;
  tons: number;
  note?: string;
}

export interface SaltUse {
  at: string;
  tons: number;
}

/**
 * Salt on hand: the latest count, plus deliveries after it, minus what drivers logged after it.
 * Without a count, it starts from zero, so deliveries alone set the stock.
 */
export function saltOnHand(entries: StockEntry[], uses: SaltUse[]): { tons: number; since: string | null } {
  const ms = (s: string) => Date.parse(s);
  const counts = entries.filter((e) => e.kind === 'count').sort((a, b) => ms(a.at) - ms(b.at));
  const base = counts[counts.length - 1];
  const from = base ? ms(base.at) : -Infinity;
  const delivered = entries.filter((e) => e.kind === 'delivery' && ms(e.at) > from).reduce((n, e) => n + e.tons, 0);
  const used = uses.filter((u) => ms(u.at) > from).reduce((n, u) => n + u.tons, 0);
  const tons = Math.round(((base?.tons ?? 0) + delivered - used) * 100) / 100;
  return { tons, since: base?.at ?? null };
}

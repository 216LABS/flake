import { billableQuarterHours } from './pricing';

export interface SubRateCard {
  per_visit_cents?: number;
  hourly_cents?: number;
  per_bag_cents?: number;
  /** One amount for each storm the sub worked, however many lots (issue 160). */
  flat_per_storm_cents?: number;
  /** One amount for the season, paid in five equal months, November through March (issue 160). */
  flat_per_season_cents?: number;
}

/** The months a season flat rate is paid in: November through March. */
export const SEASON_PAY_MONTHS = [11, 12, 1, 2, 3];

/** A season flat rate's monthly amounts, the remainder on the first so they add up exactly. */
export function seasonFlatMonths(totalCents: number): number[] {
  const base = Math.floor(totalCents / SEASON_PAY_MONTHS.length);
  return SEASON_PAY_MONTHS.map((_, i) => base + (i === 0 ? totalCents - base * SEASON_PAY_MONTHS.length : 0));
}

export interface SubVisit {
  id: string;
  site_label: string;
  arrived_at: string;
  departed_at: string | null;
  salt: { unit: string; qty: number }[] | null;
}

export interface SubStatementLine {
  visit_id: string;
  description: string;
  amount_cents: number;
  /** Set when the phone's times look wrong enough that a person should check before paying. */
  check?: string;
}

/** Longer than this on one lot, paid by the hour, is worth a look before paying. */
export const SUB_LONG_VISIT_HOURS = 4;

/** D5: a per-storm pay statement from completed visits and the sub's own rate card. */
export function subPayStatement(card: SubRateCard | null, visits: SubVisit[]): { lines: SubStatementLine[]; total_cents: number } {
  const c = card ?? {};
  const lines = visits
    .filter((v) => v.departed_at)
    .map((v) => {
      const hours = billableQuarterHours(v.arrived_at, v.departed_at) / 4;
      const bags = (v.salt ?? []).filter((s) => s.unit === 'bag50lb').reduce((n, s) => n + s.qty, 0);
      const amount = (c.per_visit_cents ?? 0) + Math.round((c.hourly_cents ?? 0) * hours) + bags * (c.per_bag_cents ?? 0);
      const minutes = (Date.parse(v.departed_at!) - Date.parse(v.arrived_at)) / 60000;
      // Same check as hourly billing: a Done tapped at the end of a shift, or a phone clock that jumped.
      const check = minutes < 0 ? "Done is earlier than Arrive on the phone's clock."
        : c.hourly_cents && hours > SUB_LONG_VISIT_HOURS ? `${hours} h on one lot at an hourly rate. Check Done wasn't tapped late.`
        : undefined;
      return { visit_id: v.id, description: `${v.site_label} (${hours} h${bags ? `, ${bags} bags` : ''})`, amount_cents: amount, ...(check ? { check } : {}) };
    });
  // A flat rate per storm is one line for the storm, on top of any per-lot pay, once there's a finished visit.
  if (c.flat_per_storm_cents && lines.length) lines.push({ visit_id: '', description: 'Flat rate for this storm', amount_cents: c.flat_per_storm_cents });
  return { lines, total_cents: lines.reduce((s, l) => s + l.amount_cents, 0) };
}

import { billableQuarterHours } from './pricing';

export interface SubRateCard {
  per_visit_cents?: number;
  hourly_cents?: number;
  per_bag_cents?: number;
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
  return { lines, total_cents: lines.reduce((s, l) => s + l.amount_cents, 0) };
}

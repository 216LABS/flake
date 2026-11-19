/**
 * Receivables (issue 168): what each open bill still owes, when it was due, and how late it is.
 *
 * Due dates: a bill's own due date when the office set one. Otherwise a net-30 customer's storm bill is due 30 days
 * after the storm closed, any other customer's on that day (a card or bank on file is charged at once), and a seasonal
 * installment 30 days after it was billed, as its invoice says. Days late count in the company's time zone.
 */

export type Bucket = 'current' | '1-30' | '31-60' | '61-90' | '90+';
export const BUCKETS: Bucket[] = ['current', '1-30', '31-60', '61-90', '90+'];
export const BUCKET_LABEL: Record<Bucket, string> = { current: 'Not due yet', '1-30': '1 to 30 days late', '31-60': '31 to 60', '61-90': '61 to 90', '90+': 'Over 90' };

/** YYYY-MM-DD in a time zone. */
export const localDay = (at: string | Date, tz: string) => new Date(at).toLocaleDateString('en-CA', { timeZone: tz });

/** Whole days from one calendar date to another (YYYY-MM-DD), so a time zone or clock change never shifts it. */
export function daysBetween(from: string, to: string): number {
  return Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000);
}

export function addDays(day: string, n: number): string {
  return new Date(Date.parse(`${day}T00:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10);
}

export function defaultDueOn(kind: 'draft' | 'installment', billedDay: string, billingMode: string): string {
  if (kind === 'installment') return addDays(billedDay, 30);
  return billingMode === 'invoice_net30' ? addDays(billedDay, 30) : billedDay;
}

export function bucketFor(daysLate: number): Bucket {
  if (daysLate <= 0) return 'current';
  if (daysLate <= 30) return '1-30';
  if (daysLate <= 60) return '31-60';
  if (daysLate <= 90) return '61-90';
  return '90+';
}

export interface OpenBill { totalCents: number; paidCents: number; dueOn: string }
export interface AgedBill { balanceCents: number; daysLate: number; bucket: Bucket }

export function age(bill: OpenBill, today: string): AgedBill {
  const daysLate = Math.max(0, daysBetween(bill.dueOn, today));
  return { balanceCents: Math.max(0, bill.totalCents - bill.paidCents), daysLate, bucket: bucketFor(daysLate) };
}

export function bucketTotals(rows: { balanceCents: number; bucket: Bucket }[]): Record<Bucket, number> {
  const out = Object.fromEntries(BUCKETS.map((b) => [b, 0])) as Record<Bucket, number>;
  for (const r of rows) out[r.bucket] += r.balanceCents;
  return out;
}

export interface StatementEntry { day: string; kind: 'bill' | 'payment'; ref: string; description: string; cents: number }

/**
 * A customer statement for a period: what was owed going in, each bill and payment in the period in date order, and
 * what is owed at the end. Bills add, payments subtract.
 */
export function statement(entries: StatementEntry[], from: string, to: string) {
  const sign = (e: StatementEntry) => (e.kind === 'bill' ? e.cents : -e.cents);
  const opening = entries.filter((e) => e.day < from).reduce((s, e) => s + sign(e), 0);
  const inside = entries.filter((e) => e.day >= from && e.day <= to).sort((a, b) => a.day.localeCompare(b.day) || (a.kind === b.kind ? 0 : a.kind === 'bill' ? -1 : 1));
  let running = opening;
  const lines = inside.map((e) => ({ ...e, balance: (running += sign(e)) }));
  return { opening, lines, closing: running };
}

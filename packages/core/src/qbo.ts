export interface QboRow {
  invoiceNo: string;
  customer: string;
  invoiceDate: string;
  dueDate: string;
  terms: string;
  memo: string;
  item: string;
  description: string;
  quantity: number;
  rateCents: number;
  amountCents: number;
}

const HEADER = ['InvoiceNo', 'Customer', 'InvoiceDate', 'DueDate', 'Terms', 'Memo', 'Item(Product/Service)', 'ItemDescription', 'ItemQuantity', 'ItemRate', 'ItemAmount'];

/** Quotes per RFC 4180 and neutralizes spreadsheet formula injection in text cells. */
export function csvText(value: string): string {
  // A plain number, like a longitude of -81.8, is data, not a formula: only text gets the quote (issue 134).
  const number = /^-?\d+(\.\d+)?$/.test(value);
  const safe = !number && /^[=+\-@\t\r]/.test(value) ? `'${value}` : value;
  return /[",\r\n]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
}

/** QuickBooks Online invoice import layout. Dates are MM/DD/YYYY as QBO expects. */
export function qboCsv(rows: QboRow[]): string {
  const money = (c: number) => (c / 100).toFixed(2);
  const body = rows.map((r) =>
    [
      csvText(r.invoiceNo),
      csvText(r.customer),
      r.invoiceDate,
      r.dueDate,
      csvText(r.terms),
      csvText(r.memo),
      csvText(r.item),
      csvText(r.description),
      String(r.quantity),
      money(r.rateCents),
      money(r.amountCents),
    ].join(','),
  );
  return [HEADER.join(','), ...body].join('\r\n') + '\r\n';
}

/** The QuickBooks item each kind of Flake line posts to (issue 162). Anything else, like a fee, posts as 'other'. */
export const QBO_KEYS = ['plow', 'salt', 'walks', 'haul', 'seasonal', 'other'] as const;
export type QboKey = (typeof QBO_KEYS)[number];
export const qboKeyFor = (service: string): QboKey => (['plow', 'salt', 'walks', 'haul'].includes(service) ? (service as QboKey) : 'other');
export const QBO_KEY_LABEL: Record<QboKey, string> = { plow: 'Plowing', salt: 'Salt', walks: 'Walks', haul: 'Hauling', seasonal: 'Seasonal installments', other: 'Anything else' };

/** "Lakewood Medical Center, LLC" and "lakewood medical center" are the same customer. */
export function normalizeName(name: string): string {
  return name
    .toLowerCase()
    .replace(/&/g, ' and ')
    .replace(/[^a-z0-9 ]+/g, ' ')
    .replace(/\b(inc|llc|ltd|co|corp|corporation|company|the)\b/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * A suggested QuickBooks customer for each Flake customer: the same name once normalized, else the same email. Only a
 * single candidate counts; two QuickBooks customers with that name is a choice for the owner, not a guess.
 */
export function suggestQboMatches(flake: { id: string; name: string; email: string | null }[], qbo: { id: string; name: string; email: string | null }[]): Map<string, { qboId: string; by: 'name' | 'email' }> {
  const byName = new Map<string, string[]>();
  const byEmail = new Map<string, string[]>();
  for (const q of qbo) {
    const n = normalizeName(q.name);
    if (n) byName.set(n, [...(byName.get(n) ?? []), q.id]);
    const e = q.email?.trim().toLowerCase();
    if (e) byEmail.set(e, [...(byEmail.get(e) ?? []), q.id]);
  }
  const out = new Map<string, { qboId: string; by: 'name' | 'email' }>();
  for (const f of flake) {
    const n = byName.get(normalizeName(f.name));
    if (n?.length === 1) { out.set(f.id, { qboId: n[0]!, by: 'name' }); continue; }
    const e = f.email ? byEmail.get(f.email.trim().toLowerCase()) : undefined;
    if (e?.length === 1) out.set(f.id, { qboId: e[0]!, by: 'email' });
  }
  return out;
}

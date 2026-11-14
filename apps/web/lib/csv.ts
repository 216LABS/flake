/** RFC 4180 CSV: quoted fields, doubled quotes inside them, commas and line breaks inside quotes, CRLF or LF. */
export function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let quoted = false;
  const src = text.replace(/^﻿/, '');
  for (let i = 0; i < src.length; i++) {
    const c = src[i]!;
    if (quoted) {
      if (c === '"' && src[i + 1] === '"') { field += '"'; i++; }
      else if (c === '"') quoted = false;
      else field += c;
    } else if (c === '"') quoted = true;
    else if (c === ',') { row.push(field); field = ''; }
    else if (c === '\n' || c === '\r') {
      if (c === '\r' && src[i + 1] === '\n') i++;
      row.push(field);
      rows.push(row);
      row = [];
      field = '';
    } else field += c;
  }
  if (field || row.length) { row.push(field); rows.push(row); }
  return rows.filter((r) => r.some((v) => v.trim()));
}

const HEADERS: Record<string, string[]> = {
  name: ['name', 'customer', 'customer name', 'client', 'client name'],
  address: ['address', 'street', 'service address', 'property address', 'location'],
  label: ['label', 'lot', 'site', 'property', 'site name', 'lot name'],
  email: ['email', 'e-mail', 'email address'],
  phone: ['phone', 'mobile', 'cell', 'phone number'],
  kind: ['kind', 'type', 'customer type'],
  billing: ['billing', 'payment', 'pay by', 'billing mode'],
};

export type CsvCustomer = { name: string; address: string; label: string | null; email: string | null; phone: string | null; kind: string | null; billing: string | null };

/**
 * A customer list from a spreadsheet: the first row names the columns, in any order and any of the usual words for them.
 * Name and address are needed; the rest may be missing. Each row says what's wrong with it, if anything.
 */
export function customersFromCsv(text: string): { rows: (CsvCustomer & { problem: string | null })[]; missing: string[] } {
  const [head, ...body] = parseCsv(text);
  if (!head) return { rows: [], missing: ['name', 'address'] };
  const at = Object.fromEntries(Object.entries(HEADERS).map(([key, names]) => [key, head.findIndex((h) => names.includes(h.trim().toLowerCase()))])) as Record<keyof CsvCustomer, number>;
  const missing = (['name', 'address'] as const).filter((k) => at[k] < 0);
  const cell = (r: string[], k: keyof CsvCustomer) => (at[k] >= 0 ? (r[at[k]] ?? '').trim() : '') || null;
  const rows = missing.length ? [] : body.map((r) => {
    const c: CsvCustomer = { name: cell(r, 'name') ?? '', address: cell(r, 'address') ?? '', label: cell(r, 'label'), email: cell(r, 'email'), phone: cell(r, 'phone'), kind: cell(r, 'kind'), billing: cell(r, 'billing') };
    const problem = !c.name ? 'No name.' : c.address.length < 5 ? 'No address.' : null;
    return { ...c, problem };
  });
  return { rows, missing };
}

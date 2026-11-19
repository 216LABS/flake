import { crewCreate, customerCreate } from '@flake/contracts';
import { readableIssue } from './issues';

/** RFC 4180 CSV: quoted fields, doubled quotes inside them, commas and line breaks inside quotes, CRLF or LF. */
export function parseCsv(text: string, sep = ','): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let quoted = false;
  const src = text.replace(/^\uFEFF/, '');
  for (let i = 0; i < src.length; i++) {
    const c = src[i]!;
    if (quoted) {
      if (c === '"' && src[i + 1] === '"') { field += '"'; i++; }
      else if (c === '"') quoted = false;
      else field += c;
    } else if (c === '"') quoted = true;
    else if (c === sep) { row.push(field); field = ''; }
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

/** Excel saves with semicolons in many countries: the first line says which one this file uses. */
const sepOf = (text: string) => {
  const firstLine = text.replace(/^\uFEFF/, '').split(/\r?\n/, 1)[0] ?? '';
  return (firstLine.match(/;/g)?.length ?? 0) > (firstLine.match(/,/g)?.length ?? 0) ? ';' : ',';
};

/** The words people use in a spreadsheet, to Flake's customer kinds. Blank means residential. */
export function importKind(v: string | null | undefined): 'residential' | 'commercial' | 'hoa' | null {
  const s = (v ?? '').trim().toLowerCase();
  if (!s || /^(res|residential|home|house|driveway)/.test(s)) return 'residential';
  if (/^(com|commercial|business|lot|retail|office)/.test(s)) return 'commercial';
  if (/^(hoa|association|condo)/.test(s)) return 'hoa';
  return null;
}

/** The same for billing. Blank uses the default, card on file. */
export function importBilling(v: string | null | undefined): 'card_on_file' | 'ach_on_file' | 'invoice_net30' | 'manual' | null {
  const s = (v ?? '').trim().toLowerCase();
  if (!s || /card/.test(s)) return 'card_on_file';
  if (/bank|ach/.test(s)) return 'ach_on_file';
  if (/invoice|net/.test(s)) return 'invoice_net30';
  if (/manual|check|cash|bill/.test(s)) return 'manual';
  return null;
}

type RowIn = { name: string; kind?: string | null; billing?: string | null; email?: string | null; phone?: string | null };

/** The checks the server makes on an imported row, so the preview flags a row before Add instead of after. */
export function checkImportRow(r: RowIn) {
  const kind = importKind(r.kind);
  if (!kind) return { ok: false as const, problem: `Kind "${r.kind}" isn't one of residential, commercial or HOA.` };
  const billing = importBilling(r.billing);
  if (!billing) return { ok: false as const, problem: `Billing "${r.billing}" isn't one of card, bank, invoice or manual.` };
  const parsed = customerCreate.safeParse({ name: r.name, kind, billing_mode: billing, email: r.email ?? '', phone_e164: r.phone ?? '' });
  if (!parsed.success) return { ok: false as const, problem: [...new Set(parsed.error.issues.map(readableIssue))].join(' ') };
  return { ok: true as const, data: parsed.data };
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
export function customersFromCsv(text: string): { rows: (CsvCustomer & { problem: string | null })[]; missing: string[]; empty?: boolean } {
  const [head, ...body] = parseCsv(text, sepOf(text));
  if (!head || !body.length) return { rows: [], missing: [], empty: true };
  const at = Object.fromEntries(Object.entries(HEADERS).map(([key, names]) => [key, head.findIndex((h) => names.includes(h.trim().toLowerCase()))])) as Record<keyof CsvCustomer, number>;
  const missing = (['name', 'address'] as const).filter((k) => at[k] < 0);
  const cell = (r: string[], k: keyof CsvCustomer) => (at[k] >= 0 ? (r[at[k]] ?? '').trim() : '') || null;
  const rows = missing.length ? [] : body.map((r) => {
    const c: CsvCustomer = { name: cell(r, 'name') ?? '', address: cell(r, 'address') ?? '', label: cell(r, 'label'), email: cell(r, 'email'), phone: cell(r, 'phone'), kind: cell(r, 'kind'), billing: cell(r, 'billing') };
    const check = checkImportRow(c);
    const problem = !c.name ? 'No name.' : c.address.length < 5 ? 'No address.' : check.ok ? null : check.problem;
    return { ...c, problem };
  });
  // The same name and address twice is one lot typed twice, not two lots: the later copy is left out.
  const seen = new Map<string, number>();
  rows.forEach((r, i) => {
    if (r.problem) return;
    const key = `${r.name.toLowerCase()}|${r.address.toLowerCase().replace(/\s+/g, ' ')}`;
    const first = seen.get(key);
    if (first === undefined) seen.set(key, i);
    // Numbered the way the preview table numbers rows, from 1 under the header (issue 136).
    else r.problem = `Same lot as #${first + 1}.`;
  });
  return { rows, missing };
}

/** Crew kinds from a spreadsheet (issue 174). Blank means an employee. */
export function importCrewKind(v: string | null | undefined): 'employee' | 'sub' | null {
  const s = (v ?? '').trim().toLowerCase();
  if (!s || /^(emp|employee|staff|w-?2|driver|crew|hourly)/.test(s)) return 'employee';
  if (/^(sub|subcontractor|contractor|1099)/.test(s)) return 'sub';
  return null;
}

/** Language from a spreadsheet. Blank means English. */
export function importLanguage(v: string | null | undefined): 'en' | 'es' | null {
  const s = (v ?? '').trim().toLowerCase();
  if (!s || /^(en|eng|english|ingl)/.test(s)) return 'en';
  if (/^(es|spa|spanish|espa)/.test(s)) return 'es';
  return null;
}

type CrewIn = { name: string; phone?: string | null; kind?: string | null; language?: string | null };

/** The server's checks on one crew row, shared with the preview. */
export function checkCrewRow(r: CrewIn) {
  const kind = importCrewKind(r.kind);
  if (!kind) return { ok: false as const, problem: `Kind "${r.kind}" isn't employee or sub.` };
  const language = importLanguage(r.language);
  if (!language) return { ok: false as const, problem: `Language "${r.language}" isn't English or Spanish.` };
  const parsed = crewCreate.safeParse({ name: r.name, kind, language, phone_e164: r.phone ?? '' });
  if (!parsed.success) return { ok: false as const, problem: [...new Set(parsed.error.issues.map(readableIssue))].join(' ') };
  return { ok: true as const, data: parsed.data };
}

/** Who a crew row is: their mobile when there is one, else their name. */
export const crewKey = (name: string, phone: string | null | undefined) => (phone ? `p:${phone}` : `n:${name.trim().toLowerCase().replace(/\s+/g, ' ')}`);

const CREW_HEADERS: Record<string, string[]> = {
  name: ['name', 'driver', 'crew', 'employee', 'full name', 'driver name', 'crew name'],
  phone: ['phone', 'mobile', 'cell', 'phone number', 'mobile number', 'cell phone'],
  kind: ['kind', 'type', 'role', 'employee or sub'],
  language: ['language', 'lang', 'idioma'],
};

export type CsvCrew = { name: string; phone: string | null; kind: string | null; language: string | null };

/**
 * A crew list from a spreadsheet (issue 174): name is needed; phone, kind and language are optional and other columns are
 * ignored. The same person twice in the file is kept once. Nothing is sent and no one is opted in to texts.
 */
export function crewFromCsv(text: string): { rows: (CsvCrew & { problem: string | null })[]; missing: string[]; empty?: boolean } {
  const [head, ...body] = parseCsv(text, sepOf(text));
  if (!head || !body.length) return { rows: [], missing: [], empty: true };
  const at = Object.fromEntries(Object.entries(CREW_HEADERS).map(([key, names]) => [key, head.findIndex((h) => names.includes(h.trim().toLowerCase()))])) as Record<keyof CsvCrew, number>;
  const missing = at.name < 0 ? ['name'] : [];
  const cell = (r: string[], k: keyof CsvCrew) => (at[k] >= 0 ? (r[at[k]] ?? '').trim() : '') || null;
  const seen = new Map<string, number>();
  return {
    missing,
    rows: missing.length ? [] : body.map((r, i) => {
      const c: CsvCrew = { name: cell(r, 'name') ?? '', phone: cell(r, 'phone'), kind: cell(r, 'kind'), language: cell(r, 'language') };
      if (!c.name) return { ...c, problem: 'No name.' };
      const check = checkCrewRow(c);
      if (!check.ok) return { ...c, problem: check.problem };
      const key = crewKey(check.data.name, check.data.phone_e164);
      const first = seen.get(key);
      if (first !== undefined) return { ...c, problem: `Same person as #${first + 1}.` };
      seen.set(key, i);
      return { ...c, problem: null };
    }),
  };
}

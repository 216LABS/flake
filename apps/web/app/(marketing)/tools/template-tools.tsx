'use client';

import { Button, Card, Input, Label, Select, Textarea } from '@flake/ui';
import { useState } from 'react';

/** The free templates (issue 237): fill in the browser, download a PDF and a spreadsheet (CSV, opens in Excel or Sheets). */
const cents = (v: string) => Math.round(Number(v || 0) * 100);
const money = (c: number) => `$${(c / 100).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const csvCell = (v: string | number) => (/[",\n]/.test(String(v)) ? `"${String(v).replace(/"/g, '""')}"` : String(v));
const today = () => new Date().toISOString().slice(0, 10);

function saveBlob(blob: Blob, name: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  a.click();
  URL.revokeObjectURL(url);
}
const saveCsv = (rows: (string | number)[][], name: string) => saveBlob(new Blob([`\uFEFF${rows.map((r) => r.map(csvCell).join(',')).join('\r\n')}\r\n`], { type: 'text/csv;charset=utf-8' }), name);

async function pdf(body: unknown, name: string) {
  const res = await fetch('/api/tools/template', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  if (!res.ok) throw new Error(((await res.json().catch(() => null)) as { error?: string } | null)?.error ?? 'Could not build the PDF');
  saveBlob(await res.blob(), name);
}

interface Line { description: string; qty: string; rate: string }
const STARTERS: Record<string, Line[]> = {
  per_push: [{ description: 'Plowing, per push', qty: '2', rate: '65' }, { description: 'Salt, 50 lb bags', qty: '4', rate: '18' }],
  per_inch: [{ description: 'Plowing, 4.1 to 8 inches', qty: '1', rate: '110' }, { description: 'Walks shoveled', qty: '1', rate: '35' }],
  seasonal: [{ description: 'Seasonal snow contract, installment 2 of 5', qty: '1', rate: '240' }],
};

function LinesEditor({ lines, setLines }: { lines: Line[]; setLines: (l: Line[]) => void }) {
  const total = lines.reduce((a, l) => a + Math.round(Number(l.qty || 0) * cents(l.rate)), 0);
  return (
    <div className="sm:col-span-2">
      <div className="text-sm font-medium text-ink-2">Lines</div>
      <ul className="mt-1 space-y-2">
        {lines.map((l, i) => (
          <li key={i} className="grid grid-cols-[1fr_4.5rem_6rem_auto] items-center gap-2">
            <Input aria-label={`Line ${i + 1} description`} value={l.description} onChange={(e) => setLines(lines.map((x, j) => (j === i ? { ...x, description: e.target.value } : x)))} data-testid="tpl-line-desc" />
            <Input aria-label={`Line ${i + 1} quantity`} type="number" inputMode="decimal" min={0} value={l.qty} onChange={(e) => setLines(lines.map((x, j) => (j === i ? { ...x, qty: e.target.value } : x)))} />
            <Input aria-label={`Line ${i + 1} price each`} type="number" inputMode="decimal" min={0} step="0.01" value={l.rate} onChange={(e) => setLines(lines.map((x, j) => (j === i ? { ...x, rate: e.target.value } : x)))} />
            <Button size="sm" variant="ghost" aria-label={`Remove line ${i + 1}`} disabled={lines.length === 1} onClick={() => setLines(lines.filter((_, j) => j !== i))}>Remove</Button>
          </li>
        ))}
      </ul>
      <div className="mt-2 flex items-center justify-between">
        <Button size="sm" variant="outline" disabled={lines.length >= 20} onClick={() => setLines([...lines, { description: '', qty: '1', rate: '' }])}>Add a line</Button>
        <span className="font-semibold" data-testid="tpl-total">Total {money(total)}</span>
      </div>
    </div>
  );
}

const linesBody = (lines: Line[]) => lines.filter((l) => l.description.trim()).map((l) => ({ description: l.description.trim(), quantity: Number(l.qty || 0), amount_cents: Math.round(Number(l.qty || 0) * cents(l.rate)) }));

export function InvoiceTemplate() {
  const [f, setF] = useState({ company: '', customer: '', number: '1001', date: today(), type: 'per_push', for_text: 'snow service, storm of', terms: 'Due on receipt', pay: '' });
  const [lines, setLines] = useState<Line[]>(STARTERS.per_push!);
  const [error, setError] = useState<string | null>(null);
  const ready = f.company.trim() && f.customer.trim() && f.number.trim() && linesBody(lines).length;
  return (
    <Card className="mt-6" data-testid="invoice-template">
      <div className="grid gap-3 sm:grid-cols-2">
        <div><Label htmlFor="i-co">Your company</Label><Input id="i-co" value={f.company} onChange={(e) => setF({ ...f, company: e.target.value })} data-testid="tpl-company" /></div>
        <div><Label htmlFor="i-cu">Bill to</Label><Input id="i-cu" value={f.customer} onChange={(e) => setF({ ...f, customer: e.target.value })} data-testid="tpl-customer" /></div>
        <div><Label htmlFor="i-no">Invoice number</Label><Input id="i-no" value={f.number} onChange={(e) => setF({ ...f, number: e.target.value })} /></div>
        <div><Label htmlFor="i-dt">Date</Label><Input id="i-dt" type="date" value={f.date} onChange={(e) => setF({ ...f, date: e.target.value })} /></div>
        <div><Label htmlFor="i-ty">How you price</Label><Select id="i-ty" value={f.type} onChange={(e) => { setF({ ...f, type: e.target.value }); setLines(STARTERS[e.target.value]!); }} data-testid="tpl-type"><option value="per_push">Per push</option><option value="per_inch">Per inch</option><option value="seasonal">Seasonal</option></Select></div>
        <div><Label htmlFor="i-for">For</Label><Input id="i-for" value={f.for_text} onChange={(e) => setF({ ...f, for_text: e.target.value })} /></div>
        <LinesEditor lines={lines} setLines={setLines} />
        <div><Label htmlFor="i-te">Terms</Label><Input id="i-te" value={f.terms} onChange={(e) => setF({ ...f, terms: e.target.value })} /></div>
        <div className="sm:col-span-2"><Label htmlFor="i-pay">How to pay (optional)</Label><Textarea id="i-pay" rows={2} placeholder="Check to Lakeshore Plow, 100 Main St, or Zelle to 216-555-0100" value={f.pay} onChange={(e) => setF({ ...f, pay: e.target.value })} /></div>
      </div>
      {error ? <p className="mt-2 text-sm text-danger" role="alert">{error}</p> : null}
      <div className="mt-4 flex flex-wrap gap-2">
        <Button variant="accent" disabled={!ready} data-testid="tpl-pdf" onClick={() => pdf({ kind: 'invoice', company: f.company, customer: f.customer, number: f.number, date: f.date, for_text: f.for_text, lines: linesBody(lines), terms: f.terms, pay_instructions: f.pay }, 'snow-removal-invoice.pdf').then(() => setError(null), (e: Error) => setError(e.message))}>Download PDF</Button>
        <Button variant="outline" data-testid="tpl-csv" onClick={() => saveCsv([['Invoice', f.number], ['Date', f.date], ['From', f.company], ['Bill to', f.customer], [], ['Description', 'Qty', 'Price each', 'Amount'], ...lines.map((l) => [l.description, l.qty, l.rate, (Number(l.qty || 0) * Number(l.rate || 0)).toFixed(2)]), [], ['Total', '', '', (linesBody(lines).reduce((a, l) => a + l.amount_cents, 0) / 100).toFixed(2)], ['Terms', f.terms]], 'snow-removal-invoice.csv')}>Download spreadsheet</Button>
      </div>
    </Card>
  );
}

export function EstimateTemplate() {
  const [f, setF] = useState({ company: '', customer: '', site: '', sqft: '', walks: '' });
  const [est, setEst] = useState<{ per_push_cents: number; per_event_cents: number; seasonal_cents: number } | null>(null);
  const [lines, setLines] = useState<Line[]>([]);
  const [error, setError] = useState<string | null>(null);
  const price = async () => {
    setError(null);
    try {
      const res = await fetch('/api/tools/price', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ sqft: Number(f.sqft) || undefined, address: Number(f.sqft) ? undefined : f.site || undefined, walks_lf: Number(f.walks) || undefined }) });
      const out = await res.json();
      if (!res.ok) throw new Error(out?.error ?? 'Could not price that lot');
      setEst(out.estimate);
      setLines([{ description: 'Plowing, per push', qty: '1', rate: (out.estimate.per_push_cents / 100).toFixed(2) }, { description: 'Or the whole season, seasonal contract', qty: '1', rate: (out.estimate.seasonal_cents / 100).toFixed(2) }]);
    } catch (e) {
      setError((e as Error).message);
    }
  };
  const ready = f.company.trim() && f.customer.trim() && linesBody(lines).length;
  return (
    <Card className="mt-6" data-testid="estimate-template">
      <div className="grid gap-3 sm:grid-cols-2">
        <div><Label htmlFor="e-co">Your company</Label><Input id="e-co" value={f.company} onChange={(e) => setF({ ...f, company: e.target.value })} data-testid="tpl-company" /></div>
        <div><Label htmlFor="e-cu">Prepared for</Label><Input id="e-cu" value={f.customer} onChange={(e) => setF({ ...f, customer: e.target.value })} data-testid="tpl-customer" /></div>
        <div className="sm:col-span-2"><Label htmlFor="e-si">Property address</Label><Input id="e-si" value={f.site} onChange={(e) => setF({ ...f, site: e.target.value })} data-testid="tpl-site" /></div>
        <div><Label htmlFor="e-sq">Paved area (sq ft, or leave blank to measure the address)</Label><Input id="e-sq" type="number" inputMode="numeric" min={0} value={f.sqft} onChange={(e) => setF({ ...f, sqft: e.target.value })} data-testid="tpl-sqft" /></div>
        <div><Label htmlFor="e-wk">Walks (linear feet, optional)</Label><Input id="e-wk" type="number" inputMode="numeric" min={0} value={f.walks} onChange={(e) => setF({ ...f, walks: e.target.value })} /></div>
      </div>
      <Button className="mt-3" variant="outline" disabled={!f.sqft && f.site.trim().length < 5} data-testid="tpl-price" onClick={() => void price()}>Suggest prices</Button>
      {est ? <p className="mt-2 text-sm text-muted" data-testid="tpl-suggested">Suggested from typical rates, which you can change: {money(est.per_push_cents)} per push, {money(est.per_event_cents)} per storm, {money(est.seasonal_cents)} for the season.</p> : null}
      {lines.length ? <div className="mt-3 grid gap-3 sm:grid-cols-2"><LinesEditor lines={lines} setLines={setLines} /></div> : null}
      {error ? <p className="mt-2 text-sm text-danger" role="alert">{error}</p> : null}
      <div className="mt-4 flex flex-wrap gap-2">
        <Button variant="accent" disabled={!ready} data-testid="tpl-pdf" onClick={() => pdf({ kind: 'estimate', company: f.company, customer: f.customer, site: f.site, lines: linesBody(lines) }, 'snow-removal-estimate.pdf').then(() => setError(null), (e: Error) => setError(e.message))}>Download estimate PDF</Button>
        <Button variant="outline" disabled={!lines.length} data-testid="tpl-csv" onClick={() => saveCsv([['Estimate for', f.customer], ['Property', f.site], ['From', f.company], [], ['Description', 'Qty', 'Price each'], ...lines.map((l) => [l.description, l.qty, l.rate])], 'snow-removal-estimate.csv')}>Download spreadsheet</Button>
      </div>
    </Card>
  );
}

const LOG_COLS = ['Date', 'Arrive', 'Leave', 'Snow (in)', 'Service (plow, salt, walks)', 'Salt amount', 'Weather', 'Driver initials'];

export function LogSheetTemplate() {
  const [f, setF] = useState({ company: '', site: '', season: '', rows: '25' });
  const [error, setError] = useState<string | null>(null);
  const rows = Math.min(40, Math.max(5, Math.round(Number(f.rows) || 25)));
  return (
    <Card className="mt-6" data-testid="log-template">
      <div className="grid gap-3 sm:grid-cols-2">
        <div><Label htmlFor="l-co">Company (optional)</Label><Input id="l-co" value={f.company} onChange={(e) => setF({ ...f, company: e.target.value })} data-testid="tpl-company" /></div>
        <div><Label htmlFor="l-si">Site (optional)</Label><Input id="l-si" value={f.site} onChange={(e) => setF({ ...f, site: e.target.value })} data-testid="tpl-site" /></div>
        <div><Label htmlFor="l-se">Season (optional)</Label><Input id="l-se" placeholder="2026-27" value={f.season} onChange={(e) => setF({ ...f, season: e.target.value })} /></div>
        <div><Label htmlFor="l-rw">Rows</Label><Input id="l-rw" type="number" min={5} max={40} value={f.rows} onChange={(e) => setF({ ...f, rows: e.target.value })} /></div>
      </div>
      {error ? <p className="mt-2 text-sm text-danger" role="alert">{error}</p> : null}
      <div className="mt-4 flex flex-wrap gap-2">
        <Button variant="accent" data-testid="tpl-pdf" onClick={() => pdf({ kind: 'log', company: f.company, site: f.site, season: f.season, rows }, 'snow-plow-log-sheet.pdf').then(() => setError(null), (e: Error) => setError(e.message))}>Download printable PDF</Button>
        <Button variant="outline" data-testid="tpl-csv" onClick={() => saveCsv([[`Snow plow service log${f.site ? `: ${f.site}` : ''}`], [], LOG_COLS, ...Array.from({ length: rows }, () => LOG_COLS.map(() => ''))], 'snow-plow-log-sheet.csv')}>Download spreadsheet</Button>
      </div>
    </Card>
  );
}

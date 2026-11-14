'use client';

import { Button, Card, Label, Table, Td, Th } from '@flake/ui';
import Link from 'next/link';
import { useState } from 'react';
import { api } from '@/lib/client';
import { customersFromCsv, type CsvCustomer } from '@/lib/csv';

type Result = { row: number; ok: true; customer: string; site: string; added_to_existing: boolean } | { row: number; ok: false; error: string };
const SAMPLE = 'name,address,label,email,phone,kind,billing\nBayview HOA,100 Lake Ave Lakewood OH,North drive,board@example.com,216-555-0101,HOA,invoice\nBayview HOA,120 Lake Ave Lakewood OH,South drive,,,HOA,invoice\nKim Lee,14 Elm St Lakewood OH,,kim@example.com,,residential,card';

/** Paste or upload, check every row, then add them 25 at a time, each address found on the map. */
export function ImportForm() {
  const [text, setText] = useState('');
  const [results, setResults] = useState<Result[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const parsed = text.trim() ? customersFromCsv(text) : null;
  const ready = parsed?.rows.filter((r) => !r.problem) ?? [];
  const run = async () => {
    setBusy(true);
    setError(null);
    setDone(0);
    const all: Result[] = [];
    try {
      for (let i = 0; i < ready.length; i += 25) {
        const batch = ready.slice(i, i + 25).map(({ problem: _p, ...r }) => r as CsvCustomer);
        const out = await api<{ results: Result[] }>('/api/customers/import', { body: { rows: batch } });
        all.push(...out.results.map((r) => ({ ...r, row: r.row + i })));
        setDone(Math.min(i + 25, ready.length));
      }
      setResults(all);
    } catch (e) {
      setResults(all);
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  if (results) {
    const ok = results.filter((r) => r.ok).length;
    return (
      <Card data-testid="import-results">
        <h2 className="font-semibold">{ok === 1 ? '1 lot added' : `${ok} lots added`}{results.length > ok ? `, ${results.length - ok} not` : ''}.</h2>
        {error ? <p className="mt-2 text-sm text-danger" role="alert">{error} The rows before it were saved.</p> : null}
        <ul className="mt-2 space-y-1 text-sm">
          {results.map((r) => <li key={r.row} className={r.ok ? '' : 'text-danger'} data-testid="import-row">{r.ok ? `${r.customer}: ${r.site}${r.added_to_existing ? ' (added to this customer)' : ''}` : `${ready[r.row]?.name ?? 'Row'}, ${ready[r.row]?.address ?? ''}: ${r.error}`}</li>)}
        </ul>
        <p className="mt-3 text-sm text-ink-2">Next: put the lots on a route, and send each customer a quote from their site page. A customer&apos;s lots go on one quote link.</p>
        <div className="mt-3 flex gap-2">
          <Link href="/customers" className="font-semibold text-link underline">Customers</Link>
          <Link href="/routes" className="font-semibold text-link underline">Routes</Link>
        </div>
      </Card>
    );
  }
  return (
    <Card>
      <p className="text-sm text-ink-2">Save your list as CSV from Excel or Google Sheets, with a first row naming the columns. <b>name</b> and <b>address</b> are needed; <b>label</b> (lot name), <b>email</b>, <b>phone</b>, <b>kind</b> (residential, commercial or HOA) and <b>billing</b> (card, bank, invoice or manual) are optional. Rows with the same name become one customer with several lots.</p>
      <Label className="mt-3" htmlFor="csv-file">CSV file</Label>
      <input id="csv-file" type="file" accept=".csv,text/csv" className="mt-1 block text-base" data-testid="csv-file" onChange={async (e) => { const f = e.target.files?.[0]; if (f) setText(await f.text()); }} />
      <Label className="mt-3" htmlFor="csv-text">Or paste it here</Label>
      <textarea id="csv-text" rows={8} value={text} onChange={(e) => setText(e.target.value)} placeholder={SAMPLE} className="mt-1 block w-full rounded-md border border-line p-2 font-mono text-base" data-testid="csv-text" />
      {parsed?.missing.length ? <p className="mt-2 text-sm text-danger" role="alert" data-testid="csv-missing">The first row needs a column called {parsed.missing.join(' and ')}.</p> : null}
      {parsed && !parsed.missing.length ? (
        <>
          <p className="mt-3 text-sm" data-testid="csv-summary">{parsed.rows.length === 1 ? '1 row' : `${parsed.rows.length} rows`}, {ready.length} ready{parsed.rows.length > ready.length ? `, ${parsed.rows.length - ready.length} with a problem (left out)` : ''}.</p>
          <div className="mt-2 max-h-80 overflow-auto">
            <Table stack>
              <thead><tr><Th>Name</Th><Th>Address</Th><Th>Lot</Th><Th>Check</Th></tr></thead>
              <tbody>
                {parsed.rows.slice(0, 200).map((r, i) => (
                  <tr key={i} data-testid="csv-row">
                    <Td>{r.name || '-'}</Td>
                    <Td label="Address">{r.address || '-'}</Td>
                    <Td label="Lot">{r.label || '-'}</Td>
                    <Td label="Check" className={r.problem ? 'text-danger' : 'text-ok-ink'}>{r.problem ?? 'Ready'}</Td>
                  </tr>
                ))}
              </tbody>
            </Table>
          </div>
        </>
      ) : null}
      <Button variant="accent" className="mt-4" disabled={busy || !ready.length} data-testid="csv-import" onClick={() => void run()}>{busy ? `Adding... ${done} of ${ready.length}` : `Add ${ready.length || ''} ${ready.length === 1 ? 'lot' : 'lots'}`.replace('  ', ' ')}</Button>
    </Card>
  );
}

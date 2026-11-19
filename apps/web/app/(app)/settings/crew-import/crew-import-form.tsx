'use client';

import { Button, Card, Label, Table, Td, Th } from '@flake/ui';
import Link from 'next/link';
import { useState } from 'react';
import { api } from '@/lib/client';
import { crewFromCsv, importCrewKind, importLanguage, type CsvCrew } from '@/lib/csv';

type Result = { row: number; ok: true; name: string } | { row: number; ok: false; error: string };
const SAMPLE = 'name,phone,kind,language\nDana Ruiz,216-555-0101,employee,es\nPat Kim,216-555-0102,,\nNorth Shore Plowing,,sub,';
const BATCH = 50;

/** Paste or upload, check every row, then add the good ones. Joining and texts stay the office's own step. */
export function CrewImportForm() {
  const [text, setText] = useState('');
  const [results, setResults] = useState<Result[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [fromFile, setFromFile] = useState(false);
  const parsed = text.trim() || fromFile ? crewFromCsv(text) : null;
  const ready = parsed?.rows.filter((r) => !r.problem) ?? [];
  const run = async () => {
    setBusy(true);
    setError(null);
    const all: Result[] = [];
    try {
      for (let i = 0; i < ready.length; i += BATCH) {
        const batch = ready.slice(i, i + BATCH).map(({ problem: _p, ...r }) => r as CsvCrew);
        const out = await api<{ results: Result[] }>('/api/crew/import', { body: { rows: batch } });
        all.push(...out.results.map((r) => ({ ...r, row: r.row + i })));
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
      <Card data-testid="crew-import-results">
        <h2 className="font-semibold">{ok === 1 ? '1 person added' : `${ok} people added`}{results.length > ok ? `, ${results.length - ok} not` : ''}.</h2>
        {error ? <p className="mt-2 text-sm text-danger" role="alert">{error} The rows before it were saved.</p> : null}
        <ul className="mt-2 space-y-1 text-sm">
          {results.map((r) => <li key={r.row} className={r.ok ? '' : 'text-danger'} data-testid="crew-import-row">{r.ok ? r.name : `${ready[r.row]?.name ?? 'Row'}: ${r.error}`}</li>)}
        </ul>
        <p className="mt-3 text-sm text-ink-2">Nobody has been texted. Next: on Crew, press Invite for each driver and send the join link from your phone. They agree to texts on that page.</p>
        <Link href="/settings?tab=crew" className="mt-3 inline-block font-semibold text-link underline">Back to Crew</Link>
      </Card>
    );
  }
  return (
    <Card>
      <p className="text-sm text-ink-2" data-testid="crew-import-help">Save your list as CSV from Excel or Google Sheets, with a first row naming the columns. <b>name</b> is needed; <b>phone</b> (mobile), <b>kind</b> (employee or sub; blank is employee) and <b>language</b> (English or Spanish; blank is English) are optional. Other columns are ignored. Someone already on your crew, by mobile or by name, is left out.</p>
      <Label className="mt-3" htmlFor="crew-csv-file">CSV file</Label>
      <input id="crew-csv-file" type="file" accept=".csv,text/csv" className="mt-1 block text-base" data-testid="crew-csv-file" onChange={async (e) => { const f = e.target.files?.[0]; if (f) { setFromFile(true); setText(await f.text()); } }} />
      <Label className="mt-3" htmlFor="crew-csv-text">Or paste it here</Label>
      <textarea id="crew-csv-text" rows={8} value={text} onChange={(e) => { setFromFile(false); setText(e.target.value); }} placeholder={SAMPLE} className="mt-1 block w-full rounded-md border border-line p-2 font-mono text-base" data-testid="crew-csv-text" />
      {parsed?.empty ? <p className="mt-2 text-sm text-danger" role="alert">This file has no rows. The first row names the columns, and each row after it is one person.</p> : null}
      {parsed?.missing.length ? <p className="mt-2 text-sm text-danger" role="alert" data-testid="crew-csv-missing">The first row needs a column called name.</p> : null}
      {parsed && !parsed.empty && !parsed.missing.length ? (
        <>
          <p className="mt-3 text-sm" data-testid="crew-csv-summary">{parsed.rows.length === 1 ? '1 row' : `${parsed.rows.length} rows`}, {ready.length} ready{parsed.rows.length > ready.length ? `, ${parsed.rows.length - ready.length} with a problem (left out)` : ''}.</p>
          <div className="mt-2 max-h-80 overflow-auto">
            <Table stack>
              <thead><tr><Th>Name</Th><Th>Mobile</Th><Th>Kind</Th><Th>Language</Th><Th>Check</Th></tr></thead>
              <tbody>
                {parsed.rows.slice(0, 300).map((r, i) => (
                  <tr key={i} data-testid="crew-csv-row">
                    <Td><span className="tabular text-muted">#{i + 1}</span> {r.name || '-'}</Td>
                    <Td label="Mobile">{r.phone || '-'}</Td>
                    <Td label="Kind">{importCrewKind(r.kind) === 'sub' ? 'Sub' : importCrewKind(r.kind) ? 'Employee' : r.kind}</Td>
                    <Td label="Language">{importLanguage(r.language) === 'es' ? 'Español' : importLanguage(r.language) ? 'English' : r.language}</Td>
                    <Td label="Check" className={r.problem ? 'text-danger' : 'text-ok-ink'}>{r.problem ?? 'Ready'}</Td>
                  </tr>
                ))}
              </tbody>
            </Table>
          </div>
        </>
      ) : null}
      <Button variant="accent" className="mt-4" disabled={busy || !ready.length} data-testid="crew-csv-import" onClick={() => void run()}>{busy ? 'Adding...' : `Add ${ready.length || ''} ${ready.length === 1 ? 'person' : 'people'}`.replace('  ', ' ')}</Button>
    </Card>
  );
}

'use client';

import { fmtLocal, zonedDayStart } from '@flake/core/time';
import { Button, Card, Input, Label, Select, Table, Td, Th } from '@flake/ui';
import { useState } from 'react';
import { api } from '@/lib/client';

const DAY = 86400000;

export function ProofForm({ sites, packets, preselect, tz }: { sites: { id: string; label: string; customer: string }[]; packets: any[]; preselect?: string; tz: string }) {
  const [siteId, setSiteId] = useState(preselect ?? sites[0]?.id ?? '');
  const [mode, setMode] = useState<'range' | 'claim'>('range');
  const [from, setFrom] = useState('2025-12-01');
  const [to, setTo] = useState(new Date().toISOString().slice(0, 10));
  const [claim, setClaim] = useState('');
  const [state, setState] = useState<'idle' | 'working' | 'ready'>('idle');
  const [result, setResult] = useState<{ url: string; manifest_sha256: string } | null>(null);
  const [error, setError] = useState<string | null>(null);

  const open = async (id: string) => {
    const r = await api(`/api/proof/${id}`);
    if (r.url) window.open(r.url, '_blank', 'noopener');
  };

  const generate = async () => {
    setError(null);
    setResult(null);
    setState('working');
    try {
      // These are the operator's calendar days. A 9 PM visit on the last day belongs in the range.
      const start = new Date(zonedDayStart(mode === 'claim' ? claim : from, tz).getTime() - (mode === 'claim' ? 2 * DAY : 0));
      const end = new Date(zonedDayStart(mode === 'claim' ? claim : to, tz).getTime() + (mode === 'claim' ? 3 * DAY : DAY) - 1000);
      const { id } = await api<{ id: string }>('/api/proof', { body: { siteId, from: start.toISOString(), to: end.toISOString() } });
      for (let i = 0; i < 90; i++) {
        const r = await api(`/api/proof/${id}`);
        if (r.status === 'ready') {
          setResult(r);
          setState('ready');
          return;
        }
        await new Promise((res) => setTimeout(res, 1000));
      }
      throw new Error('This is taking longer than expected. It will appear in the list below when ready.');
    } catch (e) {
      setError((e as Error).message);
      setState('idle');
    }
  };

  return (
    <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
      <Card>
        <Label htmlFor="site">Site</Label>
        <Select id="site" value={siteId} data-testid="proof-site" onChange={(e) => setSiteId(e.target.value)}>{sites.map((s) => <option key={s.id} value={s.id}>{s.label} ({s.customer})</option>)}</Select>
        <div className="mt-3 flex gap-3 text-sm">
          <label className="flex items-center gap-1"><input type="radio" checked={mode === 'range'} onChange={() => setMode('range')} /> Date range</label>
          <label className="flex items-center gap-1"><input type="radio" checked={mode === 'claim'} onChange={() => setMode('claim')} /> Claim date ± 48 h</label>
        </div>
        {mode === 'range' ? (
          <div className="mt-2 grid grid-cols-2 gap-2">
            <div><Label htmlFor="from">From</Label><Input id="from" type="date" value={from} onChange={(e) => setFrom(e.target.value)} /></div>
            <div><Label htmlFor="to">To</Label><Input id="to" type="date" value={to} onChange={(e) => setTo(e.target.value)} /></div>
          </div>
        ) : (
          <div className="mt-2"><Label htmlFor="claim">Claim date</Label><Input id="claim" type="date" value={claim} onChange={(e) => setClaim(e.target.value)} /></div>
        )}
        <Button variant="accent" className="mt-4 w-full" disabled={!siteId || state === 'working' || (mode === 'claim' && !claim)} data-testid="proof-generate" onClick={() => void generate()}>{state === 'working' ? 'Generating...' : 'Generate'}</Button>
        {error ? <p className="mt-2 text-sm text-red-700" role="alert">{error}</p> : null}
        {result ? (
          <div className="mt-3 rounded-md bg-emerald-50 p-3 text-sm" data-testid="proof-ready">
            <a className="font-medium text-sky-800 underline" data-testid="proof-download" href={result.url}>Download PDF</a>
            <p className="mt-1 break-all text-xs text-slate-600">Manifest SHA-256: <span data-testid="manifest-hash">{result.manifest_sha256}</span></p>
          </div>
        ) : null}
      </Card>
      <div className="lg:col-span-2">
        <h2 className="mb-2 font-semibold">Past packets</h2>
        <Table>
          <thead><tr><Th>Site</Th><Th>Period</Th><Th>Created</Th><Th>Manifest</Th><Th></Th></tr></thead>
          <tbody>
            {packets.map((p) => (
              <tr key={p.id}>
                <Td>{sites.find((s) => s.id === p.site_id)?.label}</Td>
                <Td>{fmtLocal(p.from_ts, tz, { month: 'short', day: 'numeric', year: 'numeric' })} to {fmtLocal(p.to_ts, tz, { month: 'short', day: 'numeric', year: 'numeric' })}</Td>
                <Td>{fmtLocal(p.created_at, tz)}</Td>
                <Td className="font-mono text-xs">{p.manifest_sha256?.slice(0, 12)}</Td>
                <Td><Button size="sm" variant="ghost" onClick={() => void open(p.id)}>Open</Button></Td>
              </tr>
            ))}
            {!packets.length ? <tr><Td colSpan={5}>None yet.</Td></tr> : null}
          </tbody>
        </Table>
      </div>
    </div>
  );
}

'use client';

import { addDays, fmtLocal, todayIn, zonedDayEnd, zonedDayStart } from '@flake/core/time';
import { Button, Card, Input, Label, Select, Table, Td, Th } from '@flake/ui';
import { useEffect, useState } from 'react';
import { api } from '@/lib/client';


export function ProofForm({ sites, packets, preselect, tz }: { sites: { id: string; label: string; customer: string }[]; packets: any[]; preselect?: string; tz: string }) {
  const [siteId, setSiteId] = useState(preselect ?? sites[0]?.id ?? '');
  const [mode, setMode] = useState<'range' | 'claim'>('range');
  // This season so far: snow seasons start in the fall, so before July it's the one that began last October.
  // Dates are the company's calendar: the UTC date is already tomorrow on a storm evening.
  const [from, setFrom] = useState(() => {
    const [y, m] = todayIn(tz).split('-').map(Number);
    return `${m! >= 7 ? y : y! - 1}-10-01`;
  });
  const [to, setTo] = useState(() => todayIn(tz));
  const [claim, setClaim] = useState('');
  const [state, setState] = useState<'idle' | 'working' | 'ready'>('idle');
  const [result, setResult] = useState<{ url: string; manifest_sha256: string } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [preview, setPreview] = useState<{ visits: number; visits_with_photos: number; photos: number } | null>(null);

  const span = () => mode === 'claim'
    ? (claim ? { start: zonedDayStart(addDays(claim, -2), tz), end: zonedDayEnd(addDays(claim, 2), tz) } : null)
    : (from && to ? { start: zonedDayStart(from, tz), end: zonedDayEnd(to, tz) } : null);
  // How many visits and photos the packet will hold, before anyone waits for a PDF (issue 43).
  useEffect(() => {
    setPreview(null);
    let range: ReturnType<typeof span>;
    try {
      range = span();
    } catch {
      return;
    }
    if (!siteId || !range || range.start >= range.end) return;
    let live = true;
    const t = setTimeout(() => {
      api<{ visits: number; visits_with_photos: number; photos: number }>(`/api/proof/preview?siteId=${siteId}&from=${encodeURIComponent(range!.start.toISOString())}&to=${encodeURIComponent(range!.end.toISOString())}`)
        .then((x) => live && setPreview(x), () => undefined);
    }, 250);
    return () => {
      live = false;
      clearTimeout(t);
    };
  }, [siteId, mode, from, to, claim, tz]);

  const open = async (id: string) => {
    // Safari only allows a new tab during the tap itself, so it opens first and gets its address after.
    const tab = window.open('about:blank', '_blank');
    if (tab) tab.opener = null;
    try {
      const r = await api(`/api/proof/${id}`);
      if (!r.url) throw new Error('That packet is still being made. Try again in a minute.');
      if (tab) tab.location.href = r.url;
      else window.location.href = r.url;
    } catch (e) {
      tab?.close();
      setError((e as Error).message);
    }
  };

  const generate = async () => {
    setError(null);
    setResult(null);
    setState('working');
    try {
      // These are the operator's calendar days. A 9 PM visit on the last day belongs in the range.
      // Whole local days on both ends, so a DST day ends at 11:59:59 PM, not an hour early or late (issue 16).
      const start = zonedDayStart(mode === 'claim' ? addDays(claim, -2) : from, tz);
      const end = zonedDayEnd(mode === 'claim' ? addDays(claim, 2) : to, tz);
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
          <div className="mt-2 grid grid-cols-1 gap-2 sm:grid-cols-2">
            <div className="min-w-0"><Label htmlFor="from">From</Label><Input id="from" type="date" value={from} onChange={(e) => setFrom(e.target.value)} /></div>
            <div className="min-w-0"><Label htmlFor="to">To</Label><Input id="to" type="date" value={to} onChange={(e) => setTo(e.target.value)} /></div>
          </div>
        ) : (
          <div className="mt-2"><Label htmlFor="claim">Claim date</Label><Input id="claim" type="date" value={claim} onChange={(e) => setClaim(e.target.value)} /></div>
        )}
        {preview ? (
          <p className={preview.visits && !preview.photos ? 'mt-3 rounded-md bg-warn-tint p-2 text-sm text-warn-ink' : 'mt-3 text-sm text-muted'} data-testid="proof-preview">
            {!preview.visits ? 'No visits at this site in these dates. The packet will show the contract and weather only.'
              : `${preview.visits} visit${preview.visits === 1 ? '' : 's'}, ${preview.photos} photo${preview.photos === 1 ? '' : 's'}.${!preview.photos ? ' None of these visits has photos; the packet will say so.' : preview.visits_with_photos < preview.visits ? ` ${preview.visits - preview.visits_with_photos} visit${preview.visits - preview.visits_with_photos === 1 ? ' has' : 's have'} no photos.` : ''}`}
          </p>
        ) : null}
        <Button variant="accent" className="mt-4 w-full" disabled={!siteId || state === 'working' || (mode === 'claim' && !claim)} data-testid="proof-generate" onClick={() => void generate()}>{state === 'working' ? 'Generating...' : 'Generate'}</Button>
        {error ? <p className="mt-2 text-sm text-danger" role="alert">{error}</p> : null}
        {result ? (
          <div className="mt-3 rounded-md bg-ok-tint p-3 text-sm" data-testid="proof-ready">
            <a className="font-medium text-link underline" data-testid="proof-download" href={result.url}>Download PDF</a>
            <p className="mt-1 break-all text-xs text-muted">Manifest SHA-256: <span data-testid="manifest-hash">{result.manifest_sha256}</span></p>
          </div>
        ) : null}
      </Card>
      <div className="lg:col-span-2">
        <h2 className="mb-2 font-semibold">Past packets</h2>
        <Table stack data-testid="past-packets">
          <thead><tr><Th>Site</Th><Th>Period</Th><Th>Created</Th><Th>Manifest</Th><Th><span className="sr-only">Actions</span></Th></tr></thead>
          <tbody>
            {packets.map((p) => (
              <tr key={p.id}>
                <Td className="font-medium">{sites.find((s) => s.id === p.site_id)?.label}</Td>
                <Td label="Period">{fmtLocal(p.from_ts, tz, { month: 'short', day: 'numeric', year: 'numeric' })} to {fmtLocal(p.to_ts, tz, { month: 'short', day: 'numeric', year: 'numeric' })}</Td>
                <Td label="Created">{fmtLocal(p.created_at, tz)}</Td>
                <Td label="Manifest" className="font-mono text-xs">{p.manifest_sha256?.slice(0, 12)}</Td>
                <Td><Button size="sm" variant="outline" className="max-md:mt-1 max-md:h-11 max-md:w-full" data-testid="packet-open" onClick={() => void open(p.id)}>Open</Button></Td>
              </tr>
            ))}
            {!packets.length ? <tr><Td colSpan={5}>None yet.</Td></tr> : null}
          </tbody>
        </Table>
      </div>
    </div>
  );
}

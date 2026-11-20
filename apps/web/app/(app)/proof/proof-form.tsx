'use client';

import { addDays, fmtLocal, todayIn, zonedDayEnd, zonedDayStart } from '@flake/core/time';
import { Button, Card, Input, Label, Segmented, Table, Td, Th } from '@flake/ui';
import { useEffect, useState } from 'react';
import { api } from '@/lib/client';
import { ButtonA } from '@/components/links';
import { LotPicker } from '@/components/lot-picker';
import type { LotOption } from '@/lib/lots';


export function ProofForm({ sites, packets: firstPackets, preselect, tz, incident: startIncident }: { sites: LotOption[]; packets: any[]; preselect?: string; tz: string; incident?: string }) {
  const [siteId, setSiteId] = useState(preselect ?? sites[0]?.id ?? '');
  // Opened from a claim (issue 165): the incident mode, with the claim's time filled in.
  const [mode, setMode] = useState<'range' | 'claim' | 'incident'>(startIncident ? 'incident' : 'range');
  const [incident, setIncident] = useState(startIncident ?? '');
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
  // The list refreshes itself when a slow packet lands (issue 196), so nobody reloads the page to find it.
  const [packets, setPackets] = useState(firstPackets);
  const [waitingFor, setWaitingFor] = useState<string | null>(null);
  const [seconds, setSeconds] = useState(0);
  const reloadList = async () => setPackets((await api<{ items: any[] }>('/api/proof')).items);
  useEffect(() => {
    if (state !== 'working') return;
    setSeconds(0);
    const t = setInterval(() => setSeconds((n) => n + 1), 1000);
    return () => clearInterval(t);
  }, [state]);
  useEffect(() => {
    if (!waitingFor) return;
    const t = setInterval(async () => {
      const r = await api(`/api/proof/${waitingFor}`).catch(() => null);
      if (r?.status === 'ready') {
        setWaitingFor(null);
        await reloadList();
      }
    }, 5000);
    return () => clearInterval(t);
  }, [waitingFor]);

  // A slip-and-fall (issue 163): the moment it happened, and 72 hours before (the storm and the night after) to 24 after.
  const incidentAt = () => {
    const m = /^(\d{4}-\d{2}-\d{2})T(\d{2}):(\d{2})$/.exec(incident);
    return m ? new Date(zonedDayStart(m[1]!, tz).getTime() + (Number(m[2]) * 60 + Number(m[3])) * 60_000) : null;
  };
  const span = () => mode === 'incident'
    ? (incidentAt() ? { start: new Date(incidentAt()!.getTime() - 72 * 3_600_000), end: new Date(incidentAt()!.getTime() + 24 * 3_600_000) } : null)
    : mode === 'claim'
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
  }, [siteId, mode, from, to, claim, incident, tz]);

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
      const range = span();
      if (!range) throw new Error('Pick the dates first.');
      const { id } = await api<{ id: string }>('/api/proof', { body: { siteId, from: range.start.toISOString(), to: range.end.toISOString(), ...(mode === 'incident' ? { incident_at: incidentAt()!.toISOString() } : {}) } });
      for (let i = 0; i < 90; i++) {
        const r = await api(`/api/proof/${id}`);
        if (r.status === 'ready') {
          setResult(r);
          setState('ready');
          void reloadList();
          return;
        }
        await new Promise((res) => setTimeout(res, 1000));
      }
      setWaitingFor(id);
      throw new Error('This one is taking longer than usual. It will appear in Past packets on its own when it is ready, so you can leave this page open or come back.');
    } catch (e) {
      setError((e as Error).message);
      setState('idle');
    }
  };

  return (
    <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
      <Card>
        <Label htmlFor="site">Lot</Label>
        {(() => {
          const lot = sites.find((s) => s.id === siteId);
          return lot ? <p className="mb-2 rounded-md bg-tint px-3 py-2 text-sm" data-testid="proof-site" data-site-id={lot.id}><b>{lot.label}</b><span className="block text-xs text-muted">{lot.address}{lot.customer && !lot.label.includes(lot.customer) ? ` · ${lot.customer}` : ''}</span></p> : null;
        })()}
        <LotPicker label="Find a lot" placeholder={siteId ? 'Pick a different lot' : 'Search by lot, street or customer'} testId="proof-lot" lots={sites} onPick={([id]) => id && setSiteId(id)} />
        <Segmented className="mt-3" label="Which dates" name="proof-mode" testId="proof-mode" value={mode} options={[['range', 'Date range'], ['claim', 'Claim date ± 48 h'], ['incident', 'Slip or damage (incident)']] as const} onChange={setMode} />
        {mode === 'range' ? (
          <div className="mt-2 grid grid-cols-1 gap-2 sm:grid-cols-2">
            <div className="min-w-0"><Label htmlFor="from">From</Label><Input id="from" type="date" value={from} onChange={(e) => setFrom(e.target.value)} /></div>
            <div className="min-w-0"><Label htmlFor="to">To</Label><Input id="to" type="date" value={to} onChange={(e) => setTo(e.target.value)} /></div>
          </div>
        ) : mode === 'claim' ? (
          <div className="mt-2"><Label htmlFor="claim">Claim date</Label><Input id="claim" type="date" value={claim} onChange={(e) => setClaim(e.target.value)} /></div>
        ) : (
          <div className="mt-2">
            <Label htmlFor="incident">When it happened</Label>
            <Input id="incident" type="datetime-local" value={incident} onChange={(e) => setIncident(e.target.value)} data-testid="proof-incident" />
            <p className="mt-1 text-xs text-muted">For a slip or damage claim. The packet starts with a plain summary: the last service before and the next after, the weather each hour from the nearest airport station with every freeze marked, the crew&apos;s problem reports, and what the contract covers. It covers 72 hours before to 24 hours after.</p>
          </div>
        )}
        {preview ? (
          <p className={!preview.visits || !preview.photos ? 'mt-3 rounded-md border border-warn-line bg-warn-tint p-3 text-sm font-medium text-warn-ink' : 'mt-3 text-sm text-muted'} data-testid="proof-preview">
            {!preview.visits ? 'No visits at this lot between these dates. The packet would only show the contract and weather.'
              : `${preview.visits} visit${preview.visits === 1 ? '' : 's'}, ${preview.photos} photo${preview.photos === 1 ? '' : 's'}.${!preview.photos ? ' None of these visits has photos; the packet will say so.' : preview.visits_with_photos < preview.visits ? ` ${preview.visits - preview.visits_with_photos} visit${preview.visits - preview.visits_with_photos === 1 ? ' has' : 's have'} no photos.` : ''}`}
          </p>
        ) : null}
        {/* No visits: still possible, on purpose (issue 196). */}
        <Button variant={preview && !preview.visits ? 'outline' : 'accent'} className="mt-4 w-full" disabled={!siteId || state === 'working' || (mode === 'claim' && !claim) || (mode === 'incident' && !incidentAt())} data-testid="proof-generate" onClick={() => void generate()}>{state === 'working' ? 'Making your packet' : preview && !preview.visits ? 'Make it anyway' : 'Make packet'}</Button>
        {state === 'working' ? (
          <div className="mt-3 rounded-md bg-tint p-3 text-sm" role="status" data-testid="proof-progress">
            <p className="font-semibold">Making your packet. Usually under a minute.</p>
            <ol className="mt-2 space-y-1">
              {['Gathering visits and photos', 'Weather', 'Building the PDF'].map((step, i) => {
                const at = [0, 3, 7][i]!;
                const next = [3, 7, Infinity][i]!;
                const now = seconds >= at && seconds < next;
                const done = seconds >= next;
                return <li key={step} className={done ? 'text-muted' : now ? 'font-medium' : 'text-faint'}>{done ? '✓' : now ? '•' : '○'} {step}</li>;
              })}
            </ol>
          </div>
        ) : null}
        {error ? <p className="mt-2 text-sm text-danger" role="alert">{error}</p> : null}
        {result ? (
          <div className="mt-3 rounded-md bg-ok-tint p-3 text-sm" data-testid="proof-ready">
            <ButtonA variant="accent" data-testid="proof-download" href={result.url}>Download PDF</ButtonA>
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

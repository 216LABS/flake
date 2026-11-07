'use client';

import { Badge, Button, Card, Input, Select, cn, Progress } from '@flake/ui';
import { useRouter } from 'next/navigation';
import QRCode from 'qrcode';
import { useEffect, useMemo, useState } from 'react';
import { api } from '@/lib/client';
import { MapView, type MapPin, type TileLayers } from '@/components/map-view';

const STATUS_WORD: Record<string, string> = { open: 'Open', enroute: 'On the way', onsite: 'On site', done: 'Done', skipped: 'Skipped', problem: 'Problem' };
const STATUS_TONE: Record<string, 'gray' | 'blue' | 'green' | 'amber' | 'red'> = { open: 'gray', enroute: 'blue', onsite: 'amber', done: 'green', skipped: 'gray', problem: 'red' };
const PIN_COLOR: Record<string, string> = { open: '#475569', enroute: '#0284c7', onsite: '#d97706', done: '#059669', skipped: '#94a3b8', problem: '#dc2626' };

function since(iso: string | null, now: number) {
  if (!iso) return null;
  const m = Math.max(0, Math.floor((now - Date.parse(iso)) / 60000));
  return m < 60 ? `${m} min` : `${Math.floor(m / 60)} h ${m % 60} min`;
}
const dash = (v: number | null, u = '"') => (v === null ? 'unavailable' : `${v}${u}`);

export function StormBoard({ stormId, initial, layers, canEdit, canText }: { stormId: string; initial: any; layers: TileLayers; canEdit: boolean; canText: boolean }) {
  const router = useRouter();
  const [live, setLive] = useState<any>(initial);
  const [now, setNow] = useState(Date.parse(initial.storm.started_at));
  const [error, setError] = useState<string | null>(null);
  const [notify, setNotify] = useState(false);
  const [closePrompt, setClosePrompt] = useState<string | null>(null);
  const [showMap, setShowMap] = useState(false);
  const [dragging, setDragging] = useState<string | null>(null);
  const [linkFor, setLinkFor] = useState<{ name: string; link: string; qr: string } | null>(null);
  const [calloutTime, setCalloutTime] = useState('');
  const [calloutSent, setCalloutSent] = useState<string | null>(null);

  const load = async () => {
    try {
      setLive(await api(`/api/storms/${stormId}/live`));
    } catch {
      // Keep the last good board on a blip.
    }
  };
  useEffect(() => {
    setNow(Date.now());
    const stopCount = (initial.runs as { stops: unknown[] }[]).reduce((n, r) => n + r.stops.length, 0);
    const everyMs = stopCount > 300 ? 10000 : stopCount > 100 ? 5000 : 3000;
    const poll = setInterval(() => {
      if (document.visibilityState === 'visible') void load();
    }, everyMs);
    const onVisible = () => {
      if (document.visibilityState === 'visible') void load();
    };
    document.addEventListener('visibilitychange', onVisible);
    const clock = setInterval(() => setNow(Date.now()), 30000);
    return () => {
      clearInterval(poll);
      clearInterval(clock);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, []);

  const act = async (fn: () => Promise<unknown>) => {
    setError(null);
    try {
      await fn();
      await load();
    } catch (e) {
      setError((e as Error).message);
    }
  };

  const move = (stopId: string, runId: string) => act(() => api(`/api/run-stops/${stopId}`, { method: 'PATCH', body: { storm_run_id: runId } }));
  const closed = live.storm.status !== 'active';
  const editable = !closed && canEdit;
  const unpublished = live.runs.some((r: any) => !r.published_at);
  const allStops: any[] = useMemo(() => live.runs.flatMap((r: any) => r.stops), [live]);
  const pins: MapPin[] = useMemo(() => [
    ...allStops.map((s) => ({ id: s.id, lat: s.lat, lon: s.lon, color: PIN_COLOR[s.status], label: `${s.label}: ${s.status}` })),
    ...live.runs.filter((r: any) => r.position).map((r: any) => ({ id: `pos-${r.id}`, lat: r.position.lat, lon: r.position.lon, color: '#7c3aed', label: `${r.crew?.name ?? 'Driver'} last position` })),
  ], [live, allStops]);

  const elapsed = since(live.storm.started_at, live.storm.closed_at ? Date.parse(live.storm.closed_at) : now);

  const showLink = async (r: any) => {
    setLinkFor({ name: r.crew?.name ?? r.name, link: r.link, qr: await QRCode.toDataURL(r.link, { margin: 1, width: 240 }) });
  };

  return (
    <div>
      <section className="mb-4 overflow-hidden rounded-md bg-slate-950 text-white">
        <div className="flex flex-wrap items-end gap-x-8 gap-y-3 p-4">
        <div><div className="font-display text-xs font-semibold uppercase tracking-wider text-slate-300">Storm time</div><div className="font-display tabular text-2xl font-semibold md:text-3xl" data-testid="storm-timer">{elapsed}</div></div>
        <div>
          <div className="font-display text-xs font-semibold uppercase tracking-wider text-slate-300">Forecast next 12 h / elapsed</div>
          <div className="font-display tabular text-2xl font-semibold md:text-3xl">{dash(live.weather.forecast_in)} / {dash(live.weather.elapsed_in)}</div>
          <div className={cn('text-xs', live.weather.synthetic ? 'text-amber-300' : 'text-slate-300')}>{live.weather.breaker_open ? 'Weather unavailable' : live.weather.source}</div>
        </div>
        <div className="w-full min-w-48 flex-1">
          <Progress className="mb-2 bg-slate-700" value={live.counts.done + live.counts.skipped} max={live.counts.total} label="Stops finished" />
        <div className="tabular flex flex-wrap gap-x-3 text-sm" data-testid="counts">
          <span><b>{live.counts.done}</b> done</span>
          <span><b>{live.counts.open}</b> open</span>
          <span><b>{live.counts.onsite}</b> on site</span>
          <span className={live.counts.late ? 'font-bold text-amber-300' : ''}><b>{live.counts.late}</b> late</span>
        </div>
        </div>
        <div className="grid w-full grid-cols-2 gap-2 sm:flex sm:flex-wrap lg:ml-auto lg:w-auto">
          {editable && unpublished ? <Button variant="accent" data-testid="publish" onClick={() => act(() => api(`/api/storms/${stormId}/publish`, { method: 'POST' }))}>Publish</Button> : null}
          {editable ? <Button variant="outline" data-testid="notify-open" onClick={() => setNotify(true)}>Notify customers</Button> : null}
          {editable ? <Button variant="outline" onClick={() => act(() => api(`/api/storms/${stormId}/pass`, { method: 'POST' }))}>Another pass</Button> : null}
          <Button variant="outline" onClick={() => setShowMap(!showMap)}>{showMap ? 'Hide map' : 'Map'}</Button>
          {editable ? (
            <Button variant="danger" data-testid="close-storm" onClick={async () => {
              setError(null);
              try {
                await api(`/api/storms/${stormId}/close`, { body: { force: false } });
                router.push(`/billing?storm=${stormId}`);
              } catch (e) {
                const err = e as Error & { code?: string };
                if (err.code === 'onsite') setClosePrompt(err.message);
                else setError(err.message);
              }
            }}>Close storm</Button>
          ) : closed ? <Badge tone="green" data-testid="storm-closed">{live.storm.status}</Badge> : null}
        </div>
        </div>
      </section>

      {editable && canText ? (
        <div className="mb-3 flex flex-wrap items-center gap-2 text-sm">
          <span className="text-slate-600">Ask drivers by text, reply YES or NO, plowing expected at</span>
          <Input aria-label="Expected start time" className="h-8 w-28" placeholder="4:00 AM" value={calloutTime} data-testid="callout-time" onChange={(e) => setCalloutTime(e.target.value)} />
          <Button size="sm" variant="outline" disabled={!calloutTime} data-testid="callout-send" onClick={() => act(async () => {
            const out = await api<{ sent: number }>(`/api/storms/${stormId}/callout`, { body: { time: calloutTime } });
            setCalloutSent(`Asked ${out.sent} driver${out.sent === 1 ? '' : 's'}. Replies show on each column.`);
          })}>Call out</Button>
          {calloutSent ? <span className="text-slate-600" data-testid="callout-sent">{calloutSent}</span> : null}
        </div>
      ) : null}

      {error ? <p className="mb-3 rounded-md bg-red-50 p-3 text-sm text-red-800" role="alert">{error}</p> : null}
      {closePrompt ? (
        <Card className="mb-3 border-beacon">
          <p className="text-sm">{closePrompt} Close anyway?</p>
          <div className="mt-2 flex gap-2">
            <Button variant="danger" data-testid="close-force" onClick={async () => {
              await api(`/api/storms/${stormId}/close`, { body: { force: true } });
              router.push(`/billing?storm=${stormId}`);
            }}>Close anyway</Button>
            <Button variant="outline" onClick={() => setClosePrompt(null)}>Keep open</Button>
          </div>
        </Card>
      ) : null}

      {notify ? <NotifyPanel stops={allStops} onClose={() => setNotify(false)} onSend={(siteIds, template, time) => act(async () => {
        await api(`/api/storms/${stormId}/notify`, { body: { siteIds, template, time } });
        setNotify(false);
      })} /> : null}

      {linkFor ? (
        <Card className="mb-3" data-testid="link-panel">
          <div className="flex flex-wrap items-center gap-4">
            <img src={linkFor.qr} alt={`QR code for ${linkFor.name}`} width={160} height={160} />
            <div className="min-w-0 flex-1">
              <p className="font-medium">{linkFor.name}&apos;s route link</p>
              <Input readOnly value={linkFor.link} data-testid="run-link" className="mt-1" />
              <div className="mt-2 flex gap-2">
                <Button size="sm" onClick={() => navigator.clipboard.writeText(linkFor.link)}>Copy link</Button>
                <Button size="sm" variant="ghost" onClick={() => setLinkFor(null)}>Close</Button>
              </div>
            </div>
          </div>
        </Card>
      ) : null}

      {showMap ? <div className="mb-4"><MapView layers={layers} center={{ lat: allStops[0]?.lat ?? 41.48, lon: allStops[0]?.lon ?? -81.8 }} zoom={12} pins={pins} className="h-80" /></div> : null}

      <div className="flex flex-col gap-4 lg:flex-row">
        <div className="flex min-w-0 flex-1 snap-x gap-3 overflow-x-auto pb-2">
          {live.runs.map((r: any) => (
            <section
              key={r.id}
              className={cn('w-[86%] max-w-80 shrink-0 snap-start rounded-md bg-slate-200/70 p-2 md:w-72', dragging && 'ring-2 ring-slate-900')}
              data-testid="run-column"
              data-run={r.id}
              onDragOver={(e) => e.preventDefault()}
              onDrop={(e) => {
                e.preventDefault();
                if (dragging) void move(dragging, r.id);
                setDragging(null);
              }}
            >
              <header className="mb-2 px-1">
                <div className="flex items-baseline justify-between gap-2"><div className="font-display text-lg font-semibold leading-tight">{r.name}{r.pass > 1 ? ` (pass ${r.pass})` : ''}</div><div className="tabular shrink-0 text-xs font-medium text-slate-600">{r.stops.filter((x: any) => ['done', 'skipped'].includes(x.status)).length} of {r.stops.length}</div></div>
                <div className="text-sm text-slate-600">{r.crew?.name ?? 'No driver'}{r.crew?.kind === 'sub' ? ' (sub)' : ''}{r.crew?.callout_reply ? `, replied ${r.crew.callout_reply}` : ''}</div>
                {editable ? (
                  <Select aria-label={`Driver for ${r.name}`} data-testid="assign-driver" className="mt-1 h-8 py-0 text-xs" value={r.crew?.id ?? ''} onChange={(e) => e.target.value && void act(() => api(`/api/runs/${r.id}`, { method: 'PATCH', body: { crew_id: e.target.value } }))}>
                    <option value="">Choose a driver</option>
                    {live.crew.map((c: any) => <option key={c.id} value={c.id}>{c.name}{c.kind === 'sub' ? ' (sub)' : ''}</option>)}
                  </Select>
                ) : null}
                {r.link && r.crew && !r.crew.reachable ? <p className="mt-1 text-xs font-medium text-amber-800" data-testid="no-reach">We can&apos;t text or email {r.crew.name}, so they don&apos;t have this route. Show them the QR code.</p> : null}
                {r.link ? <Button size="sm" variant="ghost" className="-ml-3" data-testid="show-link" onClick={() => showLink(r)}>QR / copy link</Button> : null}
              </header>
              <ul className="space-y-2">
                {r.stops.map((s: any) => (
                  <li key={s.id} draggable={editable && s.status !== 'onsite' && s.status !== 'done'} onDragStart={(e) => { e.dataTransfer.setData('text/plain', s.id); e.dataTransfer.effectAllowed = 'move'; setDragging(s.id); }} onDragEnd={() => setDragging(null)} data-testid="stop-card" data-status={s.status} className={cn('rounded-md border border-slate-200 bg-white p-2 text-sm', s.status === 'done' && 'opacity-70', s.status === 'onsite' && 'border-beacon ring-1 ring-beacon', s.late && 'border-red-600 bg-red-50')}>
                    <div className="flex items-start justify-between gap-2">
                      <div className="font-medium">{s.seq}. {s.label}</div>
                      <Badge className="shrink-0" tone={STATUS_TONE[s.status]}>{STATUS_WORD[s.status] ?? s.status}</Badge>
                    </div>
                    <div className="text-xs text-slate-600">{s.customer}</div>
                    {s.late ? <div className="text-xs font-bold text-red-700">Late</div> : null}
                    {s.arrived_at ? <div className="text-xs text-slate-600">On site {since(s.arrived_at, now)}</div> : null}
                    {editable && !['done', 'onsite'].includes(s.status) ? (
                      <div className="mt-1 flex gap-1">
                        <Select aria-label={`Move ${s.label}`} data-testid="move-to" className="h-8 py-0 text-xs" value="" onChange={(e) => e.target.value && void move(s.id, e.target.value)}>
                          <option value="">Move to...</option>
                          {live.runs.filter((x: any) => x.id !== r.id).map((x: any) => <option key={x.id} value={x.id}>{x.name} ({x.crew?.name ?? 'no driver'})</option>)}
                        </Select>
                        <Button size="sm" variant="ghost" data-testid="skip-toggle" onClick={() => act(() => api(`/api/run-stops/${s.id}`, { method: 'PATCH', body: { status: s.status === 'skipped' ? 'open' : 'skipped' } }))}>{s.status === 'skipped' ? 'Reopen' : 'Skip'}</Button>
                      </div>
                    ) : null}
                  </li>
                ))}
              </ul>
            </section>
          ))}
        </div>
        <aside className={cn('order-first w-full shrink-0 lg:order-none lg:block lg:w-72', !live.alerts.length && 'hidden')}>
          <Card>
            <h2 className="font-semibold">Alerts</h2>
            {live.alerts.length ? (
              <ul className="mt-2 space-y-2 text-sm" data-testid="alerts-rail">
                {live.alerts.map((a: any, i: number) => (
                  <li key={i} className={cn('rounded-md p-2', a.kind === 'late' || a.kind === 'problem' ? 'bg-red-50 text-red-900' : 'bg-amber-50 text-amber-900')}>
                    {a.text}
                    {a.problem_id ? <Button size="sm" variant="ghost" data-testid="resolve-problem" onClick={() => act(() => api(`/api/problems/${a.problem_id}`, { method: 'PATCH' }))}>Resolved</Button> : null}
                  </li>
                ))}
              </ul>
            ) : <p className="mt-2 text-sm text-slate-600">Nothing needs you right now.</p>}
          </Card>
        </aside>
      </div>
    </div>
  );
}

function NotifyPanel({ stops, onSend, onClose }: { stops: any[]; onSend: (siteIds: string[], template: string, time: string) => void; onClose: () => void }) {
  const open = stops.filter((s) => !['done', 'skipped'].includes(s.status));
  const [picked, setPicked] = useState<string[]>(open.map((s) => s.site_id));
  const [template, setTemplate] = useState('late');
  const [time, setTime] = useState('8:00 AM');
  return (
    <Card className="mb-3" data-testid="notify-panel">
      <h2 className="font-semibold">Notify customers</h2>
      <p className="text-sm text-slate-600">Each customer gets this once for this storm, even if you send it again.</p>
      <div className="mt-2 flex flex-wrap gap-3">
        <Select aria-label="Message" className="w-48" value={template} onChange={(e) => setTemplate(e.target.value)} data-testid="notify-template">
          <option value="late">Running late</option>
          <option value="on_the_way">On the way</option>
        </Select>
        {template === 'late' ? <Input aria-label="Expected time" className="w-32" value={time} onChange={(e) => setTime(e.target.value)} /> : null}
      </div>
      <ul className="mt-2 max-h-48 space-y-1 overflow-y-auto text-sm">
        {open.map((s) => (
          <li key={s.id}>
            <label className="flex items-center gap-2">
              <input type="checkbox" checked={picked.includes(s.site_id)} onChange={(e) => setPicked(e.target.checked ? [...picked, s.site_id] : picked.filter((x) => x !== s.site_id))} />
              {s.label}
            </label>
          </li>
        ))}
      </ul>
      <div className="mt-3 flex gap-2">
        <Button variant="accent" disabled={!picked.length} data-testid="notify-send" onClick={() => onSend(picked, template, time)}>Send to {picked.length}</Button>
        <Button variant="ghost" onClick={onClose}>Cancel</Button>
      </div>
    </Card>
  );
}

'use client';

import { Badge, Button, Card, Input, Select, cn, Progress } from '@flake/ui';
import { ArrowDown, ArrowUp } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { RunPlan } from './run-plan';
import QRCode from 'qrcode';
import { useEffect, useMemo, useRef, useState } from 'react';
import { StopSheet } from './stop-sheet';
import { sendRoutesBody } from './send-routes';
import { api } from '@/lib/client';
import { useConfirm } from '@/components/confirm';
import { MapView, type MapPin, type TileLayers } from '@/components/map-view';

const STATUS_WORD: Record<string, string> = { open: 'Open', enroute: 'On the way', onsite: 'On site', done: 'Done', skipped: 'Skipped', problem: 'Problem' };
const STATUS_TONE: Record<string, 'gray' | 'blue' | 'green' | 'amber' | 'red'> = { open: 'gray', enroute: 'blue', onsite: 'amber', done: 'green', skipped: 'gray', problem: 'red' };
const PIN_COLOR: Record<string, string> = { open: '#475569', enroute: '#0284c7', onsite: '#d97706', done: '#059669', skipped: '#94a3b8', problem: '#dc2626' };

/**
 * Hands the route link to the phone: the share sheet where there is one (pick Messages, WhatsApp, anything), and a new
 * text message otherwise. Nothing goes through Flake's servers.
 */
async function textLink(name: string, link: string) {
  const text = `Your route for tonight, ${name}: ${link}`;
  if (typeof navigator.share === 'function') {
    try {
      await navigator.share({ text });
      return;
    } catch (e) {
      // Cancelled is a choice, not a failure; anything else falls back to Messages.
      if ((e as Error).name === 'AbortError') return;
    }
  }
  window.location.href = `sms:?&body=${encodeURIComponent(text)}`;
}

/** 12:47 AM in the company's zone, so the server and the phone print the same time. */

// The storm header is near black: the usual dark focus ring would vanish on it.
const DARK_RING = 'focus-visible:outline-white';
export const clock = (iso: string, tz: string) => new Date(iso).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', timeZone: tz });

function since(iso: string | null, now: number) {
  if (!iso) return null;
  const m = Math.max(0, Math.floor((now - Date.parse(iso)) / 60000));
  return m < 60 ? `${m} min` : `${Math.floor(m / 60)} h ${m % 60} min`;
}

/** That storm's own snow, not tonight's forecast (issue 45). */
function StormSnow({ w, closed }: { w: { forecast_in: number | null; observed_in: number | null; synthetic: boolean; note: string | null }; closed: boolean }) {
  const has = w.forecast_in !== null || w.observed_in !== null;
  return (
    <div className="max-w-64" data-testid="storm-snow">
      <div className="font-display text-xs font-semibold uppercase tracking-wider text-slate-300">{closed ? 'Snow this storm' : 'Snow so far'}</div>
      <div className="font-display tabular text-2xl font-semibold md:text-3xl">{has ? `${w.observed_in ?? w.forecast_in}"` : 'No data'}</div>
      <div className={cn('text-xs', w.synthetic ? 'text-amber-300' : 'text-slate-300')}>
        {!has ? w.note : w.observed_in !== null
          ? `Observed (NOHRSC)${w.forecast_in !== null ? `. NWS forecast for the storm's hours: ${w.forecast_in}"` : ''}`
          : `NWS forecast for the storm's hours${w.synthetic ? ' (synthetic demo data)' : ''}`}
      </div>
    </div>
  );
}

export function StormBoard({ stormId, tz, initial, layers, canEdit, canText, sites = [] }: { stormId: string; tz: string; initial: any; layers: TileLayers; canEdit: boolean; canText: boolean; sites?: { id: string; label: string }[] }) {
  const router = useRouter();
  const [live, setLive] = useState<any>(initial);
  const [now, setNow] = useState(Date.parse(initial.storm.started_at));
  const [error, setError] = useState<string | null>(null);
  const [notify, setNotify] = useState(false);
  const [closePrompt, setClosePrompt] = useState<string | null>(null);
  const [showMap, setShowMap] = useState(false);
  const [dragging, setDragging] = useState<string | null>(null);
  const [linkFor, setLinkFor] = useState<{ runId: string; name: string; link: string; qr: string } | null>(null);
  const [calloutTime, setCalloutTime] = useState('');
  const [calloutSent, setCalloutSent] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [ask, dialog] = useConfirm();
  const [openStop, setOpenStop] = useState<string | null>(null);
  const [lastOk, setLastOk] = useState(() => Date.now());
  const columns = useRef<Record<string, HTMLElement | null>>({});

  const load = async () => {
    try {
      setLive(await api(`/api/storms/${stormId}/live`));
      setLastOk(Date.now());
    } catch {
      // Keep the last good board on a blip. The stale notice below says so if it lasts.
    }
  };
  useEffect(() => {
    setNow(Date.now());
    // On a desk the map is worth its space from the start (issue 46). On a phone it's one tap away.
    if (window.matchMedia('(min-width: 1024px)').matches) setShowMap(true);
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
  /** One place earlier or later in its truck's order. The list on screen may sort late stops first, so this goes by seq. */
  const shift = (run: any, stopId: string, by: -1 | 1) => {
    const ids = [...run.stops].sort((a: any, b: any) => a.seq - b.seq).map((x: any) => x.id as string);
    const i = ids.indexOf(stopId);
    const j = i + by;
    if (i < 0 || j < 0 || j >= ids.length) return;
    [ids[j], ids[i]] = [ids[i]!, ids[j]!];
    return act(() => api(`/api/runs/${run.id}/order`, { body: { stop_ids: ids } }));
  };
  const skip = async (s: any) => {
    if (s.status !== 'skipped' && !(await ask({ title: `Skip ${s.label}?`, body: 'It drops off the driver\'s route and isn\'t billed for this storm. You can reopen it while the storm is on.', confirm: 'Skip it' }))) return;
    await act(() => api(`/api/run-stops/${s.id}`, { method: 'PATCH', body: { status: s.status === 'skipped' ? 'open' : 'skipped' } }));
  };
  const closed = live.storm.status !== 'active';
  const editable = !closed && canEdit;
  const unpublished = live.runs.some((r: any) => !r.published_at);
  const allStops: any[] = useMemo(() => live.runs.flatMap((r: any) => r.stops), [live]);
  const inStorm = useMemo(() => new Set(allStops.map((x: any) => x.site_id as string)), [allStops]);
  const pins: MapPin[] = useMemo(() => [
    ...allStops.map((s) => ({ id: s.id, lat: s.lat, lon: s.lon, color: PIN_COLOR[s.status], label: `${s.label}: ${s.status}` })),
    ...live.runs.filter((r: any) => r.position).map((r: any) => ({ id: `pos-${r.id}`, lat: r.position.lat, lon: r.position.lon, color: '#7c3aed', label: `${r.crew?.name ?? 'Driver'}, last seen ${since(r.position.at, now)} ago` })),
  ], [live, allStops]);

  const elapsed = since(live.storm.started_at, live.storm.closed_at ? Date.parse(live.storm.closed_at) : now);

  const showLink = async (r: any) => {
    setLinkFor({ runId: r.id, name: r.crew?.name ?? r.name, link: r.link, qr: await QRCode.toDataURL(r.link, { margin: 1, width: 240 }) });
  };
  /** A lost or forwarded phone: the old link stops at once, and work already done on it still syncs. */
  const replaceLink = async () => {
    if (!linkFor || !(await ask({ title: `New link for ${linkFor.name}?`, body: 'Their current link stops working now. Work already done on it still syncs. Send them the new link or show them this QR.', confirm: 'Make a new link' }))) return;
    setError(null);
    try {
      const out = await api<{ link: string }>(`/api/runs/${linkFor.runId}/revoke`, { method: 'POST' });
      setLinkFor({ ...linkFor, link: out.link, qr: await QRCode.toDataURL(out.link, { margin: 1, width: 240 }) });
    } catch (e) {
      setError((e as Error).message);
    }
  };

  return (
    <div>
      <section className="mb-4 overflow-hidden rounded-md bg-slate-950 text-white">
        <div className="flex flex-wrap items-end gap-x-8 gap-y-3 p-4">
        <div><div className="font-display text-xs font-semibold uppercase tracking-wider text-slate-300">Storm time</div><div className="font-display tabular text-2xl font-semibold md:text-3xl" data-testid="storm-timer">{elapsed}</div></div>
        <StormSnow w={live.storm_weather} closed={closed} />
        {live.weather ? (
          <div className="max-w-64" data-testid="weather-now">
            <div className="font-display text-xs font-semibold uppercase tracking-wider text-slate-300">Now: next 12 h</div>
            <div className="font-display tabular text-2xl font-semibold md:text-3xl">{live.weather.forecast_in === null ? 'No data' : `${live.weather.forecast_in}"`}{live.weather.temp_f !== null ? <span className="ml-2 text-base font-normal text-slate-300">{live.weather.temp_f} F</span> : null}</div>
            <div className={cn('text-xs', live.weather.synthetic ? 'text-amber-300' : 'text-slate-300')}>{live.weather.reason ?? `Live ${live.weather.source}`}</div>
          </div>
        ) : null}
        <div className="w-full min-w-48 flex-1">
          <Progress className="mb-2 bg-slate-700" value={live.counts.done + live.counts.skipped} max={live.counts.total} label="Stops finished" />
        <div className="tabular flex flex-wrap gap-x-3 text-sm" data-testid="counts">
          <span><b>{live.counts.done}</b> done</span>
          {live.counts.skipped ? <span><b>{live.counts.skipped}</b> skipped</span> : null}
          <span><b>{live.counts.open}</b> open</span>
          <span><b>{live.counts.onsite}</b> on site</span>
          <span className={live.counts.late ? 'font-bold text-amber-300' : ''}><b>{live.counts.late}</b> late</span>
        </div>
        </div>
        <div className="grid w-full grid-cols-2 gap-2 sm:flex sm:flex-wrap lg:ml-auto lg:w-auto">
          {editable && unpublished ? <Button className={DARK_RING} variant="accent" data-testid="publish" onClick={async () => {
            // Sending messages the crew, so it says who first (issue 76).
            if (!(await ask({ title: 'Send routes to the crew?', body: sendRoutesBody(live.runs), confirm: 'Send routes' }))) return;
            await act(() => api(`/api/storms/${stormId}/publish`, { method: 'POST' }));
          }}>Send routes to crew</Button> : null}
          {editable ? <Button className={DARK_RING} variant="outline" data-testid="notify-open" onClick={() => setNotify(true)}>Notify customers</Button> : null}
          {editable ? <Button className={DARK_RING} variant="outline" data-testid="another-pass" onClick={async () => {
            if (!(await ask({ title: 'Start another pass?', body: 'Every driver gets a new route link for it.', confirm: 'Start pass' }))) return;
            await act(() => api(`/api/storms/${stormId}/pass`, { method: 'POST' }));
          }}>Another pass</Button> : null}
          <Button className={DARK_RING} variant="outline" onClick={() => setShowMap(!showMap)}>{showMap ? 'Hide map' : 'Map'}</Button>
          {editable ? (
            <Button className={DARK_RING} variant="danger" data-testid="close-storm" onClick={async () => {
              // A stray tap mid-storm must not close it, and the office should see what's still undone.
              const left = live.counts.open + live.counts.onsite;
              const ok = await ask({
                title: 'Close this storm?',
                body: <>{left ? <p className="mb-2 font-medium text-warn-ink" data-testid="close-open-count">{left} of {live.counts.total} stops {left === 1 ? 'is' : 'are'} not done yet. {left === 1 ? 'It' : 'They'} won&apos;t be billed.</p> : null}<p>Routes and stops stop changing, and invoice drafts are made for you to review. Nothing is charged until you approve. Drivers can still send finished work for 24 hours.</p></>,
                confirm: 'Close storm',
                danger: true,
              });
              if (!ok) return;
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
          ) : closed ? (
            <div className="flex items-center gap-2">
              <Badge tone="green" data-testid="storm-closed">{live.storm.status}</Badge>
              {canEdit && live.storm.status === 'closed' ? <Button className={DARK_RING} variant="outline" data-testid="reopen-storm" onClick={async () => {
                if (!(await ask({ title: 'Reopen this storm?', body: 'Route links work again and drivers can keep going. Invoice drafts still in review are dropped, and made again when you close it.', confirm: 'Reopen' }))) return;
                await act(() => api(`/api/storms/${stormId}/reopen`, { method: 'POST' }));
                router.refresh();
              }}>Reopen</Button> : null}
            </div>
          ) : null}
        </div>
        </div>
      </section>

      {editable && canText ? (
        <div className="mb-3 flex flex-wrap items-center gap-2 text-sm">
          <span className="text-muted">Ask drivers by text, reply YES or NO, plowing expected at</span>
          <Input aria-label="Expected start time" className="h-8 w-28" placeholder="4:00 AM" value={calloutTime} data-testid="callout-time" onChange={(e) => setCalloutTime(e.target.value)} />
          <Button size="sm" variant="outline" disabled={!calloutTime} data-testid="callout-send" onClick={() => act(async () => {
            const out = await api<{ sent: number }>(`/api/storms/${stormId}/callout`, { body: { time: calloutTime } });
            setCalloutSent(`Asked ${out.sent} driver${out.sent === 1 ? '' : 's'}. Replies show on each column.`);
          })}>Call out</Button>
          {calloutSent ? <span className="text-muted" data-testid="callout-sent">{calloutSent}</span> : null}
        </div>
      ) : null}

      {error ? <p className="mb-3 rounded-md bg-danger-tint p-3 text-sm text-danger" role="alert">{error}</p> : null}
      {!closed && now - lastOk > 60_000 ? <p className="mb-3 rounded-md bg-warn-tint p-3 text-sm text-warn-ink" role="status" data-testid="board-stale">This board hasn&apos;t updated for {since(new Date(lastOk).toISOString(), now)}. Check your connection; it catches up on its own.</p> : null}
      {openStop ? <StopSheet stopId={openStop} tz={tz} onClose={() => setOpenStop(null)} /> : null}
      {notice ? <p className="mb-3 rounded-md bg-ok-tint p-3 text-sm text-ok-ink" role="status" data-testid="board-notice">{notice}</p> : null}
      {dialog}
      {closePrompt ? (
        <Card className="mb-3 border-beacon">
          <p className="text-sm">{closePrompt} Close anyway?</p>
          <div className="mt-2 flex gap-2">
            <Button variant="danger" data-testid="close-force" onClick={async () => {
              setError(null);
              try {
                await api(`/api/storms/${stormId}/close`, { body: { force: true } });
                router.push(`/billing?storm=${stormId}`);
              } catch (e) {
                setClosePrompt(null);
                setError((e as Error).message);
              }
            }}>Close anyway</Button>
            <Button variant="outline" onClick={() => setClosePrompt(null)}>Keep open</Button>
          </div>
        </Card>
      ) : null}

      {notify ? <NotifyPanel stops={allStops} onClose={() => setNotify(false)} onSend={(siteIds, template, time) => act(async () => {
        setNotice(null);
        const out = await api<{ queued: number }>(`/api/storms/${stormId}/notify`, { body: { siteIds, template, time } });
        setNotify(false);
        setNotice(`Sending to ${out.queued} customer${out.queued === 1 ? '' : 's'}. Anyone already sent this message for this storm isn't sent it twice. Delivery shows in Settings, System, Recent messages.`);
      })} /> : null}

      {linkFor ? (
        <Card className="mb-3" data-testid="link-panel">
          <div className="flex flex-wrap items-center gap-4">
            <img src={linkFor.qr} alt={`QR code for ${linkFor.name}`} width={160} height={160} />
            <div className="min-w-0 flex-1">
              <p className="font-medium">{linkFor.name}&apos;s route link</p>
              <Input readOnly value={linkFor.link} data-testid="run-link" className="mt-1" />
              <div className="mt-2 flex flex-wrap gap-2">
                {/* From the dispatcher's own phone, until Flake's texting is live (issue 84). The link goes straight to the
                    phone's share sheet or Messages; Flake never logs it. */}
                <Button size="sm" variant="accent" data-testid="text-link" onClick={() => void textLink(linkFor.name, linkFor.link)}>Text it</Button>
                <Button size="sm" onClick={() => navigator.clipboard.writeText(linkFor.link)}>Copy link</Button>
                {editable ? <Button size="sm" variant="outline" data-testid="replace-link" onClick={() => void replaceLink()}>New link</Button> : null}
                <Button size="sm" variant="ghost" onClick={() => setLinkFor(null)}>Close</Button>
              </div>
            </div>
          </div>
        </Card>
      ) : null}

      {showMap ? <div className="mb-4"><MapView layers={layers} center={{ lat: allStops[0]?.lat ?? 41.48, lon: allStops[0]?.lon ?? -81.8 }} zoom={12} pins={pins} className="h-80" /></div> : null}

      {live.runs.length > 1 ? (
        <nav aria-label="Trucks" className="-mx-1 mb-3 flex gap-2 overflow-x-auto px-1 pb-1 md:hidden" data-testid="truck-switcher">
          {live.runs.map((r: any) => (
            <button key={r.id} type="button" className="min-h-10 shrink-0 rounded-full border border-line bg-surface px-3 text-sm font-medium" onClick={() => columns.current[r.id]?.scrollIntoView({ behavior: 'smooth', block: 'start' })}>
              {r.name}{r.pass > 1 ? ` ${r.pass}` : ''} <span className="tabular text-muted">{r.stops.filter((x: any) => x.status === 'done' || x.status === 'skipped').length}/{r.stops.length}</span>
            </button>
          ))}
        </nav>
      ) : null}

      <div className="flex flex-col gap-4 lg:flex-row">
        {/* On a phone every truck is stacked, full width, so none hides off to the side (issue 46). */}
        <div className="flex min-w-0 flex-1 flex-col gap-3 pb-2 md:snap-x md:flex-row md:overflow-x-auto">
          {live.runs.map((r: any) => (
            <section
              key={r.id}
              ref={(el) => { columns.current[r.id] = el; }}
              className={cn('w-full scroll-mt-20 rounded-surface bg-tint-2 p-2 md:w-72 md:shrink-0 md:snap-start', dragging && 'ring-2 ring-ink')}
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
                <div className="flex items-baseline justify-between gap-2"><div className="font-display text-lg font-semibold leading-tight">{r.name}{r.pass > 1 ? ` (pass ${r.pass})` : ''}</div><div className="tabular shrink-0 text-xs font-medium text-muted" data-testid="run-progress">{runProgress(r.stops)}</div></div>
                <div className="text-sm text-muted">{r.crew?.name ?? 'No driver'}{r.crew?.kind === 'sub' ? ' (sub)' : ''}{r.crew?.callout_reply ? `, replied ${r.crew.callout_reply}` : ''}</div>
                {editable ? (
                  <Select aria-label={`Driver for ${r.name}`} data-testid="assign-driver" className="mt-1 h-8 py-0 text-xs" value={r.crew?.id ?? ''} onChange={(e) => e.target.value && void act(() => api(`/api/runs/${r.id}`, { method: 'PATCH', body: { crew_id: e.target.value } }))}>
                    <option value="">Choose a driver</option>
                    {live.crew.map((c: any) => <option key={c.id} value={c.id}>{c.name}{c.kind === 'sub' ? ' (sub)' : ''}</option>)}
                  </Select>
                ) : null}
                {/* Did the driver get the link? Known the moment their phone opens it, not only once they tap something (issue 86). */}
                {r.opened_at ? <p className="mt-1 text-xs text-ink-2" data-testid="link-opened">Opened {clock(r.opened_at, tz)}</p>
                  : r.crew && !closed ? <p className="mt-1 text-xs font-medium text-warn-ink" data-testid="link-opened">Not opened yet</p> : null}
                {r.published_at && r.link && r.crew && !r.crew.reachable ? <p className="mt-1 text-xs font-medium text-warn-ink" data-testid="no-reach">We can&apos;t text or email {r.crew.name}, so they don&apos;t have this route. Show them the QR code.</p> : null}
                {r.link && !closed ? <Button size="sm" variant="ghost" className="-ml-3" data-testid="show-link" onClick={() => showLink(r)}>{r.published_at ? 'QR / copy link' : 'QR / copy link (no message sent)'}</Button> : null}
                {editable && r.stops.length > 1 ? <RunPlan runId={r.id} onDone={() => void load()} /> : null}
              </header>
              <ul className="space-y-2">
                {r.stops.map((s: any) => (
                  <li key={s.id} draggable={editable && s.status !== 'onsite' && s.status !== 'done'} onDragStart={(e) => { e.dataTransfer.setData('text/plain', s.id); e.dataTransfer.effectAllowed = 'move'; setDragging(s.id); }} onDragEnd={() => setDragging(null)} data-testid="stop-card" data-status={s.status} className={cn('rounded-row border border-line-faint bg-surface p-2 text-sm shadow-drop', (s.status === 'done' || s.status === 'skipped') && 'border-transparent bg-tint shadow-none', s.status === 'onsite' && 'border-beacon bg-warn-tint ring-2 ring-beacon', s.late && 'border-danger bg-danger-tint')}>
                    {/* The name opens the stop's visits and photos (issue 41); the buttons below stay their own targets. */}
                    <button type="button" className="-m-1 block w-[calc(100%+0.5rem)] rounded p-1 text-left hover:bg-tint focus-visible:outline-2 focus-visible:outline-ink" data-testid="stop-open" aria-label={`${s.label}: details and photos`} onClick={() => setOpenStop(s.id)}>
                      <span className="flex items-start justify-between gap-2">
                        <span className="font-medium">{s.seq}. {s.label}</span>
                        <Badge className="shrink-0" tone={STATUS_TONE[s.status]}>{STATUS_WORD[s.status] ?? s.status}</Badge>
                      </span>
                      <span className="block text-xs text-muted">{s.customer}</span>
                      {s.done_at ? <span className="block text-xs text-ink-2" data-testid="stop-summary">Finished {clock(s.done_at, tz)}{s.depth_in !== null ? `, ${s.depth_in}"` : ''}, {s.photos === 0 ? 'no photos' : `${s.photos === 1 ? '1 photo' : `${s.photos} photos`}${s.after_photos === 0 ? ', no after photo' : ''}`}</span> : null}
                      {s.problem ? <span className="block text-xs font-medium text-danger">{s.problem.kind}{s.problem.note ? `: ${s.problem.note}` : ''}</span> : null}
                    </button>
                    {s.late ? <div className="text-xs font-bold text-danger">Late</div> : null}
                    {s.arrived_at ? <div className="text-xs text-muted">On site {since(s.arrived_at, now)}</div> : null}
                    {editable && !['done', 'onsite'].includes(s.status) ? (
                      <div className="mt-1.5 flex items-center gap-1">
                        {Math.min(...r.stops.map((x: any) => x.seq)) < s.seq ? <Button size="sm" variant="ghost" className="h-10 w-10 shrink-0 p-0 md:h-8 md:w-8" aria-label={`Move ${s.label} earlier`} data-testid="move-up" onClick={() => void shift(r, s.id, -1)}><ArrowUp size={18} aria-hidden="true" /></Button> : null}
                        {Math.max(...r.stops.map((x: any) => x.seq)) > s.seq ? <Button size="sm" variant="ghost" className="h-10 w-10 shrink-0 p-0 md:h-8 md:w-8" aria-label={`Move ${s.label} later`} data-testid="move-down" onClick={() => void shift(r, s.id, 1)}><ArrowDown size={18} aria-hidden="true" /></Button> : null}
                        {live.runs.length > 1 ? (
                          <Select aria-label={`Move ${s.label} to another truck`} data-testid="move-to" className="h-10 min-w-0 flex-1 py-0 text-xs md:h-8" value="" onChange={(e) => e.target.value && void move(s.id, e.target.value)}>
                            <option value="">Move to...</option>
                            {live.runs.filter((x: any) => x.id !== r.id).map((x: any) => <option key={x.id} value={x.id}>{x.name} ({x.crew?.name ?? 'no driver'})</option>)}
                          </Select>
                        ) : <span className="flex-1" />}
                        {/* Named for its stop, so a screen reader hears "Skip Lot 3", not ten buttons called Skip. */}
                        <Button size="sm" variant="ghost" className="h-10 shrink-0 px-3 md:h-8" aria-label={`${s.status === 'skipped' ? 'Reopen' : 'Skip'} ${s.label}`} data-testid="skip-toggle" onClick={() => void skip(s)}>{s.status === 'skipped' ? 'Reopen' : 'Skip'}</Button>
                      </div>
                    ) : null}
                  </li>
                ))}
              </ul>
              {editable ? (
                sites.some((x) => !inStorm.has(x.id)) ? (
                  <Select aria-label={`Add a site to ${r.name}`} data-testid="add-stop" className="mt-2 h-10 py-0 text-xs md:h-8" value="" onChange={(e) => e.target.value && void act(() => api(`/api/runs/${r.id}/stops`, { body: { site_id: e.target.value } }))}>
                    <option value="">Add a site to this truck...</option>
                    {sites.filter((x) => !inStorm.has(x.id)).map((x) => <option key={x.id} value={x.id}>{x.label}</option>)}
                  </Select>
                ) : <p className="mt-2 px-1 text-xs text-muted" data-testid="add-stop-none">Every site you have is already on this storm.</p>
              ) : null}
            </section>
          ))}
        </div>
        <aside className={cn('order-first w-full shrink-0 lg:order-none lg:block lg:w-72', !live.alerts.length && 'hidden')}>
          <Card>
            <h2 className="font-semibold">Alerts</h2>
            {live.alerts.length ? (
              <ul className="mt-2 space-y-2 text-sm" data-testid="alerts-rail">
                {live.alerts.map((a: any, i: number) => (
                  <li key={i} className={cn('rounded-md p-2', a.kind === 'late' || a.kind === 'problem' ? 'bg-danger-tint text-danger-ink' : 'bg-warn-tint text-warn-ink')}>
                    {a.text}
                    {a.problem_id ? <Button size="sm" variant="ghost" data-testid="resolve-problem" onClick={() => act(() => api(`/api/problems/${a.problem_id}`, { method: 'PATCH' }))}>Resolved</Button> : null}
                  </li>
                ))}
              </ul>
            ) : <p className="mt-2 text-sm text-muted">Nothing needs you right now.</p>}
          </Card>
        </aside>
      </div>
    </div>
  );
}

/** "2 done, 1 skipped of 3": a skipped stop is finished with, but nobody plowed it. */
function runProgress(stops: { status: string }[]) {
  const done = stops.filter((x) => x.status === 'done').length;
  const skipped = stops.filter((x) => x.status === 'skipped').length;
  return `${done} done${skipped ? `, ${skipped} skipped` : ''} of ${stops.length}`;
}

function NotifyPanel({ stops, onSend, onClose }: { stops: any[]; onSend: (siteIds: string[], template: string, time: string) => void; onClose: () => void }) {
  const open = stops.filter((s) => !['done', 'skipped'].includes(s.status));
  const [picked, setPicked] = useState<string[]>(open.map((s) => s.site_id));
  const [template, setTemplate] = useState('late');
  const [time, setTime] = useState('8:00 AM');
  return (
    <Card className="mb-3" data-testid="notify-panel">
      <h2 className="font-semibold">Notify customers</h2>
      <p className="text-sm text-muted">Each customer gets this once for this storm, even if you send it again.</p>
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

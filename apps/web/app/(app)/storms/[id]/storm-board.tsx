'use client';

import { Badge, Button, Card, Input, Select, cn, Progress } from '@flake/ui';
import { ArrowDown, ArrowUp } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { RunPlan } from './run-plan';
import QRCode from 'qrcode';
import { useEffect, useMemo, useRef, useState } from 'react';
import { StopSheet } from './stop-sheet';
import { sendRoutesBody } from './send-routes';
import { CrewReport, DriverStatus, StandbyPicker } from './crew-panel';
import { api, possessive } from '@/lib/client';
import { LotPicker } from '@/components/lot-picker';
import type { LotOption } from '@/lib/lots';
import { DRIVER_PIN, STOP_STATUS, stormStatus, TRUCK_COLORS } from '@/lib/labels';
import { Grip, useSortable } from '@/components/sortable';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { useConfirm } from '@/components/confirm';
import { MapView, type LegendItem, type MapPin, type TileLayers } from '@/components/map-view';

// One source for a status's word, badge and pin color (issue 191).
const STATUS_WORD: Record<string, string> = Object.fromEntries(Object.entries(STOP_STATUS).map(([k, v]) => [k, v.word]));
const STATUS_TONE: Record<string, 'gray' | 'blue' | 'green' | 'amber' | 'red'> = Object.fromEntries(Object.entries(STOP_STATUS).map(([k, v]) => [k, v.tone]));

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
      <div className="font-display tabular text-2xl font-semibold md:text-3xl">{has ? `${w.observed_in ?? w.forecast_in}"` : 'Not yet'}</div>
      <div className={cn('text-xs', w.synthetic ? 'text-amber-300' : 'text-slate-300')}>
        {!has ? w.note : w.observed_in !== null
          ? `Observed (NOHRSC)${w.forecast_in !== null ? `. NWS forecast for the storm's hours: ${w.forecast_in}"` : ''}`
          : `NWS forecast for the storm's hours${w.synthetic ? ' (synthetic demo data)' : ''}`}
      </div>
    </div>
  );
}

export function StormBoard({ stormId, tz, initial, layers, canEdit, canText, sites = [] }: { stormId: string; tz: string; initial: any; layers: TileLayers; canEdit: boolean; canText: boolean; sites?: LotOption[] }) {
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
  // Issue 189: passes are a toggle, not more lanes; lanes scroll sideways on a desk.
  const passes = useMemo(() => [...new Set((live.runs as { pass: number }[]).map((r) => r.pass))].sort((a, b) => a - b), [live]);
  const newestOpenPass = useMemo(() => [...passes].reverse().find((p) => (live.runs as any[]).some((r) => r.pass === p && r.stops.some((x: any) => !['done', 'skipped'].includes(x.status)))) ?? passes.at(-1) ?? 1, [passes, live]);
  const [passView, setPassView] = useState<number | 'all' | null>(null);
  const shownPass = passView ?? newestOpenPass;
  const [colorBy, setColorBy] = useState<'status' | 'truck'>('status');
  const [selected, setSelected] = useState<string | null>(null);
  const [showLinks, setShowLinks] = useState(false);
  const lanesBox = useRef<HTMLDivElement>(null);
  const [edges, setEdges] = useState({ left: false, right: false });
  const measure = () => {
    const el = lanesBox.current;
    if (!el) return;
    setEdges({ left: el.scrollLeft > 4, right: el.scrollLeft + el.clientWidth < el.scrollWidth - 4 });
  };
  useEffect(() => {
    measure();
    window.addEventListener('resize', measure);
    return () => window.removeEventListener('resize', measure);
  }, [live, shownPass]);

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

  // A 200-stop storm is one long list (issue 146): find a lot by name or address, or show one status.
  const [boardFind, setBoardFind] = useState('');
  const [boardStatus, setBoardStatus] = useState('');
  const shows = (s: any) => (!boardStatus || s.status === boardStatus) && (!boardFind.trim() || `${s.label} ${s.address ?? ''}`.toLowerCase().includes(boardFind.trim().toLowerCase()));
  // Swapping drivers while one is on a lot (issue 154): they can still finish it from their link, so say so first.
  const reassign = async (r: any, crewId: string) => {
    const onsite = (r.stops as any[]).filter((x) => x.status === 'onsite');
    if (onsite.length && r.crew?.id !== crewId && !(await ask({ title: `Change the driver for ${r.name}?`, body: `${r.crew?.name ?? 'The current driver'} is on site at ${onsite.map((x) => x.label).join(', ')}. They can still finish ${onsite.length === 1 ? 'it' : 'those'} from their link, and the new driver gets the rest.`, confirm: 'Change driver' }))) return;
    await act(() => api(`/api/runs/${r.id}`, { method: 'PATCH', body: { crew_id: crewId } }));
  };
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
  // Each route keeps one color across passes, for its lane edge and its pins' rings (issue 191).
  const routeNames = useMemo(() => [...new Set((live.runs as any[]).map((r) => r.name as string))], [live]);
  const truckColor = (name: string) => TRUCK_COLORS[routeNames.indexOf(name) % TRUCK_COLORS.length]!;
  const visibleRuns: any[] = useMemo(() => (live.runs as any[]).filter((r) => shownPass === 'all' || r.pass === shownPass), [live, shownPass]);
  const pins: MapPin[] = useMemo(() => [
    ...visibleRuns.flatMap((r) => [...r.stops].sort((a: any, b: any) => a.seq - b.seq).map((s: any, i: number) => ({
      id: s.id, lat: s.lat, lon: s.lon, n: i + 1, ring: truckColor(r.name),
      color: colorBy === 'truck' ? truckColor(r.name) : STOP_STATUS[s.status]?.color,
      label: `${i + 1}. ${s.label}: ${STATUS_WORD[s.status] ?? s.status} (${r.name})`,
    }))),
    ...visibleRuns.filter((r) => r.position).map((r) => ({ id: `pos-${r.id}`, lat: r.position.lat, lon: r.position.lon, color: DRIVER_PIN, label: `${r.crew?.name ?? 'Driver'}, last seen ${since(r.position.at, now)} ago` })),
  ], [visibleRuns, colorBy, now]);
  const legend: LegendItem[] = colorBy === 'status'
    ? [...Object.values(STOP_STATUS).map((v) => ({ color: v.color, label: v.word })), { color: DRIVER_PIN, label: 'Driver (last seen)' }]
    : [...routeNames.map((n) => ({ color: truckColor(n), label: n })), { color: DRIVER_PIN, label: 'Driver (last seen)' }];
  /** A pin tapped on the map: highlight its stop and bring it into view. */
  const pickPin = (id: string) => {
    if (id.startsWith('pos-')) return;
    setSelected(id);
    document.querySelector(`[data-stop-id="${id}"]`)?.scrollIntoView({ behavior: 'smooth', block: 'center', inline: 'center' });
  };
  // Drivers we can't text yet: one banner for the board, not a warning in every lane (issue 189).
  const unreached: any[] = (live.runs as any[]).filter((r) => r.published_at && r.link && r.crew && !r.crew.reachable && !closed);
  const unreachedDrivers = [...new Set(unreached.map((r) => r.crew.name as string))];

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
            if (!(await ask({ title: 'Start another pass?', body: 'Every driver gets a new route link for it, and the routes go out to the crew now, the same as starting a storm.', confirm: 'Start pass' }))) return;
            await act(() => api(`/api/storms/${stormId}/pass`, { method: 'POST' }));
          }}>Another pass</Button> : null}
          <Button className={DARK_RING} variant="outline" onClick={() => setShowMap(!showMap)}>{showMap ? 'Hide map' : 'Map'}</Button>
          {editable ? (
            // Ending the storm sits apart from the everyday buttons, on its own row on a phone, so it isn't the
            // neighbour of Map (UX pass, Nov 23). It still asks first.
            <Button className={cn(DARK_RING, 'col-span-2 mt-2 border-red-400 bg-transparent text-red-300 shadow-none hover:bg-red-950 hover:text-red-200 sm:col-span-1 sm:mt-0 lg:ml-4')} variant="outline" data-testid="close-storm" onClick={async () => {
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
            // On a phone the badge and Reopen get their own row, so Reopen is never cut off (issue 118).
            <div className="col-span-2 flex flex-wrap items-center gap-2 sm:col-span-1">
              <Badge tone={stormStatus(live.storm.status).tone} data-testid="storm-closed">{stormStatus(live.storm.status).word}</Badge>
              {canEdit && live.storm.status === 'closed' ? <Button className={DARK_RING} variant="outline" data-testid="reopen-storm" onClick={async () => {
                if (!(await ask({ title: 'Reopen this storm?', body: 'Route links work again and drivers can keep going. Invoice drafts still in review are dropped, and made again when you close it. Bills you voided stay voided.', confirm: 'Reopen' }))) return;
                await act(() => api(`/api/storms/${stormId}/reopen`, { method: 'POST' }));
                router.refresh();
              }}>Reopen</Button> : null}
            </div>
          ) : null}
        </div>
        </div>
      </section>

      {/* Crew and salt for tonight in one panel, a labeled row each, instead of three loose lines (UX pass, Nov 23). */}
      {editable ? (
        <section aria-label="Crew and salt tonight" className="mb-4 divide-y divide-line-faint rounded-surface border border-line-faint bg-surface text-sm" data-testid="crew-and-salt">
          {canText ? (
            <div className="flex flex-wrap items-center gap-x-3 gap-y-2 px-3 py-2.5">
              <div className="min-w-0 flex-1 basis-48">
                <div className="font-semibold">Call out drivers</div>
                <div className="text-xs text-muted">Each driver gets a text and replies YES or NO. Replies show on their column.</div>
              </div>
              <div className="flex items-center gap-2">
                <Input aria-label="Plowing expected at" className="h-9 w-28" placeholder="4:00 AM" value={calloutTime} data-testid="callout-time" onChange={(e) => setCalloutTime(e.target.value)} />
                <Button size="sm" variant="outline" className="h-9" disabled={!calloutTime} data-testid="callout-send" onClick={() => act(async () => {
                  const out = await api<{ sent: number }>(`/api/storms/${stormId}/callout`, { body: { time: calloutTime } });
                  setCalloutSent(`Asked ${out.sent} driver${out.sent === 1 ? '' : 's'}. Replies show on each column.`);
                })}>Call out</Button>
              </div>
              {calloutSent ? <p className="basis-full text-muted" data-testid="callout-sent">{calloutSent}</p> : null}
            </div>
          ) : null}
          <StandbyPicker stormId={stormId} crew={live.crew} standby={live.standby ?? []} onSaved={() => void load()} />
          {/* Salt rationing tonight (issue 232): drivers see "priority areas only", and proof packets record the policy. */}
          <div className="flex flex-wrap items-center gap-x-3 gap-y-2 px-3 py-2.5" data-testid="storm-ration">
            <div className="min-w-0 flex-1 basis-48">
              <div className="font-semibold">Salt</div>
              <div className={live.ration?.on ? 'font-semibold text-warn-ink' : 'text-xs text-muted'}>{live.ration?.on ? `Rationed this storm${live.ration.scope === 'company' ? ' (company-wide)' : ''}: priority areas only.` : 'Normal amounts.'}</div>
            </div>
            <Button size="sm" variant="outline" data-testid="storm-ration-toggle" onClick={() => act(() => api('/api/salt/policy', { method: 'PUT', body: { action: 'ration', on: !live.ration?.on, storm_id: stormId } }))}>{live.ration?.on ? 'Back to normal salt' : 'Ration salt'}</Button>
          </div>
        </section>
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

      {notify ? <NotifyPanel tz={tz} stops={allStops} onClose={() => setNotify(false)} onSend={(siteIds, template, time) => act(async () => {
        setNotice(null);
        const out = await api<{ queued: number; unreachable: string[] }>(`/api/storms/${stormId}/notify`, { body: { siteIds, template, time } });
        setNotify(false);
        setNotice(`${out.queued ? `Sending to ${out.queued} customer${out.queued === 1 ? '' : 's'}. Anyone already sent this message for this storm isn't sent it twice. Delivery shows in Settings, System, Recent messages.` : 'Nobody was sent this.'}${out.unreachable.length ? ` Not sent to ${out.unreachable.join(', ')}: no texts or email turned on for ${out.unreachable.length === 1 ? 'that customer' : 'those customers'}.` : ''}`);
      })} /> : null}

      {linkFor ? (
        <Card className="mb-3" data-testid="link-panel">
          <div className="flex flex-wrap items-center gap-4">
            <img src={linkFor.qr} alt={`QR code for ${linkFor.name}`} width={160} height={160} />
            <div className="min-w-0 flex-1">
              <p className="font-medium">{possessive(linkFor.name)} route link</p>
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

      {showMap ? (
        <div className="mb-4">
          <div className="mb-1 flex flex-wrap items-center justify-end gap-2 text-xs">
            <span className="font-semibold text-muted">Color by</span>
            {(['status', 'truck'] as const).map((k) => (
              <button key={k} type="button" aria-pressed={colorBy === k} data-testid={`color-by-${k}`} onClick={() => setColorBy(k)} className={cn('min-h-8 rounded-full border px-3 font-semibold', colorBy === k ? 'border-ink bg-ink text-surface' : 'border-line bg-surface')}>{k === 'status' ? 'Status' : 'Truck'}</button>
            ))}
          </div>
          <MapView layers={layers} center={{ lat: allStops[0]?.lat ?? 41.48, lon: allStops[0]?.lon ?? -81.8 }} zoom={12} pins={pins} className="h-80" legend={legend} selected={selected} onPinClick={pickPin} fit />
        </div>
      ) : null}

      {/* One banner for the board while drivers can't be texted, with each one's link a tap away (issue 189). */}
      {unreachedDrivers.length ? (
        <div className="mb-3 rounded-md border border-warn-line bg-warn-tint p-3 text-sm text-warn-ink" data-testid="texting-banner">
          <div className="flex flex-wrap items-center gap-2">
            <p className="min-w-0 flex-1">Texting isn&apos;t set up yet. {unreachedDrivers.length === 1 ? `${unreachedDrivers[0]} needs their link from you.` : `${unreachedDrivers.length} drivers need their link from you.`}</p>
            <Button size="sm" variant="outline" data-testid="texting-banner-open" onClick={() => setShowLinks(!showLinks)}>{showLinks ? 'Hide links' : 'Show their links'}</Button>
          </div>
          {showLinks ? (
            <ul className="mt-2 space-y-1">
              {unreached.map((r) => <li key={r.id} className="flex flex-wrap items-center gap-2"><span className="font-semibold">{r.crew.name}</span><span className="text-xs">{r.name}{r.pass > 1 ? `, pass ${r.pass}` : ''}</span><Button size="sm" variant="ghost" onClick={() => void showLink(r)}>QR / copy link</Button></li>)}
            </ul>
          ) : null}
        </div>
      ) : null}

      {/* Alerts sit above the lanes, so a lane never scrolls under them (issue 189). */}
      {live.alerts.length ? (
        <details open className="mb-3 rounded-md border border-line-faint bg-surface p-3">
          <summary className="cursor-pointer font-semibold">Alerts ({live.alerts.length})</summary>
          <ul className="mt-2 grid gap-2 text-sm md:grid-cols-2 xl:grid-cols-3" data-testid="alerts-rail">
            {live.alerts.map((a: any, i: number) => (
              <li key={i} className={cn('flex flex-wrap items-center gap-2 rounded-md p-2', a.kind === 'late' || a.kind === 'problem' ? 'bg-danger-tint text-danger-ink' : 'bg-warn-tint text-warn-ink')}>
                <span className="min-w-0 flex-1">{String(a.text).charAt(0).toUpperCase() + String(a.text).slice(1)}</span>
                {/* An action, so it says what it does; "Resolved" alone read like a status. */}
                {a.problem_id ? <Button size="sm" variant="outline" data-testid="resolve-problem" onClick={() => act(() => api(`/api/problems/${a.problem_id}`, { method: 'PATCH' }))}>Mark resolved</Button> : null}
              </li>
            ))}
          </ul>
        </details>
      ) : null}

      <div className="mb-3 flex flex-wrap items-center gap-2">
        {passes.length > 1 ? (
          <div className="flex rounded-control bg-tint-2 p-1" role="group" aria-label="Which pass" data-testid="pass-toggle">
            {[...passes, 'all' as const].map((p) => (
              <button key={p} type="button" aria-pressed={shownPass === p} data-testid={`pass-${p}`} onClick={() => setPassView(p)}
                className={cn('min-h-9 rounded-row px-3 text-sm font-medium', shownPass === p ? 'bg-surface font-semibold text-ink shadow-drop ring-1 ring-line-strong' : 'text-muted hover:text-ink')}>
                {p === 'all' ? 'All' : `Pass ${p}`}
              </button>
            ))}
          </div>
        ) : null}
        {allStops.length > 12 ? (
          <div className="flex min-w-0 flex-1 flex-wrap gap-2" role="search" data-testid="board-filter">
            <Input type="search" className="min-w-0 flex-1 sm:max-w-xs" aria-label="Find a lot on this storm" placeholder="Find a lot" value={boardFind} onChange={(e) => setBoardFind(e.target.value)} data-testid="board-find" />
            <Select aria-label="Show stops" className="w-auto" value={boardStatus} onChange={(e) => setBoardStatus(e.target.value)} data-testid="board-status">
              <option value="">Every stop</option>
              <option value="open">Not started</option>
              <option value="enroute">On the way</option>
              <option value="onsite">On site</option>
              <option value="problem">Problem</option>
              <option value="done">Done</option>
              <option value="skipped">Skipped</option>
            </Select>
            {boardFind.trim() || boardStatus ? <span className="self-center text-sm text-muted" data-testid="board-filter-count">{allStops.filter(shows).length} of {allStops.length} stops</span> : null}
          </div>
        ) : null}
      </div>

      {visibleRuns.length > 1 ? (
        <nav aria-label="Trucks" className="-mx-1 mb-3 flex gap-2 overflow-x-auto px-1 pb-1 md:hidden" data-testid="truck-switcher">
          {visibleRuns.map((r) => (
            <button key={r.id} type="button" className="min-h-10 shrink-0 rounded-full border border-line bg-surface px-3 text-sm font-medium" style={{ borderLeftColor: truckColor(r.name), borderLeftWidth: 4 }} onClick={() => columns.current[r.id]?.scrollIntoView({ behavior: 'smooth', block: 'start' })}>
              {r.name}{passes.length > 1 ? ` · pass ${r.pass}` : ''} <span className="tabular text-muted">{r.stops.filter((x: any) => x.status === 'done' || x.status === 'skipped').length}/{r.stops.length}</span>
            </button>
          ))}
        </nav>
      ) : null}

      {/* On a phone every truck is stacked, full width (issue 46). On a tablet or desk, one lane per truck in a single row
          that scrolls sideways, Jira style, with buttons and a fade to say there's more (issue 189). */}
      <div className="relative">
        {edges.left ? <div aria-hidden="true" className="pointer-events-none absolute inset-y-0 left-0 z-10 hidden w-10 bg-gradient-to-r from-page to-transparent md:block" /> : null}
        {edges.right ? <div aria-hidden="true" className="pointer-events-none absolute inset-y-0 right-0 z-10 hidden w-10 bg-gradient-to-l from-page to-transparent md:block" /> : null}
        {edges.left ? <Button size="sm" variant="outline" className="absolute left-1 top-2 z-20 hidden size-10 rounded-full p-0 md:flex" aria-label="Scroll to earlier trucks" data-testid="lanes-left" onClick={() => lanesBox.current?.scrollBy({ left: -340, behavior: 'smooth' })}><ChevronLeft size={20} aria-hidden="true" /></Button> : null}
        {edges.right ? <Button size="sm" variant="outline" className="absolute right-1 top-2 z-20 hidden size-10 rounded-full p-0 md:flex" aria-label="Scroll to more trucks" data-testid="lanes-right" onClick={() => lanesBox.current?.scrollBy({ left: 340, behavior: 'smooth' })}><ChevronRight size={20} aria-hidden="true" /></Button> : null}
        <div ref={lanesBox} onScroll={measure} className="relative flex min-w-0 flex-col gap-3 pb-2 md:snap-x md:flex-row md:items-start md:overflow-x-auto" data-testid="lanes">
          {routeNames.map((name) => {
            const laneRuns = visibleRuns.filter((r) => r.name === name).sort((a, b) => a.pass - b.pass);
            if (!laneRuns.length) return null;
            const laneStops = laneRuns.flatMap((r) => r.stops);
            return (
              <section key={name} className="w-full shrink-0 snap-start rounded-surface border-t-4 bg-tint-2 p-2 md:w-80" style={{ borderTopColor: truckColor(name) }} data-testid="truck-lane">
                <header className="sticky top-12 z-[1] -mx-2 -mt-2 mb-2 rounded-t-surface bg-tint-2 px-3 pb-1 pt-2 md:top-0">
                  <div className="flex items-baseline justify-between gap-2"><h2 className="font-display text-lg font-semibold leading-tight">{name}</h2><div className="tabular shrink-0 text-xs font-medium text-muted" data-testid="run-progress">{runProgress(laneStops)}</div></div>
                </header>
                {laneRuns.map((r) => (
                  <div
                    key={r.id}
                    ref={(el) => { columns.current[r.id] = el; }}
                    className={cn('scroll-mt-20 rounded-md', dragging && 'ring-2 ring-ink', laneRuns.length > 1 && 'mt-2')}
                    data-testid="run-column"
                    data-run={r.id}
                    onDragOver={(e) => e.preventDefault()}
                    onDrop={(e) => {
                      e.preventDefault();
                      if (dragging) void move(dragging, r.id);
                      setDragging(null);
                    }}
                  >
                    {laneRuns.length > 1 ? <div className="mb-1 flex items-center gap-2 px-1 text-xs font-bold uppercase tracking-wide text-muted" data-testid="pass-divider"><span className="h-px flex-1 bg-line" />Pass {r.pass}<span className="h-px flex-1 bg-line" /></div> : null}
                    <div className="mb-2 px-1">
                      <div className="flex flex-wrap items-center gap-1.5 text-sm text-muted">
                        {/* The picker below already shows the name, so the label just says what it is. */}
                        <span>{editable ? 'Driver' : `${r.crew?.name ?? 'No driver'}${r.crew?.kind === 'sub' ? ' (sub)' : ''}`}</span>
                        {!closed && r.driver_status ? <DriverStatus status={r.driver_status} /> : null}
                        {/* Hours on shift and rest before it (issue 235). */}
                        {!closed && r.fatigue?.long_shift ? <Badge tone="amber" data-testid="fatigue-long">On {Math.floor(r.fatigue.on_hours)} h</Badge> : null}
                        {!closed && r.fatigue?.short_rest ? <Badge tone="amber" data-testid="fatigue-rest">{r.fatigue.rest_hours} h rest</Badge> : null}
                        {/* The driver isn't coming: the storm's standby drivers get a text, and the first YES gets this run (issue 234). */}
                        {editable && canText && (live.standby ?? []).some((id: string) => id !== r.crew?.id) && ['declined', 'no_reply', 'not_opened', 'no_driver'].includes(r.driver_status) ? <Button size="sm" variant="outline" className="h-7 px-2 text-xs" data-testid="offer-standby" onClick={() => act(async () => { const out = await api<{ sent: number }>(`/api/runs/${r.id}/offer`, { method: 'POST' }); setCalloutSent(`Offered ${r.name} to ${out.sent} standby driver${out.sent === 1 ? '' : 's'}. The first YES gets it.`); })}>Offer to standbys</Button> : null}
                        {r.published_at && r.link && r.crew && !r.crew.reachable && !closed ? <Badge tone="amber" data-testid="no-reach">Link not sent</Badge> : null}
                      </div>
                      {editable ? (
                        <Select aria-label={`Driver for ${r.name}`} data-testid="assign-driver" className="mt-1 h-8 py-0 text-xs" value={r.crew?.id ?? ''} onChange={(e) => e.target.value && void reassign(r, e.target.value)}>
                          <option value="">Choose a driver</option>
                          {live.crew.map((c: any) => <option key={c.id} value={c.id}>{c.name}{c.kind === 'sub' ? ' (sub)' : ''}</option>)}
                        </Select>
                      ) : null}
                      {/* Which truck ran this route, for a damage question later and fuel per storm. Only once a company has trucks. */}
                      {live.trucks?.length ? (editable ? (
                        <Select aria-label={`Truck for ${r.name}`} data-testid="assign-truck" className="mt-1 h-8 py-0 text-xs" value={r.truck_id ?? ''} onChange={(e) => void act(() => api(`/api/runs/${r.id}`, { method: 'PATCH', body: { truck_id: e.target.value || null } }))}>
                          <option value="">No truck set</option>
                          {live.trucks.map((t: any) => <option key={t.id} value={t.id}>{t.name}</option>)}
                        </Select>
                      ) : r.truck_id ? <div className="text-xs text-muted" data-testid="run-truck">{live.trucks.find((t: any) => t.id === r.truck_id)?.name ?? 'Retired truck'}</div> : null) : null}
                      {/* Did the driver get the link? Known the moment their phone opens it, not only once they tap something (issue 86). */}
                      {r.opened_at ? <p className="mt-1 text-xs text-ink-2" data-testid="link-opened">Opened {clock(r.opened_at, tz)}</p>
                        : r.crew && !closed ? <p className="mt-1 text-xs font-medium text-warn-ink" data-testid="link-opened">Not opened yet</p> : null}
                      {r.link && !closed ? <Button size="sm" variant="ghost" className="-ml-3" data-testid="show-link" onClick={() => showLink(r)}>{r.published_at ? 'QR / copy link' : 'QR / copy link (no message sent)'}</Button> : null}
                      {editable && r.stops.length > 1 ? <RunPlan runId={r.id} onDone={() => void load()} /> : null}
                    </div>
                    <LaneStops
                      run={r} runs={visibleRuns} allRuns={live.runs} editable={editable} filtering={Boolean(boardFind.trim() || boardStatus)} shows={shows} now={now} tz={tz} selected={selected}
                      onOpen={(id) => { setSelected(id); setOpenStop(id); }} onShift={shift} onMove={move} onSkip={skip} onDragStart={setDragging} onDragEnd={() => setDragging(null)}
                      onOrder={(ids) => act(() => api(`/api/runs/${r.id}/order`, { body: { stop_ids: ids } }))}
                    />
                    {editable ? (
                      sites.some((x) => !inStorm.has(x.id)) ? (
                        <LotPicker className="mt-2" label={`Add a site to ${r.name}`} placeholder="Add a lot to this truck" testId="add-stop" lots={sites} exclude={[...inStorm]}
                          near={r.stops.map((x: any) => ({ lat: x.lat, lon: x.lon }))} onPick={([siteId]) => siteId && void act(() => api(`/api/runs/${r.id}/stops`, { body: { site_id: siteId } }))} />
                      ) : <p className="mt-2 px-1 text-xs text-muted" data-testid="add-stop-none">Every site you have is already on this storm.</p>
                    ) : null}
                  </div>
                ))}
              </section>
            );
          })}
        </div>
      </div>
      {closed ? <CrewReport rows={live.crew_report ?? []} /> : null}
    </div>
  );
}

/** "2 done, 1 skipped of 3": a skipped stop is finished with, but nobody plowed it. */
function runProgress(stops: { status: string }[]) {
  const done = stops.filter((x) => x.status === 'done').length;
  const skipped = stops.filter((x) => x.status === 'skipped').length;
  return `${done} done${skipped ? `, ${skipped} skipped` : ''} of ${stops.length}`;
}

/** An hour from now in the company's time zone, rounded up to the quarter hour, as an <input type="time"> value. */
function inAnHour(tz: string) {
  const at = new Date(Math.ceil((Date.now() + 3_600_000) / 900_000) * 900_000);
  const p = Object.fromEntries(new Intl.DateTimeFormat('en-US', { timeZone: tz, hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).formatToParts(at).map((x) => [x.type, x.value]));
  return `${p.hour}:${p.minute}`;
}
/** "14:30" from the time picker as "2:30 PM", the way the message reads it. */
const pickedClock = (hm: string) => {
  const [h, m] = hm.split(':').map(Number) as [number, number];
  return `${h % 12 || 12}:${String(m).padStart(2, '0')} ${h < 12 ? 'AM' : 'PM'}`;
};

function NotifyPanel({ tz, stops, onSend, onClose }: { tz: string; stops: any[]; onSend: (siteIds: string[], template: string, time: string) => void; onClose: () => void }) {
  const open = stops.filter((s) => !['done', 'skipped'].includes(s.status));
  const [picked, setPicked] = useState<string[]>(open.map((s) => s.site_id));
  const [template, setTemplate] = useState('late');
  // Not a fixed 8:00 AM (issue 148): an hour from now, which the office adjusts.
  const [time, setTime] = useState(() => inAnHour(tz));
  return (
    <Card className="mb-3" data-testid="notify-panel">
      <h2 className="font-semibold">Notify customers</h2>
      <p className="text-sm text-muted">Each customer gets this once for this storm, even if you send it again.</p>
      <div className="mt-2 flex flex-wrap gap-3">
        <Select aria-label="Message" className="w-48" value={template} onChange={(e) => setTemplate(e.target.value)} data-testid="notify-template">
          <option value="late">Running late</option>
          <option value="on_the_way">On the way</option>
        </Select>
        {template === 'late' ? <Input type="time" aria-label="Expected time" className="w-36" required value={time} onChange={(e) => setTime(e.target.value)} data-testid="notify-time" /> : null}
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
        <Button variant="accent" disabled={!picked.length || (template === 'late' && !time)} data-testid="notify-send" onClick={() => onSend(picked, template, template === 'late' ? pickedClock(time) : '')}>Send to {picked.length}</Button>
        <Button variant="ghost" onClick={onClose}>Cancel</Button>
      </div>
    </Card>
  );
}

/**
 * One truck's stops in a lane (issues 189, 190). Finished stops fold into "6 done" so the ones still to do stay in view.
 * Stops still to do drag by their grip to a new place in this truck, with a finger, a mouse or the keyboard; dragging the
 * card onto another lane moves it to that truck, as before. Arrows and "Move to" stay for fine moves.
 */
function LaneStops({ run: r, allRuns, editable, filtering, shows, now, tz, selected, onOpen, onShift, onMove, onSkip, onDragStart, onDragEnd, onOrder }: {
  run: any; runs: any[]; allRuns: any[]; editable: boolean; filtering: boolean; shows: (s: any) => boolean; now: number; tz: string; selected: string | null;
  onOpen: (id: string) => void; onShift: (run: any, stopId: string, by: -1 | 1) => unknown; onMove: (stopId: string, runId: string) => unknown; onSkip: (s: any) => unknown;
  onDragStart: (id: string) => void; onDragEnd: () => void; onOrder: (ids: string[]) => unknown;
}) {
  const finished = (s: any) => s.status === 'done' || s.status === 'skipped';
  const todo: any[] = r.stops.filter((s: any) => !finished(s));
  const doneList: any[] = r.stops.filter(finished);
  const fold = !filtering && doneList.length >= 4;
  const bySeq = [...r.stops].sort((a: any, b: any) => a.seq - b.seq);
  const place = (s: any) => bySeq.findIndex((x: any) => x.id === s.id) + 1;
  const sort = useSortable({
    count: todo.length,
    label: (i) => todo[i]?.label ?? '',
    onMove: (from, to) => {
      // Where the stop lands among the lane's stops still to do, written back as the truck's whole order.
      const ids = bySeq.map((x: any) => x.id as string);
      const moving = todo[from].id as string;
      const target = todo[to].id as string;
      ids.splice(ids.indexOf(moving), 1);
      ids.splice(ids.indexOf(target) + (to > from ? 1 : 0), 0, moving);
      void onOrder(ids);
    },
  });
  const card = (s: any, i: number | null) => (
    <li key={s.id} {...(i !== null ? sort.row(i) : {})} data-stop-id={s.id} draggable={editable && s.status !== 'onsite' && s.status !== 'done'}
      onDragStart={(e) => { e.dataTransfer.setData('text/plain', s.id); e.dataTransfer.effectAllowed = 'move'; onDragStart(s.id); }} onDragEnd={onDragEnd}
      data-testid="stop-card" data-status={s.status}
      className={cn(i !== null ? sort.row(i).className : 'relative', 'rounded-row border border-line-faint bg-surface p-2 text-sm shadow-drop', finished(s) && 'border-transparent bg-tint shadow-none', s.status === 'onsite' && 'border-beacon bg-warn-tint ring-2 ring-beacon', s.late && 'border-danger bg-danger-tint', selected === s.id && 'outline outline-2 outline-offset-2 outline-ink')}>
      <div className="flex items-start gap-1">
        {i !== null && editable && !filtering && s.status !== 'onsite' ? <Grip {...sort.handle(i)} testId="stop-grip" /> : null}
        {/* The name opens the stop's visits and photos (issue 41); the buttons below stay their own targets. */}
        <button type="button" className="-m-1 block min-w-0 flex-1 rounded p-1 text-left hover:bg-tint focus-visible:outline-2 focus-visible:outline-ink" data-testid="stop-open" aria-label={`${place(s)}. ${s.label}: details and photos`} onClick={() => onOpen(s.id)}>
          <span className="flex items-start justify-between gap-2">
            <span className="min-w-0 font-medium wrap-anywhere">{place(s)}. {s.label}</span>
            <Badge className="shrink-0" tone={STATUS_TONE[s.status]}>{STATUS_WORD[s.status] ?? s.status}</Badge>
          </span>
          <span className="block text-xs text-muted">{s.customer}</span>
          {/* What the driver can tick here (issue 192). */}
          {s.services?.length ? <span className="mt-0.5 block text-xs text-ink-2" data-testid="stop-services">{(s.services as string[]).map((x) => STATUS_SERVICE[x] ?? x).join(' · ')}</span> : null}
          {/* Work here bills nothing: the customer declined or never signed (found in a QA pass). */}
          {s.no_contract ? <span className="block text-xs font-medium text-warn-ink" data-testid="no-contract">No accepted contract: this lot won&apos;t be billed</span> : null}
          {s.done_at ? <span className="block text-xs text-ink-2" data-testid="stop-summary">Finished {clock(s.done_at, tz)}{s.depth_in !== null ? `, ${s.depth_in}"` : ''}, {s.photos === 0 ? 'no photos' : `${s.photos === 1 ? '1 photo' : `${s.photos} photos`}${s.after_photos === 0 ? ', no after photo' : ''}`}</span> : null}
          {s.problem ? <span className="block text-xs font-medium text-danger">{s.problem.kind}{s.problem.note ? `: ${s.problem.note}` : ''}</span> : null}
        </button>
      </div>
      {s.late ? <div className="text-xs font-bold text-danger">Late</div> : null}
      {s.arrived_at ? <div className="text-xs text-muted">On site {since(s.arrived_at, now)}</div> : null}
      {editable && !['done', 'onsite'].includes(s.status) ? (
        <div className="mt-1.5 flex items-center gap-1">
          {Math.min(...r.stops.map((x: any) => x.seq)) < s.seq ? <Button size="sm" variant="ghost" className="h-10 w-10 shrink-0 p-0 md:h-8 md:w-8" aria-label={`Move ${s.label} earlier`} data-testid="move-up" onClick={() => void onShift(r, s.id, -1)}><ArrowUp size={18} aria-hidden="true" /></Button> : null}
          {Math.max(...r.stops.map((x: any) => x.seq)) > s.seq ? <Button size="sm" variant="ghost" className="h-10 w-10 shrink-0 p-0 md:h-8 md:w-8" aria-label={`Move ${s.label} later`} data-testid="move-down" onClick={() => void onShift(r, s.id, 1)}><ArrowDown size={18} aria-hidden="true" /></Button> : null}
          {allRuns.length > 1 ? (
            <Select aria-label={`Move ${s.label} to another truck`} data-testid="move-to" className="h-10 min-w-0 flex-1 py-0 text-xs md:h-8" value="" onChange={(e) => e.target.value && void onMove(s.id, e.target.value)}>
              <option value="">Move to...</option>
              {allRuns.filter((x: any) => x.id !== r.id).map((x: any) => <option key={x.id} value={x.id}>{x.name}{x.pass > 1 ? ` pass ${x.pass}` : ''} ({x.crew?.name ?? 'no driver'})</option>)}
            </Select>
          ) : <span className="flex-1" />}
          {/* Named for its stop, so a screen reader hears "Skip Lot 3", not ten buttons called Skip. */}
          <Button size="sm" variant="ghost" className="h-10 shrink-0 px-3 md:h-8" aria-label={`${s.status === 'skipped' ? 'Reopen' : 'Skip'} ${s.label}`} data-testid="skip-toggle" onClick={() => void onSkip(s)}>{s.status === 'skipped' ? 'Reopen' : 'Skip'}</Button>
        </div>
      ) : null}
    </li>
  );
  return (
    <>
      {sort.live}
      {fold ? (
        <details className="mb-2 rounded-row bg-tint px-2 py-1" data-testid="finished-stops" open={doneList.some((s) => s.id === selected)}>
          <summary className="cursor-pointer py-1 text-sm font-semibold text-muted">{doneList.length} done{doneList.some((s) => s.status === 'skipped') ? ' or skipped' : ''}</summary>
          <ul className="mt-1 space-y-2">{doneList.filter(shows).map((s) => card(s, null))}</ul>
        </details>
      ) : null}
      <ul className="space-y-2">
        {(fold ? todo : r.stops).map((s: any) => (!shows(s) ? null : card(s, todo.indexOf(s) >= 0 ? todo.indexOf(s) : null)))}
      </ul>
    </>
  );
}

const STATUS_SERVICE: Record<string, string> = { plow: 'Plow', salt: 'Salt', walks: 'Walks', haul: 'Haul' };

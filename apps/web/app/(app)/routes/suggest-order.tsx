'use client';

import { Button, Input, Label } from '@flake/ui';
import { useEffect, useState } from 'react';
import { api } from '@/lib/client';

interface Stop { id: string; arrive: string; finish: string; drive_min: number; late: boolean; wait_min?: number; break_min?: number; via_yard?: boolean; out_at?: string | null }
interface Plan { stops: Stop[]; drive_min: number; total_min: number; late: number; break_min?: number; work_min?: number }
interface Result { current: Plan; suggested: Plan; changed: boolean; skipped: number; times_label?: string }

const clock = (hm: string) => {
  const [h, m] = hm.split(':').map(Number);
  return `${((h! + 11) % 12) + 1}:${String(m).padStart(2, '0')} ${h! < 12 ? 'AM' : 'PM'}`;
};
const hours = (min: number) => (min < 60 ? `${min} min` : `${Math.floor(min / 60)} h ${min % 60} min`);

/** Suggests a stop order. It never saves by itself: the dispatcher reads it and taps Use this order. */
export function SuggestOrder({ routeId, siteIds, label, onAccept, yard = null }: { routeId: string; siteIds: string[]; label: (id: string) => string; onAccept: (ids: string[]) => void; yard?: string | null }) {
  const [open, setOpen] = useState(false);
  const [start, setStart] = useState('04:00');
  const [keepFirst, setKeepFirst] = useState(false);
  const [result, setResult] = useState<Result | null>(null);
  const [error, setError] = useState<string | null>(null);
  const key = siteIds.join(',');

  useEffect(() => {
    if (!open) return;
    let live = true;
    setError(null);
    api<Result>(`/api/routes/${routeId}/suggest`, { body: { site_ids: key.split(','), start: start || '04:00', keep_first: keepFirst } })
      .then((r) => live && setResult(r))
      .catch((e) => live && setError((e as Error).message));
    return () => { live = false; };
  }, [open, routeId, key, start, keepFirst]);

  if (siteIds.length < 3) return null;
  if (!open) return <Button size="sm" variant="outline" className="mt-2" onClick={() => setOpen(true)} data-testid="suggest-open">Suggest order</Button>;

  const s = result?.suggested;
  const c = result?.current;
  const saved = s && c ? c.drive_min - s.drive_min : 0;
  return (
    <div className="mt-3 rounded-md border border-amber-300 bg-amber-50 p-3 text-sm" data-testid="suggest-panel">
      <div className="flex flex-wrap items-end gap-3">
        <div><Label htmlFor={`start-${routeId}`}>{yard ? 'Leave the yard at' : 'First stop at'}</Label><Input id={`start-${routeId}`} type="time" value={start} onChange={(e) => setStart(e.target.value)} className="w-32" /></div>
        <label className="flex items-center gap-2 pb-2"><input type="checkbox" checked={keepFirst} onChange={(e) => setKeepFirst(e.target.checked)} /> Keep the first stop first</label>
      </div>
      {yard ? <p className="mt-2 text-slate-700" data-testid="suggest-yard">Starts and ends at the yard, {yard}. Drive times include the trip out and back.</p> : null}
      {error ? <p className="mt-2 text-red-700" role="alert">{error}</p> : null}
      {!result && !error ? <p className="mt-2 text-slate-600">Working it out...</p> : null}
      {s && c ? (
        <>
          <p className="mt-3 font-medium" data-testid="suggest-summary">
            {!result.changed
              ? 'This order is already about as short as it gets.'
              : saved > 0
                ? `Saves about ${hours(saved)} of driving (${hours(c.drive_min)} down to ${hours(s.drive_min)}).`
                : `Same driving or a little more, but ${c.late - s.late} fewer missed deadlines.`}
          </p>
          <p className="text-slate-600">
            {/* Working time, with any break called out, not one long day (issue 74). */}
            {s.break_min ? <span data-testid="suggest-work">About {hours(s.work_min ?? s.total_min)} of work with plowing time, plus a {hours(s.break_min)} break between runs. </span> : <>Whole route about {hours(s.total_min)} with plowing time. </>}{s.late ? `${s.late} ${s.late === 1 ? 'stop misses its' : 'stops miss their'} open-by time.` : 'Every open-by time is met.'}
            {c.late !== s.late ? ` Now: ${c.late} missed.` : ''}
          </p>
          <ol className="mt-2 space-y-1" data-testid="suggest-list">
            {s.stops.map((x, i) => (
              <li key={x.id} className="flex items-center gap-2">
                <span className="w-6 text-right text-slate-500">{i + 1}.</span>
                <span className="flex-1">{label(x.id)}</span>
                <span className="tabular-nums text-slate-600">{clock(x.arrive)}</span>
                {x.break_min && x.out_at ? <span className="rounded-sm bg-slate-200 px-1 text-xs font-medium text-slate-800" data-testid="suggest-break">{x.via_yard ? `Back at the yard until ${clock(x.out_at)}` : `Free until ${clock(x.out_at)}`}</span> : null}
                {x.wait_min ? <span className="rounded-sm bg-sky-100 px-1 text-xs font-medium text-sky-900" data-testid="suggest-wait">Waits {x.wait_min} min</span> : null}
                {x.late ? <span className="rounded-sm bg-red-100 px-1 text-xs font-medium text-red-800">Late</span> : null}
              </li>
            ))}
          </ol>
          <p className="mt-2 text-xs text-slate-500">Priority 1 sites go first, then 2, and so on. <span data-testid="suggest-times">{result.times_label ?? 'Drive times are estimates from distance, not live traffic.'}</span>{result.skipped ? ` ${result.skipped} retired ${result.skipped === 1 ? 'site was' : 'sites were'} left out.` : ''}</p>
        </>
      ) : null}
      <div className="mt-3 flex gap-2">
        {result?.changed ? <Button size="sm" onClick={() => { const ids = result.suggested.stops.map((x) => x.id); onAccept([...ids, ...siteIds.filter((x) => !ids.includes(x))]); setOpen(false); setResult(null); }} data-testid="suggest-accept">Use this order</Button> : null}
        <Button size="sm" variant="ghost" onClick={() => { setOpen(false); setResult(null); }}>{result?.changed ? 'Keep mine' : 'Close'}</Button>
      </div>
    </div>
  );
}

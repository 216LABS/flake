'use client';

import { Button, Card, Input, Label } from '@flake/ui';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { useConfirm } from '@/components/confirm';
import { api } from '@/lib/client';

interface Plan { stops: { id: string; arrive: string; late: boolean }[]; drive_min: number; total_min: number; late: number }
interface Totals { drive_min: number; late: number; longest_min: number; stops: number }
interface Result {
  plan: { routes: { id: string; site_ids: string[]; plan: Plan; before: Plan; moved_in: number }[]; before: Totals; after: Totals; moved: number; changed: boolean } | null;
  routes: { id: string; name: string; before: string[] }[];
  labels: Record<string, string>;
  unrouted: number;
  times_label: string;
}

const hours = (min: number) => (min < 60 ? `${min} min` : `${Math.floor(min / 60)} h ${String(min % 60).padStart(2, '0')} min`);
const clock = (hm: string) => {
  const [h, m] = hm.split(':').map(Number);
  return `${((h! + 11) % 12) + 1}:${String(m).padStart(2, '0')} ${h! < 12 ? 'AM' : 'PM'}`;
};
const addMin = (hm: string, min: number) => {
  const [h, m] = hm.split(':').map(Number);
  const t = (h! * 60 + m! + min) % 1440;
  return `${String(Math.floor(t / 60)).padStart(2, '0')}:${String(t % 60).padStart(2, '0')}`;
};
const lotsWord = (n: number) => `${n} ${n === 1 ? 'lot' : 'lots'}`;

/** Plan all routes (issue 68): pick the trucks, see the split and each truck's night, save all at once or not at all. */
export function PlanAll({ routes, unrouted, yard, readOnly }: { routes: { id: string; name: string; stops: number }[]; unrouted: number; yard: string | null; readOnly: boolean }) {
  const router = useRouter();
  const [ask, dialog] = useConfirm();
  const [picked, setPicked] = useState<string[]>(routes.map((r) => r.id));
  const [loose, setLoose] = useState(unrouted > 0);
  const [start, setStart] = useState('04:00');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<Result | null>(null);
  const lots = routes.filter((r) => picked.includes(r.id)).reduce((a, r) => a + r.stops, 0) + (loose ? unrouted : 0);

  if (routes.length < 2) {
    return <p className="max-w-2xl rounded-md bg-tint p-3 text-sm text-ink-2" data-testid="plan-need-routes">Plan all routes splits your lots across two or more trucks. Add a route for each truck on the Routes page first, even an empty one.</p>;
  }

  const plan = async () => {
    setBusy(true);
    setError(null);
    setResult(null);
    try {
      setResult(await api<Result>('/api/routes/plan', { body: { route_ids: picked, include_unrouted: loose, start: start || '04:00' } }));
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  const save = async (p: NonNullable<Result['plan']>, r: Result) => {
    const ok = await ask({
      title: `Save this split to ${p.routes.length} routes?`,
      body: `Every storm from now on starts from these routes. ${p.moved} ${p.moved === 1 ? 'lot moves' : 'lots move'} to another truck. A storm already running keeps its own copy.`,
      confirm: 'Save all routes',
    });
    if (!ok) return;
    setBusy(true);
    setError(null);
    try {
      await api('/api/routes/plan/accept', { body: { routes: p.routes.map((x) => ({ id: x.id, site_ids: x.site_ids, before: r.routes.find((y) => y.id === x.id)!.before })) } });
      router.push('/routes');
      router.refresh();
    } catch (e) {
      setError((e as Error).message);
      setBusy(false);
    }
  };
  const name = (id: string) => result?.routes.find((r) => r.id === id)?.name ?? '';
  const was = (routeId: string, siteId: string) => Boolean(result?.routes.find((x) => x.id === routeId)?.before.includes(siteId));
  const p = result?.plan;
  return (
    <div className="max-w-5xl">
      {dialog}
      <Card className="space-y-3">
        <fieldset>
          <legend className="text-sm font-semibold">Trucks to plan, one route each</legend>
          <div className="mt-2 flex flex-wrap gap-x-5 gap-y-2">
            {routes.map((r) => (
              <label key={r.id} className="flex items-center gap-2 text-sm">
                <input type="checkbox" data-testid="plan-route" checked={picked.includes(r.id)} onChange={(e) => { setResult(null); setPicked(e.target.checked ? [...picked, r.id] : picked.filter((x) => x !== r.id)); }} />
                <span className="break-words">{r.name}</span> <span className="text-muted">({lotsWord(r.stops)})</span>
              </label>
            ))}
          </div>
        </fieldset>
        {unrouted ? (
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" data-testid="plan-unrouted" checked={loose} onChange={(e) => { setResult(null); setLoose(e.target.checked); }} />
            Also place the {lotsWord(unrouted)} not on any route
          </label>
        ) : null}
        <div className="flex flex-wrap items-end gap-3">
          <div>
            <Label htmlFor="plan-start">{yard ? 'Trucks leave the yard at' : 'First stops at'}</Label>
            <Input id="plan-start" type="time" className="w-32" value={start} onChange={(e) => { setResult(null); setStart(e.target.value); }} />
          </div>
          <Button disabled={busy || picked.length < 2 || !lots} onClick={plan} data-testid="plan-run">{busy ? 'Planning...' : `Plan ${lotsWord(lots)} across ${picked.length} trucks`}</Button>
        </div>
        {picked.length < 2 ? <p className="text-sm text-muted">Pick at least two routes.</p> : null}
        {yard ? <p className="text-xs text-muted">Routes set to start and end at the yard ({yard}) count the trip out and back.</p> : null}
      </Card>
      {error ? <p className="mt-3 text-sm text-danger" role="alert" data-testid="plan-error">{error}</p> : null}
      {busy && !result ? <p className="mt-3 text-sm text-muted" role="status">Working it out. A big fleet takes a few seconds.</p> : null}
      {result && !p ? <p className="mt-3 text-sm text-muted">No lots on those routes yet.</p> : null}
      {result && p ? (
        <section className="mt-4" aria-labelledby="plan-result">
          <h2 id="plan-result" className="text-lg font-semibold">Suggested split</h2>
          <p className="mt-1 text-sm" data-testid="plan-summary">
            {!p.changed
              ? 'Your routes are already about as good as this planner can make them.'
              : `Last truck done ${hours(p.after.longest_min)} after the start (now ${hours(p.before.longest_min)}). ${hours(p.after.drive_min)} of driving in all (now ${hours(p.before.drive_min)}). ${p.moved} ${p.moved === 1 ? 'lot changes' : 'lots change'} route.`}
            {p.after.late ? ` ${p.after.late} ${p.after.late === 1 ? 'stop misses its' : 'stops miss their'} open-by time.` : ' Every open-by time is met.'}
          </p>
          <div className="mt-3 grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-3">
            {p.routes.map((r) => (
              <Card key={r.id} data-testid="plan-truck">
                <div className="break-words font-semibold">{name(r.id)}</div>
                <div className="text-sm text-muted">
                  {lotsWord(r.site_ids.length)}, done about {clock(addMin(start || '04:00', r.plan.total_min))}, {hours(r.plan.drive_min)} driving
                  {r.plan.late ? <span className="text-danger">, {r.plan.late} late</span> : null}
                </div>
                <div className="text-xs text-faint">Now: {lotsWord(r.before.stops.length)}, {hours(r.before.total_min)}{r.moved_in ? `. ${r.moved_in} new to this route` : ''}</div>
                <details className="mt-2">
                  <summary className="cursor-pointer text-sm text-link">Stops in order</summary>
                  <ol className="mt-1 space-y-0.5 text-sm">
                    {r.plan.stops.map((s, i) => (
                      <li key={s.id} className="flex gap-2">
                        <span className="w-6 shrink-0 text-right text-faint">{i + 1}.</span>
                        <span className="min-w-0 flex-1 break-words">{result.labels[s.id] ?? 'Lot'}{!was(r.id, s.id) ? <span className="ml-1 rounded-sm bg-info-tint px-1 text-xs text-link" data-testid="plan-moved">moved here</span> : null}</span>
                        <span className="tabular-nums text-muted">{clock(s.arrive)}</span>
                        {s.late ? <span className="rounded-sm bg-danger-tint px-1 text-xs font-medium text-danger">Late</span> : null}
                      </li>
                    ))}
                  </ol>
                </details>
              </Card>
            ))}
          </div>
          <p className="mt-2 text-xs text-faint">Priority 1 lots stay first on each truck. {result.times_label}</p>
          {p.changed && !readOnly ? (
            <div className="mt-3 flex gap-2">
              <Button disabled={busy} data-testid="plan-accept" onClick={() => void save(p, result)}>Save all routes</Button>
              <Button variant="ghost" onClick={() => setResult(null)}>Keep mine</Button>
            </div>
          ) : null}
        </section>
      ) : null}
    </div>
  );
}

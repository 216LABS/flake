'use client';

import { Button, Card, cn, Input, Label, Select } from '@flake/ui';
import { ArrowDown, ArrowUp, X } from 'lucide-react';
import type { Dispatch, SetStateAction } from 'react';
import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import { useConfirm } from '@/components/confirm';
import { api } from '@/lib/client';
import { SuggestOrder } from './suggest-order';
import { Grip, useSortable } from '@/components/sortable';
import { LotPicker } from '@/components/lot-picker';
import type { LotOption } from '@/lib/lots';
import type { TileLayers } from '@/components/map-view';

interface R { id: string; name: string; default_crew_id: string | null; default_truck_id?: string | null; yard_trip: boolean; site_ids: string[] }

export function RoutesEditor({ routes, sites, lots = [], crew, trucks = [], yard = null, layers }: { routes: R[]; sites: { id: string; label: string; active: boolean; contracted?: boolean }[]; lots?: LotOption[]; crew: { id: string; name: string }[]; trucks?: { id: string; name: string }[]; yard?: string | null; layers?: TileLayers }) {
  const router = useRouter();
  const [list, setList] = useState(routes);
  const [name, setName] = useState('');
  const [error, setError] = useState<string | null>(null);
  // Long routes on a phone (issue 146): type a position instead of tapping Up 148 times, and find a lot by name.
  const [moving, setMoving] = useState<{ route: string; id: string; to: string } | null>(null);
  const [find, setFind] = useState<Record<string, string>>({});
  const [ask, dialog] = useConfirm();
  // A lot just taken off a route, kept 10 seconds so it can be put back where it was (issue 190).
  const [removed, setRemoved] = useState<{ routeId: string; id: string; at: number } | null>(null);
  useEffect(() => {
    if (!removed) return;
    const t = setTimeout(() => setRemoved(null), 10_000);
    return () => clearTimeout(t);
  }, [removed]);
  // The order a route had before "Use this order", kept a minute so it can be put back (issue 81).
  const [undo, setUndo] = useState<{ routeId: string; ids: string[] } | null>(null);
  useEffect(() => {
    if (!undo) return;
    const t = setTimeout(() => setUndo(null), 60_000);
    return () => clearTimeout(t);
  }, [undo]);
  const site = (id: string) => sites.find((s) => s.id === id);
  const label = (id: string) => {
    const s = site(id);
    return s ? `${s.label}${s.active ? '' : ' (retired)'}` : 'Unknown site';
  };
  /** Other routes this lot is already on. A lot on two routes would get two trucks. */
  const elsewhere = (id: string, routeId: string) => list.filter((x) => x.id !== routeId && x.site_ids.includes(id)).map((x) => x.name);

  const save = async (r: R) => {
    setError(null);
    try {
      await api(`/api/routes/${r.id}`, { method: 'PATCH', body: { name: r.name, default_crew_id: r.default_crew_id, ...(trucks.length ? { default_truck_id: r.default_truck_id ?? null } : {}), site_ids: r.site_ids } });
    } catch (e) {
      setError((e as Error).message);
    }
  };
  const update = (r: R) => {
    setList((all) => all.map((x) => (x.id === r.id ? r : x)));
    void save(r);
  };
  const moveTo = (r: R, from: number, to: number) => {
    if (to < 0 || to >= r.site_ids.length) return;
    const ids = [...r.site_ids];
    const [item] = ids.splice(from, 1);
    ids.splice(to, 0, item!);
    update({ ...r, site_ids: ids });
  };
  const addSites = async (r: R, ids: string[]) => {
    const twice = ids.filter((id) => elsewhere(id, r.id).length);
    if (twice.length && !(await ask({ title: twice.length === 1 ? `${label(twice[0]!)} is already on ${elsewhere(twice[0]!, r.id).join(' and ')}` : `${twice.length} of these lots are already on another route`, body: 'A lot on two routes can be sent two trucks. When both routes go out in one storm it goes on the first one only. Add them here too?', confirm: 'Add anyway' }))) return;
    update({ ...r, site_ids: [...r.site_ids, ...ids.filter((id) => !r.site_ids.includes(id))] });
  };
  const nameTaken = (n: string, except?: string) => list.some((x) => x.id !== except && x.name.trim().toLowerCase() === n.trim().toLowerCase());
  return (
    <div>
      {dialog}
      {error ? <p className="mb-3 text-sm text-danger" role="alert">{error}</p> : null}
      {!list.length ? <p className="mb-4 max-w-2xl rounded-md bg-tint p-3 text-sm text-ink-2" data-testid="routes-empty">A route is the lots one truck plows, in order. Add one below, put its lots on it, and Suggest order sorts them by drive time. A storm starts from your routes.</p> : null}
      <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
        {list.map((r) => (
          <Card key={r.id} data-testid="route-card">
            <Input aria-label="Route name" maxLength={120} value={r.name} onChange={(e) => setList((all) => all.map((x) => (x.id === r.id ? { ...x, name: e.target.value } : x)))} onBlur={() => {
              if (!r.name.trim()) return setError('A route needs a name.');
              void save(r);
            }} className="font-semibold" />
            <Label className="mt-2" htmlFor={`crew-${r.id}`}>Default driver</Label>
            <Select id={`crew-${r.id}`} value={r.default_crew_id ?? ''} onChange={(e) => update({ ...r, default_crew_id: e.target.value || null })}>
              <option value="">None</option>
              {crew.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
            </Select>
            {trucks.length ? (
              <>
                <Label className="mt-2" htmlFor={`truck-${r.id}`}>Default truck</Label>
                <Select id={`truck-${r.id}`} data-testid="route-truck" value={r.default_truck_id ?? ''} onChange={(e) => update({ ...r, default_truck_id: e.target.value || null })}>
                  <option value="">None</option>
                  {trucks.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
                </Select>
              </>
            ) : null}
            {!r.site_ids.length ? <p className="mt-3 text-sm text-muted" data-testid="route-empty">No sites yet. Add them below; an empty route is left out of storms.</p> : null}
            {r.site_ids.length > 10 ? <Input type="search" className="mt-3" aria-label={`Find a lot on ${r.name}`} placeholder="Find a lot on this route" value={find[r.id] ?? ''} onChange={(e) => setFind({ ...find, [r.id]: e.target.value })} data-testid="route-find" /> : null}
            <RouteStops r={r} filter={find[r.id] ?? ''} label={label} elsewhere={elsewhere} contracted={(id) => sites.find((x) => x.id === id)?.contracted !== false} moving={moving} setMoving={setMoving} moveTo={moveTo} remove={(id, at) => { setRemoved({ routeId: r.id, id, at }); update({ ...r, site_ids: r.site_ids.filter((x) => x !== id) }); }} />
            {removed?.routeId === r.id ? (
              <p className="mt-2 flex flex-wrap items-center gap-2 rounded-md bg-tint p-2 text-sm" role="status" data-testid="route-remove-undo-bar">
                Removed {label(removed.id)}.
                <Button size="sm" variant="outline" data-testid="route-remove-undo" onClick={() => { const ids = [...r.site_ids]; ids.splice(Math.min(removed.at, ids.length), 0, removed.id); update({ ...r, site_ids: ids }); setRemoved(null); }}>Undo</Button>
              </p>
            ) : null}
            {/* On by default once there's a yard; some routes are run from somewhere else (issue 64). */}
            {yard ? (
              <label className="mt-3 flex items-center gap-2 text-sm">
                <input type="checkbox" data-testid="route-yard-trip" checked={r.yard_trip} onChange={async (e) => {
                  const on = e.target.checked;
                  setList((all) => all.map((x) => (x.id === r.id ? { ...x, yard_trip: on } : x)));
                  setError(null);
                  try {
                    await api(`/api/routes/${r.id}`, { method: 'PATCH', body: { yard_trip: on } });
                  } catch (err) {
                    setList((all) => all.map((x) => (x.id === r.id ? { ...x, yard_trip: !on } : x)));
                    setError((err as Error).message);
                  }
                }} />
                Start and end at the yard
              </label>
            ) : null}
            <SuggestOrder key={`${r.id}:${r.yard_trip}`} routeId={r.id} siteIds={r.site_ids} label={label} layers={layers} points={Object.fromEntries(lots.map((l) => [l.id, { lat: l.lat, lon: l.lon }]))} yard={yard && r.yard_trip ? yard : null} onAccept={(ids) => { setUndo({ routeId: r.id, ids: r.site_ids }); update({ ...r, site_ids: ids }); }} />
            {undo?.routeId === r.id ? (
              <p className="mt-2 flex flex-wrap items-center gap-2 rounded-md bg-ok-tint p-2 text-sm text-ok-ink" role="status" data-testid="suggest-undo-bar">
                New order saved.
                <Button size="sm" variant="outline" data-testid="suggest-undo" onClick={() => { update({ ...r, site_ids: undo.ids }); setUndo(null); }}>Undo</Button>
              </p>
            ) : null}
            {/* Search by street or name, lots on no route first, nearest to this route's lots (issue 193). */}
            <LotPicker className="mt-2" multi label={`Add a site to ${r.name}`} placeholder="Add lots: search by name, street or customer" testId="route-add" lots={lots} exclude={r.site_ids} defaultFilter="unrouted"
              near={lots.filter((l) => r.site_ids.includes(l.id)).map((l) => ({ lat: l.lat, lon: l.lon }))} onPick={(ids) => void addSites(r, ids)} />
            <Button size="sm" variant="ghost" className="mt-2" data-testid="route-archive" onClick={async () => {
              if (!(await ask({ title: `Archive ${r.name}?`, body: 'It leaves the routes list and the storm form. Storms already run on it keep their records. You can restore it from the Archived tab at the top of this page.', confirm: 'Archive route', danger: true }))) return;
              setError(null);
              try {
                await api(`/api/routes/${r.id}`, { method: 'PATCH', body: { archived: true } });
                setList((all) => all.filter((x) => x.id !== r.id));
                router.refresh();
              } catch (e) {
                setError((e as Error).message);
              }
            }}>Archive route</Button>
          </Card>
        ))}
      </div>
      <Card data-write className="mt-4 flex max-w-md flex-wrap items-end gap-2">
        <div className="flex-1"><Label htmlFor="new-route">New route</Label><Input id="new-route" maxLength={120} value={name} onChange={(e) => setName(e.target.value)} data-testid="new-route-name" /></div>
        <Button disabled={!name.trim() || nameTaken(name)} data-testid="new-route-add" onClick={async () => {
          setError(null);
          try {
            const created = await api<{ id: string; name: string }>('/api/routes', { body: { name: name.trim() } });
            setList((all) => [...all, { id: created.id, name: created.name, default_crew_id: null, yard_trip: true, site_ids: [] }]);
            setName('');
          } catch (e) {
            setError((e as Error).message);
          }
        }}>Add</Button>
        {name.trim() && nameTaken(name) ? <p className="w-full text-sm text-danger" data-testid="route-name-taken">There&apos;s already a route called {name.trim()}.</p> : null}
      </Card>
    </div>
  );
}

type Moving = { route: string; id: string; to: string } | null;

/**
 * One route's lots in order: drag by the grip (finger, mouse or keyboard), arrows for one step, or "Move to" a number
 * (issues 146 and 190).
 */
function RouteStops({ r, filter, label, elsewhere, contracted, moving, setMoving, moveTo, remove }: {
  r: R; filter: string; label: (id: string) => string; elsewhere: (id: string, routeId: string) => string[]; contracted: (id: string) => boolean;
  moving: Moving; setMoving: Dispatch<SetStateAction<Moving>>; moveTo: (r: R, from: number, to: number) => void; remove: (id: string, at: number) => void;
}) {
  const sort = useSortable({ count: r.site_ids.length, onMove: (from, to) => moveTo(r, from, to), label: (i) => label(r.site_ids[i] ?? '') });
  const q = filter.trim().toLowerCase();
  return (
    <>
    {sort.live}
    <ol className="mt-3 space-y-1" data-testid="route-stops">
      {r.site_ids.map((id, i) => !q || label(id).toLowerCase().includes(q) ? (
        <li key={id} {...sort.row(i)} className={cn(sort.row(i).className, 'flex items-center gap-1 rounded-row border bg-surface py-1 pl-0.5 pr-1 text-sm shadow-drop')} data-testid="route-stop">
          {q ? null : <Grip {...sort.handle(i)} testId="route-grip" className="h-10 w-6 md:h-8 md:w-7" />}
          {/* The position control sits in the row, beside the name, so it lines up with the other buttons. */}
          <span className="shrink-0">
            {moving?.route === r.id && moving.id === id ? (
              <Input autoFocus type="number" inputMode="numeric" min={1} max={r.site_ids.length} className="mr-1 inline-block h-8 w-16 px-1 py-0" aria-label={`New position for ${label(id)}, 1 to ${r.site_ids.length}`} value={moving.to} data-testid="route-position-input"
                onChange={(e) => setMoving({ ...moving, to: e.target.value })}
                onKeyDown={(e) => { if (e.key === 'Enter') e.currentTarget.blur(); if (e.key === 'Escape') setMoving(null); }}
                onBlur={() => { const to = Math.round(Number(moving.to)); if (to >= 1 && to <= r.site_ids.length && to !== i + 1) moveTo(r, i, to - 1); setMoving(null); }} />
            ) : r.site_ids.length > 3 ? (
              // The number is the "move to position" control (issues 146, 190): a clear button, not a dotted underline.
              <button type="button" className="mr-1 inline-flex h-10 min-w-6 items-center justify-center rounded-row px-0.5 align-middle underline-offset-2 hover:bg-tint md:border md:border-line md:px-1 font-semibold tabular-nums hover:border-ink md:h-8" aria-label={`${label(id)} is number ${i + 1}. Move it to another position`} title="Move to position" data-testid="route-position" onClick={() => setMoving({ route: r.id, id, to: String(i + 1) })}>{i + 1}</button>
            ) : <span className="mr-1 font-semibold tabular-nums">{i + 1}.</span>}
          </span>
          <span className="min-w-0 flex-1 leading-tight">
            {label(id)}{elsewhere(id, r.id).length ? <span className="block text-xs text-warn-ink">Also on {elsewhere(id, r.id).join(', ')}</span> : null}{contracted(id) ? null : <span className="block text-xs font-medium text-warn-ink" data-testid="route-no-contract">No accepted contract: won&apos;t be billed</span>}
          </span>
          <Button size="sm" variant="ghost" className="h-10 w-8 shrink-0 p-0 md:h-8" aria-label={`Move ${label(id)} up`} data-testid="route-up" disabled={i === 0} onClick={() => moveTo(r, i, i - 1)}><ArrowUp size={18} aria-hidden="true" /></Button>
          <Button size="sm" variant="ghost" className="h-10 w-8 shrink-0 p-0 md:h-8" aria-label={`Move ${label(id)} down`} data-testid="route-down" disabled={i === r.site_ids.length - 1} onClick={() => moveTo(r, i, i + 1)}><ArrowDown size={18} aria-hidden="true" /></Button>
          <Button size="sm" variant="ghost" className="h-10 w-8 shrink-0 p-0 hover:bg-danger-tint hover:text-danger md:h-8" aria-label={`Remove ${label(id)}`} data-testid="route-remove" onClick={() => remove(id, i)}><X size={18} aria-hidden="true" /></Button>
        </li>
      ) : null)}
    </ol>
    </>
  );
}

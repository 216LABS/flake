'use client';

import { Button, Card, Input, Label, Select } from '@flake/ui';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { useConfirm } from '@/components/confirm';
import { api } from '@/lib/client';
import { SuggestOrder } from './suggest-order';

interface R { id: string; name: string; default_crew_id: string | null; yard_trip: boolean; site_ids: string[] }

export function RoutesEditor({ routes, sites, crew, yard = null }: { routes: R[]; sites: { id: string; label: string; active: boolean }[]; crew: { id: string; name: string }[]; yard?: string | null }) {
  const router = useRouter();
  const [list, setList] = useState(routes);
  const [name, setName] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [drag, setDrag] = useState<{ route: string; index: number } | null>(null);
  const [ask, dialog] = useConfirm();
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
      await api(`/api/routes/${r.id}`, { method: 'PATCH', body: { name: r.name, default_crew_id: r.default_crew_id, site_ids: r.site_ids } });
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
  const addSite = async (r: R, id: string) => {
    const other = elsewhere(id, r.id);
    if (other.length && !(await ask({ title: `${label(id)} is already on ${other.join(' and ')}`, body: 'A lot on two routes can be sent two trucks. When both routes go out in one storm it goes on the first one only. Add it here too?', confirm: 'Add it anyway' }))) return;
    update({ ...r, site_ids: [...r.site_ids, id] });
  };
  const nameTaken = (n: string, except?: string) => list.some((x) => x.id !== except && x.name.trim().toLowerCase() === n.trim().toLowerCase());
  return (
    <div>
      {dialog}
      {error ? <p className="mb-3 text-sm text-red-700" role="alert">{error}</p> : null}
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
            {!r.site_ids.length ? <p className="mt-3 text-sm text-slate-600" data-testid="route-empty">No sites yet. Add them below; an empty route is left out of storms.</p> : null}
            <ol className="mt-3 space-y-1">
              {r.site_ids.map((id, i) => (
                <li key={id} draggable onDragStart={(e) => { e.dataTransfer.setData('text/plain', id); setDrag({ route: r.id, index: i }); }} onDragOver={(e) => e.preventDefault()} onDrop={() => { if (drag?.route === r.id) moveTo(r, drag.index, i); setDrag(null); }} className="flex flex-wrap items-center gap-1 rounded-sm border bg-slate-50 px-2 py-1 text-sm">
                  <span className="min-w-0 flex-1">{i + 1}. {label(id)}{elsewhere(id, r.id).length ? <span className="block text-xs text-amber-800">Also on {elsewhere(id, r.id).join(', ')}</span> : null}</span>
                  <Button size="sm" variant="ghost" className="h-10 min-w-11 md:h-8" aria-label={`Move ${label(id)} up`} data-testid="route-up" disabled={i === 0} onClick={() => moveTo(r, i, i - 1)}>Up</Button>
                  <Button size="sm" variant="ghost" className="h-10 min-w-11 md:h-8" aria-label={`Move ${label(id)} down`} data-testid="route-down" disabled={i === r.site_ids.length - 1} onClick={() => moveTo(r, i, i + 1)}>Down</Button>
                  <Button size="sm" variant="ghost" className="h-10 md:h-8" aria-label={`Remove ${label(id)}`} onClick={() => update({ ...r, site_ids: r.site_ids.filter((x) => x !== id) })}>Remove</Button>
                </li>
              ))}
            </ol>
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
            <SuggestOrder key={`${r.id}:${r.yard_trip}`} routeId={r.id} siteIds={r.site_ids} label={label} yard={yard && r.yard_trip ? yard : null} onAccept={(ids) => update({ ...r, site_ids: ids })} />
            <Select aria-label={`Add a site to ${r.name}`} className="mt-2" value="" onChange={(e) => e.target.value && void addSite(r, e.target.value)}>
              <option value="">Add a site...</option>
              {sites.filter((s) => s.active && !r.site_ids.includes(s.id)).map((s) => {
                const other = elsewhere(s.id, r.id);
                return <option key={s.id} value={s.id}>{s.label}{other.length ? ` (on ${other.join(', ')})` : ''}</option>;
              })}
            </Select>
            <Button size="sm" variant="ghost" className="mt-2" data-testid="route-archive" onClick={async () => {
              if (!(await ask({ title: `Archive ${r.name}?`, body: 'It leaves the routes list and the storm form. Storms already run on it keep their records. You can restore it from Archived routes at the bottom of this page.', confirm: 'Archive route', danger: true }))) return;
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
      <Card className="mt-4 flex max-w-md flex-wrap items-end gap-2">
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
        {name.trim() && nameTaken(name) ? <p className="w-full text-sm text-red-700" data-testid="route-name-taken">There&apos;s already a route called {name.trim()}.</p> : null}
      </Card>
    </div>
  );
}

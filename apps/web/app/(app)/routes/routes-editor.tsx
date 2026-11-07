'use client';

import { Button, Card, Input, Label, Select } from '@flake/ui';
import { useState } from 'react';
import { api } from '@/lib/client';

interface R { id: string; name: string; default_crew_id: string | null; site_ids: string[] }

export function RoutesEditor({ routes, sites, crew }: { routes: R[]; sites: { id: string; label: string }[]; crew: { id: string; name: string }[] }) {
  const [list, setList] = useState(routes);
  const [name, setName] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [drag, setDrag] = useState<{ route: string; index: number } | null>(null);
  const label = (id: string) => sites.find((s) => s.id === id)?.label ?? 'Retired site';

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
    const ids = [...r.site_ids];
    const [item] = ids.splice(from, 1);
    ids.splice(to, 0, item!);
    update({ ...r, site_ids: ids });
  };
  return (
    <div>
      {error ? <p className="mb-3 text-sm text-red-700" role="alert">{error}</p> : null}
      <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
        {list.map((r) => (
          <Card key={r.id} data-testid="route-card">
            <Input aria-label="Route name" value={r.name} onChange={(e) => setList((all) => all.map((x) => (x.id === r.id ? { ...x, name: e.target.value } : x)))} onBlur={() => void save(r)} className="font-semibold" />
            <Label className="mt-2" htmlFor={`crew-${r.id}`}>Default driver</Label>
            <Select id={`crew-${r.id}`} value={r.default_crew_id ?? ''} onChange={(e) => update({ ...r, default_crew_id: e.target.value || null })}>
              <option value="">None</option>
              {crew.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
            </Select>
            <ol className="mt-3 space-y-1">
              {r.site_ids.map((id, i) => (
                <li key={id} draggable onDragStart={(e) => { e.dataTransfer.setData('text/plain', id); setDrag({ route: r.id, index: i }); }} onDragOver={(e) => e.preventDefault()} onDrop={() => { if (drag?.route === r.id) moveTo(r, drag.index, i); setDrag(null); }} className="flex items-center gap-1 rounded-sm border bg-slate-50 px-2 py-1 text-sm">
                  <span className="flex-1">{i + 1}. {label(id)}</span>
                  <Button size="sm" variant="ghost" aria-label={`Move ${label(id)} up`} disabled={i === 0} onClick={() => moveTo(r, i, i - 1)}>Up</Button>
                  <Button size="sm" variant="ghost" aria-label={`Remove ${label(id)}`} onClick={() => update({ ...r, site_ids: r.site_ids.filter((x) => x !== id) })}>Remove</Button>
                </li>
              ))}
            </ol>
            <Select aria-label={`Add a site to ${r.name}`} className="mt-2" value="" onChange={(e) => e.target.value && update({ ...r, site_ids: [...r.site_ids, e.target.value] })}>
              <option value="">Add a site...</option>
              {sites.filter((s) => !r.site_ids.includes(s.id)).map((s) => <option key={s.id} value={s.id}>{s.label}</option>)}
            </Select>
          </Card>
        ))}
      </div>
      <Card className="mt-4 flex max-w-md items-end gap-2">
        <div className="flex-1"><Label htmlFor="new-route">New route</Label><Input id="new-route" value={name} onChange={(e) => setName(e.target.value)} /></div>
        <Button disabled={!name.trim()} onClick={async () => {
          try {
            const created = await api<{ id: string; name: string }>('/api/routes', { body: { name } });
            setList((all) => [...all, { id: created.id, name: created.name, default_crew_id: null, site_ids: [] }]);
            setName('');
          } catch (e) {
            setError((e as Error).message);
          }
        }}>Add</Button>
      </Card>
    </div>
  );
}

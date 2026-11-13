'use client';

import { Button, Card, Input, Label, Select } from '@flake/ui';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { api } from '@/lib/client';

export function NewStorm({ routes, crew, defaultName }: { routes: { id: string; name: string; default_crew_id: string | null }[]; crew: { id: string; name: string; kind: string }[]; defaultName: string }) {
  const router = useRouter();
  const [name, setName] = useState(defaultName);
  const [picked, setPicked] = useState<Record<string, string>>(Object.fromEntries(routes.map((r) => [r.id, r.default_crew_id ?? ''])));
  const [off, setOff] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [busySites, setBusySites] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const submit = async (skipBusy = false) => {
    setBusy(true);
    setError(null);
    setBusySites(null);
    try {
      const routeIds = routes.map((r) => r.id).filter((id) => !off.includes(id));
      // Every included route says who drives it. An empty choice is sent as "nobody", not left for the route's usual driver.
      const crewAssignments = Object.fromEntries(routeIds.map((id) => [id, picked[id] || null]));
      const out = await api<{ id: string }>('/api/storms', { body: { name, routeIds, crewAssignments, skipBusy } });
      router.push(`/storms/${out.id}`);
    } catch (e) {
      const err = e as Error & { code?: string };
      if (err.code === 'busy_sites') setBusySites(err.message);
      else setError(err.message);
      setBusy(false);
    }
  };
  const noDriver = routes.filter((r) => !off.includes(r.id) && !picked[r.id]);
  return (
    <Card>
      <h2 className="font-display mb-3 text-xl font-semibold">Start a storm</h2>
      <Label htmlFor="storm-name">Name</Label>
      <Input id="storm-name" value={name} onChange={(e) => setName(e.target.value)} data-testid="storm-name" />
      <div className="mt-3 space-y-3">
        {routes.map((r) => (
          <div key={r.id}>
            <label className="flex items-center gap-2 text-sm font-medium">
              <input type="checkbox" checked={!off.includes(r.id)} onChange={(e) => setOff(e.target.checked ? off.filter((x) => x !== r.id) : [...off, r.id])} />
              {r.name}
            </label>
            <Select aria-label={`Driver for ${r.name}`} className="mt-1" value={picked[r.id] ?? ''} onChange={(e) => setPicked({ ...picked, [r.id]: e.target.value })}>
              <option value="">No driver yet</option>
              {crew.map((c) => <option key={c.id} value={c.id}>{c.name}{c.kind === 'sub' ? ' (sub)' : ''}</option>)}
            </Select>
          </div>
        ))}
        {!routes.length ? <p className="text-sm text-muted">No routes yet.</p> : null}
      </div>
      {noDriver.length && routes.length ? <p className="mt-2 text-xs text-muted" data-testid="no-driver-note">{noDriver.map((r) => r.name).join(', ')} {noDriver.length === 1 ? 'has' : 'have'} no driver. Pick one on the storm board before you publish.</p> : null}
      {error ? <p className="mt-2 text-sm text-danger" role="alert">{error}</p> : null}
      {busySites ? (
        <div className="mt-2 rounded-md bg-warn-tint p-3 text-sm text-warn-ink" role="alert" data-testid="busy-sites">
          <p>{busySites}</p>
          <Button size="sm" variant="outline" className="mt-2" disabled={busy} data-testid="start-without-busy" onClick={() => void submit(true)}>Start without those lots</Button>
        </div>
      ) : null}
      <Button variant="accent" className="mt-4 w-full" disabled={busy || !routes.length} onClick={() => void submit()} data-testid="create-storm">Create storm</Button>
    </Card>
  );
}

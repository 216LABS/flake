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
  const [busy, setBusy] = useState(false);
  const submit = async () => {
    setBusy(true);
    setError(null);
    try {
      const routeIds = routes.map((r) => r.id).filter((id) => !off.includes(id));
      const crewAssignments = Object.fromEntries(Object.entries(picked).filter(([k, v]) => v && routeIds.includes(k)));
      const out = await api<{ id: string }>('/api/storms', { body: { name, routeIds, crewAssignments } });
      router.push(`/storms/${out.id}`);
    } catch (e) {
      setError((e as Error).message);
      setBusy(false);
    }
  };
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
              <option value="">Choose a driver</option>
              {crew.map((c) => <option key={c.id} value={c.id}>{c.name}{c.kind === 'sub' ? ' (sub)' : ''}</option>)}
            </Select>
          </div>
        ))}
        {!routes.length ? <p className="text-sm text-slate-600">No routes yet.</p> : null}
      </div>
      {error ? <p className="mt-2 text-sm text-red-700" role="alert">{error}</p> : null}
      <Button variant="accent" className="mt-4 w-full" disabled={busy || !routes.length} onClick={submit} data-testid="create-storm">Create storm</Button>
    </Card>
  );
}

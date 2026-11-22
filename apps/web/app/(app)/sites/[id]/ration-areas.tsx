'use client';

import { Card } from '@flake/ui';
import { useState } from 'react';
import { api } from '@/lib/client';

const AREAS = [['entrances', 'Entrances'], ['hills', 'Hills and ramps'], ['walks', 'Walks'], ['ada', 'Accessible spaces']] as const;

/** Where salt goes first when it's rationed (issue 232). Shown to the driver only while rationing is on. */
export function RationAreas({ siteId, initial, canEdit }: { siteId: string; initial: string[]; canEdit: boolean }) {
  const [areas, setAreas] = useState<string[]>(initial);
  const [msg, setMsg] = useState<string | null>(null);
  const save = async (next: string[]) => {
    setAreas(next);
    setMsg(null);
    try {
      await api('/api/salt/policy', { method: 'PUT', body: { action: 'areas', site_id: siteId, areas: next } });
      setMsg('Saved');
    } catch (e) {
      setMsg((e as Error).message);
    }
  };
  return (
    <Card data-testid="ration-areas">
      <h2 className="font-semibold">Salt priority areas</h2>
      <p className="mt-1 text-sm text-muted">When salt is rationed, the driver salts only these on this lot.</p>
      <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1">
        {AREAS.map(([k, label]) => (
          <label key={k} className="flex min-h-11 items-center gap-2 text-sm">
            <input type="checkbox" disabled={!canEdit} checked={areas.includes(k)} data-testid={`ration-area-${k}`} onChange={(e) => void save(e.target.checked ? [...areas, k] : areas.filter((x) => x !== k))} />
            {label}
          </label>
        ))}
      </div>
      {msg ? <p className="mt-1 text-xs text-muted" role="status">{msg}</p> : null}
    </Card>
  );
}

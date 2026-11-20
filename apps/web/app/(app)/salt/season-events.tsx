'use client';

import { Button, Input } from '@flake/ui';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { api } from '@/lib/client';

/** How many salt runs a season usually has here, so the estimate fits the area (issue 197). */
export function SeasonEvents({ events }: { events: number }) {
  const router = useRouter();
  const [n, setN] = useState(String(events));
  return (
    <form className="mt-2 flex items-center gap-1 text-xs" onSubmit={async (e) => {
      e.preventDefault();
      await api('/api/salt/events', { method: 'PUT', body: { events: Math.round(Number(n)) } });
      router.refresh();
    }}>
      <label htmlFor="salt-events" className="text-muted">Salt runs a season</label>
      <Input id="salt-events" type="number" min={1} max={100} className="h-8 w-16 px-2 text-xs" value={n} onChange={(e) => setN(e.target.value)} data-testid="salt-events" />
      <Button size="sm" variant="ghost" type="submit" data-testid="salt-events-save">Save</Button>
    </form>
  );
}

'use client';

import { Button } from '@flake/ui';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { api } from '@/lib/client';

export function AlertActions({ alertId, status, routeIds, siteIds, name }: { alertId: string; status: string; routeIds: string[]; siteIds: string[]; name: string }) {
  const router = useRouter();
  const [stormId, setStormId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const run = async (fn: () => Promise<void>) => {
    setBusy(true);
    setError(null);
    try {
      await fn();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  return (
    <div>
      <div className="flex flex-wrap gap-2">
        {!stormId ? (
          <>
            <Button variant="accent" size="lg" disabled={busy || status !== 'open'} data-testid="start-storm" onClick={() => run(async () => {
              const out = await api<{ id: string }>('/api/storms', { body: { name, routeIds, triggerAlertId: alertId, siteIds } });
              setStormId(out.id);
            })}>Start storm</Button>
            <Button variant="outline" size="lg" disabled={busy || status !== 'open'} onClick={() => run(async () => {
              await api(`/api/alerts/${alertId}`, { method: 'PATCH', body: { status: 'dismissed' } });
              router.push('/dashboard');
            })}>Dismiss</Button>
          </>
        ) : (
          <Button variant="accent" size="lg" disabled={busy} data-testid="publish" onClick={() => run(async () => {
            await api(`/api/storms/${stormId}/publish`, { method: 'POST' });
            router.push(`/storms/${stormId}`);
          })}>Publish</Button>
        )}
      </div>
      {error ? <p className="mt-2 text-sm text-red-700" role="alert">{error}</p> : null}
    </div>
  );
}

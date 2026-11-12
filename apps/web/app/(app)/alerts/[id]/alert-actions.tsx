'use client';

import { Button } from '@flake/ui';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { api } from '@/lib/client';
import { useConfirm } from '@/components/confirm';
import { sendRoutesBody, type RunReach } from '../../storms/[id]/send-routes';

export function AlertActions({ alertId, status, routeIds, siteIds, name }: { alertId: string; status: string; routeIds: string[]; siteIds: string[]; name: string }) {
  const router = useRouter();
  const [stormId, setStormId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [ask, dialog] = useConfirm();
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
      {dialog}
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
          <>
            <Button variant="accent" size="lg" disabled={busy} data-testid="publish" onClick={() => run(async () => {
              // Who gets what, before anything is sent (issue 76).
              const live = await api<{ runs: RunReach[] }>(`/api/storms/${stormId}/live`);
              if (!(await ask({ title: 'Send routes to the crew?', body: sendRoutesBody(live.runs), confirm: 'Send routes' }))) return;
              try {
                await api(`/api/storms/${stormId}/publish`, { method: 'POST' });
              } catch (e) {
                // A route with no driver is fixed on the board, so go there instead of leaving them stuck here.
                if ((e as { code?: string }).code !== 'no_crew') throw e;
              }
              router.push(`/storms/${stormId}`);
            })}>Send routes to crew</Button>
            <Button variant="outline" size="lg" disabled={busy} data-testid="open-board-quiet" onClick={() => router.push(`/storms/${stormId}`)}>Open the board without sending</Button>
          </>
        )}
      </div>
      {error ? <p className="mt-2 text-sm text-red-700" role="alert">{error}</p> : null}
    </div>
  );
}

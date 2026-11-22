'use client';

import { Button, Card } from '@flake/ui';
import { useState } from 'react';
import { ButtonLink } from '@/components/links';
import { api } from '@/lib/client';

/**
 * Lots on no route, in one tap (issue 212). An imported list lands with no route at all, and a storm only goes to lots
 * that are on one. No routes yet: make Route 1 with all of them. One route: add them to it. More: Plan all places them.
 */
export function UnroutedLots({ lots, routes }: { lots: { id: string; label: string }[]; routes: { id: string; name: string }[] }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  if (!lots.length) return null;
  const n = lots.length === 1 ? '1 lot isn\'t' : `${lots.length} lots aren't`;
  const names = lots.slice(0, 4).map((l) => l.label).join(', ') + (lots.length > 4 ? ` and ${lots.length - 4} more` : '');
  const run = async (fn: () => Promise<void>) => {
    setBusy(true);
    setError(null);
    try {
      await fn();
      // The routes editor holds its own copy of each route's stops, so a full reload shows the lots on them.
      window.location.reload();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  const taken = new Set(routes.map((r) => r.name.toLowerCase()));
  let k = routes.length + 1;
  while (taken.has(`route ${k}`)) k++;
  return (
    <Card className="mb-4 max-w-3xl border-warn-line bg-warn-tint" data-testid="unrouted-lots">
      <p className="text-sm text-warn-ink"><b>{n} on a route yet</b>, so a storm won&apos;t send a truck: {names}.</p>
      <div className="mt-2 flex flex-wrap items-center gap-2">
        {routes.length === 0 ? (
          <Button size="sm" variant="accent" disabled={busy} data-testid="unrouted-new-route" onClick={() => run(async () => { await api('/api/routes', { body: { name: `Route ${k}`, site_ids: lots.map((l) => l.id) } }); })}>Put {lots.length === 1 ? 'it' : `all ${lots.length}`} on a new route</Button>
        ) : routes.length === 1 ? (
          <Button size="sm" variant="accent" disabled={busy} data-testid="unrouted-add" onClick={() => run(async () => { for (const l of lots) await api(`/api/routes/${routes[0]!.id}/stops`, { body: { site_id: l.id } }); })}>Add {lots.length === 1 ? 'it' : `all ${lots.length}`} to {routes[0]!.name}</Button>
        ) : (
          <ButtonLink size="sm" variant="accent" href="/routes/plan" data-testid="unrouted-plan">Place them with Plan all routes</ButtonLink>
        )}
        <span className="text-xs text-warn-ink">Then Suggest order sorts each route by drive time.</span>
      </div>
      {error ? <p className="mt-2 text-sm text-danger" role="alert">{error}</p> : null}
    </Card>
  );
}

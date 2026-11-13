'use client';

import { Button } from '@flake/ui';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { api } from '@/lib/client';

/** Brings an archived route back to Routes and the storm form, with its stops and driver as they were (issue 52). */
export function RestoreRoute({ id, name }: { id: string; name: string }) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  return (
    <div className="flex flex-wrap items-center gap-2">
      <Button size="sm" variant="outline" disabled={busy} data-testid="restore-route" aria-label={`Restore ${name}`} onClick={async () => {
        setBusy(true);
        setError(null);
        try {
          await api(`/api/routes/${id}`, { method: 'PATCH', body: { archived: false } });
          router.refresh();
        } catch (e) {
          setError((e as Error).message);
        } finally {
          setBusy(false);
        }
      }}>Restore</Button>
      {error ? <span className="text-sm text-danger" role="alert">{error}</span> : null}
    </div>
  );
}

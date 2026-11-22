'use client';

import { Button, Card, Input, Label } from '@flake/ui';
import { useState } from 'react';
import { api } from '@/lib/client';

/** When a driver who hasn't answered or opened their link becomes an alert (issue 234). */
export function NoShowPanel({ minutes, canEdit }: { minutes: number; canEdit: boolean }) {
  const [value, setValue] = useState(String(minutes));
  const [msg, setMsg] = useState<string | null>(null);
  const ok = Number.isInteger(Number(value)) && Number(value) >= 5 && Number(value) <= 240;
  return (
    <Card className="mt-4 max-w-xl" data-testid="noshow-panel">
      <h2 className="font-semibold">Drivers who don&apos;t show</h2>
      <p className="mt-1 text-sm text-muted">If a driver hasn&apos;t answered the call-out or opened their route this long before their first lot&apos;s open-by time, you get an alert, and the storm board offers the run to your standby drivers.</p>
      <div className="mt-3 flex items-end gap-2">
        <div><Label htmlFor="noshow-min">Minutes before open-by</Label><Input id="noshow-min" type="number" inputMode="numeric" min={5} max={240} className="w-28" value={value} disabled={!canEdit} onChange={(e) => { setValue(e.target.value); setMsg(null); }} data-testid="noshow-minutes" /></div>
        {canEdit ? <Button disabled={!ok} data-testid="noshow-save" onClick={async () => {
          try {
            await api('/api/settings/noshow', { method: 'PUT', body: { minutes: Number(value) } });
            setMsg('Saved');
          } catch (e) {
            setMsg((e as Error).message);
          }
        }}>Save</Button> : null}
      </div>
      {!ok ? <p className="mt-1 text-sm text-danger">Between 5 and 240 minutes.</p> : null}
      {msg ? <p className="mt-1 text-sm text-muted" role="status" data-testid="noshow-msg">{msg}</p> : null}
    </Card>
  );
}

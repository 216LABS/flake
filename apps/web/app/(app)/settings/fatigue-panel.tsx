'use client';

import { Button, Card, Input, Label } from '@flake/ui';
import { useState } from 'react';
import { api } from '@/lib/client';

/** Long shifts and short rests during a storm (issue 235). Shows hours; it isn't an hours-of-service rule. */
export function FatiguePanel({ warn, rest, canEdit }: { warn: number; rest: number; canEdit: boolean }) {
  const [f, setF] = useState({ warn: String(warn), rest: String(rest) });
  const [msg, setMsg] = useState<string | null>(null);
  const ok = Number(f.warn) >= 4 && Number(f.warn) <= 36 && Number(f.rest) >= 2 && Number(f.rest) <= 24;
  return (
    <Card className="mt-4 max-w-xl" data-testid="fatigue-panel">
      <h2 className="font-semibold">Long shifts</h2>
      <p className="mt-1 text-sm text-muted">Flake counts each driver&apos;s hours from their phone, the same way payroll does. The storm board marks a driver past these limits, you get one alert, and the driver sees a gentle note to take a break. Nothing stops them finishing a stop. These are your limits, not a DOT or CDL hours-of-service check.</p>
      <div className="mt-3 flex flex-wrap items-end gap-2">
        <div><Label htmlFor="fat-warn">Warn after (hours on)</Label><Input id="fat-warn" type="number" inputMode="decimal" className="w-28" value={f.warn} disabled={!canEdit} onChange={(e) => { setF({ ...f, warn: e.target.value }); setMsg(null); }} data-testid="fatigue-warn" /></div>
        <div><Label htmlFor="fat-rest">Rest at least (hours)</Label><Input id="fat-rest" type="number" inputMode="decimal" className="w-28" value={f.rest} disabled={!canEdit} onChange={(e) => { setF({ ...f, rest: e.target.value }); setMsg(null); }} data-testid="fatigue-rest-hours" /></div>
        {canEdit ? <Button disabled={!ok} data-testid="fatigue-save" onClick={async () => {
          try {
            await api('/api/settings/fatigue', { method: 'PUT', body: { warn_hours: Number(f.warn), min_rest_hours: Number(f.rest) } });
            setMsg('Saved');
          } catch (e) {
            setMsg((e as Error).message);
          }
        }}>Save</Button> : null}
      </div>
      {!ok ? <p className="mt-1 text-sm text-danger">Warn between 4 and 36 hours; rest between 2 and 24.</p> : null}
      {msg ? <p className="mt-1 text-sm text-muted" role="status" data-testid="fatigue-msg">{msg}</p> : null}
    </Card>
  );
}

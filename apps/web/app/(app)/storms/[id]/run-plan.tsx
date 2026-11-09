'use client';

import { Button } from '@flake/ui';
import { useState } from 'react';
import { api } from '@/lib/client';

interface Stop { id: string; label: string; arrive: string; late: boolean }
interface Plan { from: 'truck' | 'lot' | null; position_at?: string | null; changed: boolean; order: string[]; suggested: { stops: Stop[]; drive_min: number; late: number } | null; current: { drive_min: number; late: number } | null }

const clock = (hm: string) => {
  const [h, m] = hm.split(':').map(Number);
  return `${((h! + 11) % 12) + 1}:${String(m).padStart(2, '0')} ${h! < 12 ? 'AM' : 'PM'}`;
};

/** Re-plans one truck's remaining stops from where it is now. Nothing changes until the office taps Use this order. */
export function RunPlan({ runId, onDone }: { runId: string; onDone: () => void }) {
  const [plan, setPlan] = useState<Plan | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = async () => {
    setBusy(true);
    setError(null);
    try {
      setPlan(await api<Plan>(`/api/runs/${runId}/plan`));
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  if (!plan) {
    return (
      <>
        <Button size="sm" variant="ghost" className="-ml-3" disabled={busy} data-testid="replan" onClick={() => void load()}>Re-plan from truck</Button>
        {error ? <p className="text-xs text-red-700" role="alert">{error}</p> : null}
      </>
    );
  }
  const s = plan.suggested;
  const saved = s && plan.current ? plan.current.drive_min - s.drive_min : 0;
  return (
    <div className="mt-2 rounded-md border border-amber-300 bg-amber-50 p-2 text-xs" data-testid="replan-panel">
      {!plan.from ? <p>No position from this truck yet. It shows once the driver has the route open.</p>
        : !s ? <p>Fewer than two stops left to order.</p>
        : !plan.changed ? <p data-testid="replan-summary">The current order is already the shortest from {plan.from === 'lot' ? 'the lot the driver is on' : "the truck's position"}.</p>
        : (
          <>
            <p className="font-medium" data-testid="replan-summary">From {plan.from === 'lot' ? 'the lot the driver is on' : "the truck's last position"}: {saved > 0 ? `saves about ${saved} min of driving` : `${(plan.current?.late ?? 0) - s.late} fewer late stops`}.</p>
            <ol className="mt-1 space-y-0.5">
              {s.stops.map((x, i) => <li key={x.id} className="flex justify-between gap-2"><span>{i + 1}. {x.label}</span><span className="tabular-nums">{clock(x.arrive)}{x.late ? ' late' : ''}</span></li>)}
            </ol>
          </>
        )}
      <div className="mt-2 flex gap-2">
        {plan.changed ? <Button size="sm" disabled={busy} data-testid="replan-accept" onClick={async () => {
          setBusy(true);
          try {
            await api(`/api/runs/${runId}/order`, { body: { stop_ids: plan.order } });
            setPlan(null);
            onDone();
          } catch (e) {
            setError((e as Error).message);
          } finally {
            setBusy(false);
          }
        }}>Use this order</Button> : null}
        <Button size="sm" variant="ghost" onClick={() => setPlan(null)}>{plan.changed ? 'Keep' : 'Close'}</Button>
      </div>
      {error ? <p className="mt-1 text-red-700" role="alert">{error}</p> : null}
    </div>
  );
}

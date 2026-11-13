'use client';

import { Button } from '@flake/ui';
import { useState } from 'react';
import { api } from '@/lib/client';

interface Stop { id: string; label: string; arrive: string; late: boolean }
interface Plan { from: 'truck' | 'lot' | 'last_done' | null; from_label?: string | null; times_label?: string; position_at?: string | null; changed: boolean; order: string[]; suggested: { stops: Stop[]; drive_min: number; late: number } | null; current: { drive_min: number; late: number } | null }

const clock = (hm: string) => {
  const [h, m] = hm.split(':').map(Number);
  return `${((h! + 11) % 12) + 1}:${String(m).padStart(2, '0')} ${h! < 12 ? 'AM' : 'PM'}`;
};

/** Re-plans one truck's remaining stops from where it is now. Nothing changes until the office taps Use this order. */
/** Where a re-plan starts from, in words. */
const where = (p: { from: string | null; from_label?: string | null }) => p.from === 'lot' ? 'the lot the driver is on' : p.from === 'last_done' ? `the last lot finished, ${p.from_label ?? ''}` : "the truck's last position";

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
        {error ? <p className="text-xs text-danger" role="alert">{error}</p> : null}
      </>
    );
  }
  const s = plan.suggested;
  const saved = s && plan.current ? plan.current.drive_min - s.drive_min : 0;
  return (
    <div className="mt-2 rounded-md border border-warn-line bg-warn-tint p-2 text-xs" data-testid="replan-panel">
      {!plan.from ? <p data-testid="replan-no-position">No position from this truck yet. The phone shares it after the driver taps Arrive and allows location, and it updates about once a minute while the route is open.</p>
        : !s ? <p>Fewer than two stops left to order.</p>
        : !plan.changed ? <p data-testid="replan-summary">The current order is already the shortest from {where(plan)}.</p>
        : (
          <>
            {plan.from === 'last_done' ? <p className="mb-1 text-warn-ink" data-testid="replan-fallback">This truck hasn't shared a location and nobody is on a lot, so this starts from the last lot it finished.</p> : null}
            <p className="font-medium" data-testid="replan-summary">From {where(plan)}: {saved > 0 ? `saves about ${saved} min of driving` : `${(plan.current?.late ?? 0) - s.late} fewer late stops`}.</p>
            <ol className="mt-1 space-y-0.5">
              {s.stops.map((x, i) => <li key={x.id} className="flex justify-between gap-2"><span>{i + 1}. {x.label}</span><span className="tabular-nums">{clock(x.arrive)}{x.late ? ' late' : ''}</span></li>)}
            </ol>
            {plan.times_label ? <p className="mt-1 text-muted" data-testid="replan-times">{plan.times_label}</p> : null}
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
      {error ? <p className="mt-1 text-danger" role="alert">{error}</p> : null}
    </div>
  );
}

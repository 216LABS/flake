'use client';

import { Badge, Button } from '@flake/ui';
import { useState } from 'react';
import { api } from '@/lib/client';

export const STATUS_TONE: Record<string, 'green' | 'amber' | 'red' | 'gray' | 'blue'> = { confirmed: 'green', opened: 'green', declined: 'red', no_reply: 'amber', not_opened: 'amber', no_driver: 'red' };
export const STATUS_WORD: Record<string, string> = { confirmed: 'Confirmed', declined: 'Declined', no_reply: 'No reply', opened: 'Opened link', not_opened: 'Not opened', no_driver: 'No driver' };

/** A run's driver in one word (issue 234): Confirmed, Declined, No reply, Opened link or Not opened. */
export function DriverStatus({ status }: { status: string }) {
  return <Badge tone={STATUS_TONE[status] ?? 'gray'} data-testid="driver-status" data-status={status}>{STATUS_WORD[status] ?? status}</Badge>;
}

/** Standby drivers for this storm: the people a run is offered to when its driver doesn't show (issue 234). */
export function StandbyPicker({ stormId, crew, standby, onSaved }: { stormId: string; crew: { id: string; name: string; kind: string }[]; standby: string[]; onSaved: () => void }) {
  const [open, setOpen] = useState(false);
  const [picked, setPicked] = useState<string[]>(standby);
  const [error, setError] = useState<string | null>(null);
  const names = crew.filter((c) => standby.includes(c.id)).map((c) => c.name);
  return (
    <div className="mb-3 text-sm" data-testid="standby">
      <span className="text-muted">Standby tonight: </span>
      <span data-testid="standby-names">{names.length ? names.join(', ') : 'nobody yet'}</span>
      <Button size="sm" variant="ghost" className="ml-1" data-testid="standby-edit" onClick={() => { setPicked(standby); setOpen(!open); }}>{open ? 'Cancel' : 'Choose'}</Button>
      {open ? (
        <div className="mt-2 flex flex-wrap items-center gap-3 rounded-md border border-line-faint bg-surface p-2">
          {crew.map((c) => (
            <label key={c.id} className="flex min-h-11 items-center gap-2">
              <input type="checkbox" checked={picked.includes(c.id)} data-testid="standby-pick" onChange={(e) => setPicked(e.target.checked ? [...picked, c.id] : picked.filter((x) => x !== c.id))} />
              {c.name}{c.kind === 'sub' ? ' (sub)' : ''}
            </label>
          ))}
          <Button size="sm" data-testid="standby-save" onClick={async () => {
            try {
              await api(`/api/storms/${stormId}/standby`, { method: 'PUT', body: { crew_ids: picked } });
              setOpen(false);
              onSaved();
            } catch (e) {
              setError((e as Error).message);
            }
          }}>Save</Button>
          {error ? <span className="text-danger" role="alert">{error}</span> : null}
        </div>
      ) : null}
    </div>
  );
}

/** After the storm: who was asked, who answered, who didn't show, and runs that changed hands (issue 234). */
export function CrewReport({ rows }: { rows: { id: string; name: string; asked: boolean; reply: string | null; no_show: boolean; handed_off: number; took_over: number }[] }) {
  if (!rows.length) return null;
  return (
    <section className="mt-6 max-w-3xl" data-testid="crew-report">
      <h2 className="font-display mb-2 text-lg font-semibold">Crew this storm</h2>
      <div className="overflow-x-auto rounded-md border border-line-faint bg-surface">
        <table className="w-full text-sm">
          <thead className="bg-tint text-left text-xs uppercase tracking-wide text-muted"><tr><th className="p-2">Driver</th><th className="p-2">Called out</th><th className="p-2">Reply</th><th className="p-2">No-show</th><th className="p-2">Handed off</th><th className="p-2">Took over</th></tr></thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.id} className="border-t border-line-faint" data-testid="crew-report-row">
                <td className="p-2 font-medium">{r.name}</td><td className="p-2">{r.asked ? 'Yes' : '-'}</td><td className="p-2">{r.reply ?? '-'}</td><td className="p-2">{r.no_show ? 'Yes' : '-'}</td><td className="p-2 tabular">{r.handed_off || '-'}</td><td className="p-2 tabular">{r.took_over || '-'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}

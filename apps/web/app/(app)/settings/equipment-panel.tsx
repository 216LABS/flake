'use client';

import { Badge, Button, Card, Input, Label, Select, Table, Td, Th } from '@flake/ui';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { useConfirm } from '@/components/confirm';
import { api, dollarsToCents, money } from '@/lib/client';

export interface TruckRow { id: string; name: string; kind: string; plate: string | null; active: boolean }
export interface ReminderRow { id: string; truck_id: string; name: string; every_hours: number | null; every_days: number | null; last_done_at: string | null; status: { state: 'ok' | 'soon' | 'overdue'; detail: string; meter: number | null } }
export interface LogRow { id: string; truck_id: string; storm_id: string | null; kind: string; gallons: number | null; cost_cents: number | null; hours: number | null; note: string | null; at: string }

const KIND: Record<string, string> = { truck: 'Truck', loader: 'Loader', skid_steer: 'Skid steer', spreader: 'Spreader', other: 'Other' };
const LOG_KIND: Record<string, string> = { fuel: 'Fuel', hours: 'Meter hours', maintenance: 'Maintenance', note: 'Note' };

/**
 * Trucks and the log against each one: fuel, meter hours and maintenance. Which truck ran a route in a storm is set on
 * the storm board, and by default from the route.
 */
export function EquipmentPanel({ trucks, logs, storms, tz, reminders = [] }: { trucks: TruckRow[]; logs: LogRow[]; storms: { id: string; name: string }[]; tz: string; reminders?: ReminderRow[] }) {
  const router = useRouter();
  const [ask, dialog] = useConfirm();
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [n, setN] = useState({ name: '', kind: 'truck', plate: '' });
  const live = trucks.filter((t) => t.active);
  const [picked, setPicked] = useState(live[0]?.id ?? '');
  const [entry, setEntry] = useState({ kind: 'fuel', gallons: '', cost: '', hours: '', note: '', storm_id: '' });
  const [rem, setRem] = useState({ name: '', hours: '', days: '', lastHours: '' });
  const run = async (fn: () => Promise<unknown>) => {
    setBusy(true);
    setError(null);
    try {
      await fn();
      router.refresh();
      return true;
    } catch (e) {
      setError((e as Error).message);
      return false;
    } finally {
      setBusy(false);
    }
  };
  const when = (iso: string) => new Date(iso).toLocaleDateString('en-US', { timeZone: tz, month: 'short', day: 'numeric', year: 'numeric' });
  const mine = logs.filter((l) => l.truck_id === picked);
  const fuel = mine.filter((l) => l.kind === 'fuel');
  const lastHours = mine.find((l) => l.kind === 'hours' && l.hours != null);
  const lastService = mine.find((l) => l.kind === 'maintenance');
  const entryProblem = entry.kind === 'fuel' && !(Number(entry.gallons) > 0) ? 'Enter the gallons.'
    : entry.kind === 'hours' && !(entry.hours.trim() !== '' && Number(entry.hours) >= 0) ? 'Enter the meter hours.'
      : ['maintenance', 'note'].includes(entry.kind) && !entry.note.trim() ? 'Say what was done.'
        : entry.cost.trim() && !(Number(entry.cost) >= 0) ? 'The cost needs a number.' : null;
  return (
    <div className="grid max-w-5xl grid-cols-1 gap-4 lg:grid-cols-2">
      {dialog}
      <Card data-testid="trucks">
        <h2 className="font-semibold">Trucks and equipment</h2>
        <p className="mt-1 text-sm text-muted">Set a default truck on each route. The storm board shows which truck ran it, and proof packets name the truck at each visit.</p>
        {live.length ? (
          <ul className="mt-3 divide-y divide-line-faint text-sm">
            {live.map((t) => (
              <li key={t.id} className="flex flex-wrap items-center gap-2 py-2" data-testid="truck-row">
                <span className="font-medium wrap-anywhere">{t.name}</span>
                <Badge>{KIND[t.kind] ?? t.kind}</Badge>
                {t.plate ? <span className="text-muted">{t.plate}</span> : null}
                <Button size="sm" variant="ghost" className="ml-auto" data-write disabled={busy} data-testid="truck-retire" onClick={async () => {
                  if (await ask({ title: `Retire ${t.name}?`, body: 'It comes off routes and storm pick lists. Its log and past storms stay on file.', confirm: 'Retire', danger: true })) await run(() => api(`/api/trucks/${t.id}`, { method: 'DELETE' }));
                }}>Retire</Button>
              </li>
            ))}
          </ul>
        ) : <p className="mt-3 text-sm text-muted" data-testid="trucks-empty">No trucks yet. Add the first one below.</p>}
        <div className="mt-3 grid gap-2 sm:grid-cols-3" data-write>
          <div className="sm:col-span-1"><Label htmlFor="truck-name">Name</Label><Input id="truck-name" maxLength={120} placeholder="Truck 3" value={n.name} onChange={(e) => setN({ ...n, name: e.target.value })} data-testid="truck-name" /></div>
          <div><Label htmlFor="truck-kind">Kind</Label><Select id="truck-kind" value={n.kind} onChange={(e) => setN({ ...n, kind: e.target.value })}>{Object.entries(KIND).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</Select></div>
          <div><Label htmlFor="truck-plate">Plate (optional)</Label><Input id="truck-plate" maxLength={20} value={n.plate} onChange={(e) => setN({ ...n, plate: e.target.value })} /></div>
        </div>
        <Button className="mt-2" data-write disabled={busy || !n.name.trim()} data-testid="truck-add" onClick={async () => {
          if (await run(() => api('/api/trucks', { body: { name: n.name.trim(), kind: n.kind, plate: n.plate } }))) setN({ name: '', kind: 'truck', plate: '' });
        }}>Add</Button>
        {error ? <p className="mt-2 text-sm text-danger" role="alert" data-testid="equipment-error">{error}</p> : null}
      </Card>

      {live.length ? (
        <Card data-testid="equipment-log">
          <div className="flex flex-wrap items-end justify-between gap-2">
            <h2 className="font-semibold">Log</h2>
            <Select aria-label="Truck" className="w-auto" value={picked} onChange={(e) => setPicked(e.target.value)} data-testid="log-truck">{live.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}</Select>
          </div>
          <p className="mt-2 text-sm text-ink-2" data-testid="log-summary">
            {fuel.length ? `Fuel logged: ${fuel.reduce((s, l) => s + (l.gallons ?? 0), 0).toFixed(1)} gal${fuel.some((l) => l.cost_cents) ? `, ${money(fuel.reduce((s, l) => s + (l.cost_cents ?? 0), 0))}` : ''}. ` : 'No fuel logged yet. '}
            {lastHours ? `Meter ${lastHours.hours} h on ${when(lastHours.at)}. ` : ''}
            {lastService ? `Last service ${when(lastService.at)}: ${lastService.note}.` : ''}
          </p>
          <div className="mt-3 grid gap-2 sm:grid-cols-2" data-write>
            <div><Label htmlFor="log-kind">What</Label><Select id="log-kind" value={entry.kind} onChange={(e) => setEntry({ ...entry, kind: e.target.value })} data-testid="log-kind">{Object.entries(LOG_KIND).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</Select></div>
            <div><Label htmlFor="log-storm">Storm (optional)</Label><Select id="log-storm" value={entry.storm_id} onChange={(e) => setEntry({ ...entry, storm_id: e.target.value })}><option value="">None</option>{storms.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}</Select></div>
            {entry.kind === 'fuel' ? <div><Label htmlFor="log-gal">Gallons</Label><Input id="log-gal" type="number" inputMode="decimal" min={0} step="0.1" value={entry.gallons} onChange={(e) => setEntry({ ...entry, gallons: e.target.value })} data-testid="log-gallons" /></div> : null}
            {entry.kind === 'hours' ? <div><Label htmlFor="log-hours">Meter hours</Label><Input id="log-hours" type="number" inputMode="decimal" min={0} step="0.1" value={entry.hours} onChange={(e) => setEntry({ ...entry, hours: e.target.value })} data-testid="log-hours" /></div> : null}
            {entry.kind === 'fuel' || entry.kind === 'maintenance' ? <div><Label htmlFor="log-cost">Cost ($, optional)</Label><Input id="log-cost" type="number" inputMode="decimal" min={0} step="0.01" value={entry.cost} onChange={(e) => setEntry({ ...entry, cost: e.target.value })} data-testid="log-cost" /></div> : null}
            <div className="sm:col-span-2"><Label htmlFor="log-note">{entry.kind === 'maintenance' ? 'What was done' : 'Note'}{['maintenance', 'note'].includes(entry.kind) ? '' : ' (optional)'}</Label><Input id="log-note" maxLength={1000} placeholder={entry.kind === 'maintenance' ? 'Oil change, new cutting edge' : ''} value={entry.note} onChange={(e) => setEntry({ ...entry, note: e.target.value })} data-testid="log-note" /></div>
          </div>
          {entryProblem && (entry.gallons || entry.hours || entry.note || entry.cost) ? <p className="mt-2 text-sm text-danger" data-testid="log-problem">{entryProblem}</p> : null}
          <Button className="mt-2" data-write disabled={busy || Boolean(entryProblem)} data-testid="log-add" onClick={async () => {
            const ok = await run(() => api('/api/equipment-log', { body: {
              truck_id: picked, kind: entry.kind, storm_id: entry.storm_id || null, note: entry.note.trim() || null,
              gallons: entry.kind === 'fuel' ? Number(entry.gallons) : null, hours: entry.kind === 'hours' ? Number(entry.hours) : null,
              cost_cents: entry.cost.trim() ? dollarsToCents(entry.cost) : null,
            } }));
            if (ok) setEntry({ ...entry, gallons: '', cost: '', hours: '', note: '' });
          }}>Add to log</Button>
          <section className="mt-4 border-t border-line-faint pt-3" data-testid="reminders">
            <h3 className="font-semibold">Service reminders</h3>
            {reminders.filter((m) => m.truck_id === picked).length ? (
              <ul className="mt-2 divide-y divide-line-faint text-sm">
                {reminders.filter((m) => m.truck_id === picked).map((m) => (
                  <li key={m.id} className="flex flex-wrap items-center gap-2 py-2" data-testid="reminder-row">
                    <Badge tone={m.status.state === 'overdue' ? 'red' : m.status.state === 'soon' ? 'amber' : 'green'}>{m.status.state === 'overdue' ? 'Overdue' : m.status.state === 'soon' ? 'Due soon' : 'OK'}</Badge>
                    <span className="font-medium wrap-anywhere">{m.name}</span>
                    <span className="text-muted">{[m.every_hours ? `every ${m.every_hours} h` : null, m.every_days ? `every ${m.every_days} days` : null].filter(Boolean).join(' or ')}. {m.status.detail}{m.last_done_at ? `. Last done ${when(m.last_done_at)}` : ''}</span>
                    <span className="ml-auto flex gap-1">
                      <Button size="sm" variant="outline" data-write disabled={busy} data-testid="reminder-done" onClick={async () => {
                        if (await ask({ title: `Mark ${m.name} done?`, body: `It starts again from today${m.status.meter != null ? ` and ${m.status.meter} h on the meter` : ''}, and goes in the log.`, confirm: 'Mark done' })) await run(() => api(`/api/maintenance/${m.id}`, { method: 'PATCH', body: { done: true } }));
                      }}>Mark done</Button>
                      <Button size="sm" variant="ghost" data-write disabled={busy} aria-label={`Remove the ${m.name} reminder`} onClick={async () => {
                        if (await ask({ title: `Remove the ${m.name} reminder?`, body: 'Its past services stay in the log.', confirm: 'Remove', danger: true })) await run(() => api(`/api/maintenance/${m.id}`, { method: 'DELETE' }));
                      }}>Remove</Button>
                    </span>
                  </li>
                ))}
              </ul>
            ) : <p className="mt-1 text-sm text-muted">No reminders on this truck. Hours count from its meter readings, or from the storms it ran when there are none.</p>}
            <div className="mt-2 grid gap-2 sm:grid-cols-4" data-write>
              <div className="sm:col-span-2"><Label htmlFor="rem-name">Reminder</Label><Input id="rem-name" maxLength={120} placeholder="Oil change" value={rem.name} onChange={(e) => setRem({ ...rem, name: e.target.value })} data-testid="reminder-name" /></div>
              <div><Label htmlFor="rem-hours">Every (hours)</Label><Input id="rem-hours" type="number" inputMode="decimal" min={1} value={rem.hours} onChange={(e) => setRem({ ...rem, hours: e.target.value })} data-testid="reminder-hours" /></div>
              <div><Label htmlFor="rem-days">or every (days)</Label><Input id="rem-days" type="number" inputMode="numeric" min={1} value={rem.days} onChange={(e) => setRem({ ...rem, days: e.target.value })} data-testid="reminder-days" /></div>
              {rem.hours ? <div className="sm:col-span-2"><Label htmlFor="rem-last">Meter when last done (optional)</Label><Input id="rem-last" type="number" inputMode="decimal" min={0} value={rem.lastHours} onChange={(e) => setRem({ ...rem, lastHours: e.target.value })} data-testid="reminder-last-hours" /></div> : null}
            </div>
            <Button className="mt-2" size="sm" data-write disabled={busy || !rem.name.trim() || !(Number(rem.hours) > 0 || Number(rem.days) > 0)} data-testid="reminder-add" onClick={async () => {
              const ok = await run(() => api('/api/maintenance', { body: {
                truck_id: picked, name: rem.name.trim(),
                every_hours: Number(rem.hours) > 0 ? Number(rem.hours) : null,
                every_days: Number(rem.days) > 0 ? Math.round(Number(rem.days)) : null,
                last_done_hours: rem.hours && rem.lastHours.trim() !== '' ? Number(rem.lastHours) : null,
              } }));
              if (ok) setRem({ name: '', hours: '', days: '', lastHours: '' });
            }}>Add reminder</Button>
          </section>
          {mine.length ? (
            <Table stack className="mt-3">
              <thead><tr><Th>Date</Th><Th>What</Th><Th>Detail</Th><Th><span className="sr-only">Remove</span></Th></tr></thead>
              <tbody>
                {mine.slice(0, 30).map((l) => (
                  <tr key={l.id} data-testid="log-row">
                    <Td>{when(l.at)}</Td>
                    <Td label="What">{LOG_KIND[l.kind] ?? l.kind}{l.storm_id ? <span className="block text-xs text-muted">{storms.find((s) => s.id === l.storm_id)?.name ?? 'Storm'}</span> : null}</Td>
                    <Td label="Detail" className="wrap-anywhere">{[l.gallons != null ? `${l.gallons} gal` : null, l.hours != null ? `${l.hours} h` : null, l.cost_cents != null ? money(l.cost_cents) : null, l.note].filter(Boolean).join(', ')}</Td>
                    <Td><Button size="sm" variant="ghost" data-write disabled={busy} aria-label="Remove this log line" onClick={async () => {
                      if (await ask({ title: 'Remove this log line?', body: 'Use this for a line entered by mistake.', confirm: 'Remove', danger: true })) await run(() => api(`/api/equipment-log/${l.id}`, { method: 'DELETE' }));
                    }}>Remove</Button></Td>
                  </tr>
                ))}
              </tbody>
            </Table>
          ) : null}
        </Card>
      ) : null}
    </div>
  );
}

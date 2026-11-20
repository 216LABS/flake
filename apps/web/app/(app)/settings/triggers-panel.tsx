'use client';

import { Badge, Button, Card, Input, Label, Table, Td, Th } from '@flake/ui';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { entityLink } from '@/components/links';
import { api } from '@/lib/client';
import type { TriggerRow } from '@/lib/triggers';

const WORD: Record<string, string> = { plow: 'Plow', salt: 'Salt', walks: 'Walks', haul: 'Haul' };

/**
 * Snow triggers (issue 198): every lot's area, trigger and today's forecast against it in one table, the company's
 * default trigger, and each lot's service area, which decides which alert it goes on.
 */
export function TriggersPanel({ rows, defaultIn, owner, canEdit }: { rows: TriggerRow[]; defaultIn: number; owner: boolean; canEdit: boolean }) {
  const router = useRouter();
  const [def, setDef] = useState(String(defaultIn));
  const [msg, setMsg] = useState<string | null>(null);
  const areas = [...new Set(rows.map((r) => r.area))].sort();
  return (
    <div className="space-y-4">
      <Card className="max-w-2xl">
        <h2 className="font-semibold">How snow triggers work</h2>
        <p className="mt-1 text-sm text-ink-2">Each lot has a trigger depth from its signed contract. Flake checks each lot&apos;s own forecast every 15 to 60 minutes. When lots in an area reach their trigger, that area gets its own alert, so Lakewood and Akron are alerted apart. Nothing goes to drivers until you press Start storm. A lot with no signed contract never triggers.</p>
        {owner ? (
          <div className="mt-3 flex flex-wrap items-end gap-2">
            <div><Label htmlFor="default-trigger">Default trigger for new quotes (in)</Label><Input id="default-trigger" type="number" step="0.5" min="0" max="48" className="w-28" value={def} onChange={(e) => setDef(e.target.value)} data-testid="default-trigger" /></div>
            <Button variant="outline" data-testid="default-trigger-save" onClick={async () => {
              setMsg(null);
              try {
                await api('/api/settings/triggers', { method: 'PUT', body: { inches: Number(def) } });
                setMsg('Saved. New quotes start with this.');
              } catch (e) {
                setMsg((e as Error).message);
              }
            }}>Save</Button>
            {msg ? <span className="text-sm text-muted" role="status" data-testid="default-trigger-msg">{msg}</span> : null}
          </div>
        ) : null}
      </Card>
      <datalist id="area-names">{areas.map((a) => <option key={a} value={a} />)}</datalist>
      <Table stack data-testid="triggers-table">
        <thead><tr><Th>Lot</Th><Th>Area</Th><Th>Trigger</Th><Th>Services</Th><Th>Forecast, next 12 h</Th></tr></thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.id} data-testid="trigger-row">
              <Td className="wrap-anywhere"><Link className={entityLink} href={`/sites/${r.id}`}>{r.label}</Link><span className="block text-xs text-muted">{r.address}</span></Td>
              <Td label="Area">
                {canEdit ? <Input aria-label={`Service area for ${r.label}`} list="area-names" defaultValue={r.area} className="h-9 w-40" data-testid="trigger-area" onBlur={async (e) => {
                  if (e.target.value.trim() === r.area) return;
                  await api('/api/settings/triggers', { method: 'PATCH', body: { site_id: r.id, area: e.target.value.trim() } });
                  router.refresh();
                }} /> : r.area}
              </Td>
              <Td label="Trigger">{r.contract === 'signed' ? (r.trigger_in !== null ? `${r.trigger_in}"` : 'Salt only') : <Badge tone="amber">{r.contract === 'waiting' ? 'Quote not signed: never triggers' : 'No contract: never triggers'}</Badge>}</Td>
              <Td label="Services">{r.services.length ? r.services.map((s) => WORD[s] ?? s).join(', ') : '-'}</Td>
              <Td label="Forecast">
                {r.forecast_in === null ? <span className="text-muted">No forecast yet</span> : (
                  <span>
                    {r.forecast_in}&quot;{r.trigger_in !== null ? ` of ${r.trigger_in}"` : ''}
                    {r.trigger_in !== null && r.contract === 'signed' && r.forecast_in >= r.trigger_in ? <span className="ml-1 font-semibold text-warn-ink" data-testid="will-trigger">will trigger</span> : null}
                  </span>
                )}
              </Td>
            </tr>
          ))}
        </tbody>
      </Table>
    </div>
  );
}

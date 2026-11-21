'use client';

import type { SaltTrigger } from '@flake/core/trigger';
import { Badge, Button, Card, Input, Label, Select, Table, Td, Th } from '@flake/ui';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { entityLink } from '@/components/links';
import { api } from '@/lib/client';
import type { TriggerRow } from '@/lib/triggers';

const WORD: Record<string, string> = { plow: 'Plow', salt: 'Salt', walks: 'Walks', haul: 'Haul' };

/** Salt run rules people pick from (issue 204). Anything else saved shows as its own words. */
const PRESETS: { id: string; label: string; rule: SaltTrigger }[] = [
  { id: 'any', label: 'Any snow, ice or refreeze', rule: { snow_in: 0, ice: true, refreeze: true } },
  { id: 'half', label: '0.5" of snow or more, ice or refreeze', rule: { snow_in: 0.5, ice: true, refreeze: true } },
  { id: 'one', label: '1" of snow or more, ice or refreeze', rule: { snow_in: 1, ice: true, refreeze: true } },
  { id: 'ice', label: 'Ice and refreeze only', rule: { snow_in: null, ice: true, refreeze: true } },
  { id: 'off', label: 'Never on its own (only with plowing)', rule: { snow_in: null, ice: false, refreeze: false } },
];
const presetOf = (r: SaltTrigger) => PRESETS.find((p) => p.rule.snow_in === r.snow_in && p.rule.ice === r.ice && p.rule.refreeze === r.refreeze);
const ruleText = (r: SaltTrigger) => presetOf(r)?.label ?? [r.snow_in === null ? null : `${r.snow_in}" of snow or more`, r.ice ? 'ice' : null, r.refreeze ? 'refreeze' : null].filter(Boolean).join(', ');

/**
 * Snow triggers (issue 198) and salt runs (issue 204): every lot's area, plow trigger, salt run rule and what today's
 * forecast means for it, the company's defaults, and each lot's service area, which decides which alert it goes on.
 */
export function TriggersPanel({ rows, defaultIn, saltDefault, owner, canEdit }: { rows: TriggerRow[]; defaultIn: number; saltDefault: SaltTrigger; owner: boolean; canEdit: boolean }) {
  const router = useRouter();
  const [def, setDef] = useState(String(defaultIn));
  const [saltDef, setSaltDef] = useState(presetOf(saltDefault)?.id ?? 'any');
  const [msg, setMsg] = useState<string | null>(null);
  const [saltMsg, setSaltMsg] = useState<string | null>(null);
  const areas = [...new Set(rows.map((r) => r.area))].sort();
  return (
    <div className="space-y-4">
      <Card className="max-w-2xl">
        <h2 className="font-semibold">How triggers work</h2>
        <p className="mt-1 text-sm text-ink-2">Each lot&apos;s plow trigger is the snow depth in its signed contract. Lots with salt in their contract also get <strong>salt runs</strong>: for snow under the plow trigger, freezing rain, or melt that refreezes. Flake checks each lot&apos;s own forecast every 15 to 60 minutes, and each area gets its own alerts, so Cleveland can get a plow alert while Akron gets a salt run. Nothing goes to drivers until you press Start storm. A lot with no signed contract never triggers.</p>
        <p className="mt-2 text-sm text-ink-2">Alerts say how sure the forecast is, from the National Blend of Models: <strong>certain</strong> when 9 in 10 model outcomes reach the trigger, <strong>likely</strong> when half do, <strong>possible</strong> when fewer do. During a storm the hourly HRRR model and radar refine the next few hours.</p>
        {owner ? (
          <div className="mt-3 space-y-3">
            <div className="flex flex-wrap items-end gap-2">
              <div><Label htmlFor="default-trigger">Default plow trigger for new quotes (in)</Label><Input id="default-trigger" type="number" step="0.5" min="0" max="48" className="w-28" value={def} onChange={(e) => setDef(e.target.value)} data-testid="default-trigger" /></div>
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
            <div className="flex flex-wrap items-end gap-2">
              <div className="min-w-0 flex-1 sm:flex-none"><Label htmlFor="salt-default">Salt runs for salt lots</Label>
                <Select id="salt-default" className="w-full sm:w-80" value={saltDef} onChange={(e) => setSaltDef(e.target.value)} data-testid="salt-default">
                  {PRESETS.map((p) => <option key={p.id} value={p.id}>{p.label}</option>)}
                </Select>
              </div>
              <Button variant="outline" data-testid="salt-default-save" onClick={async () => {
                setSaltMsg(null);
                try {
                  await api('/api/settings/triggers', { method: 'PUT', body: { salt: PRESETS.find((p) => p.id === saltDef)!.rule } });
                  setSaltMsg('Saved. Lots without their own rule use this.');
                  router.refresh();
                } catch (e) {
                  setSaltMsg((e as Error).message);
                }
              }}>Save</Button>
              {saltMsg ? <span className="text-sm text-muted" role="status" data-testid="salt-default-msg">{saltMsg}</span> : null}
            </div>
            <p className="text-xs text-muted">Refreeze uses the forecast air temperature: snow on the ground that melts above 32°F and freezes again. Pavement temperature isn&apos;t in any free forecast.</p>
          </div>
        ) : null}
      </Card>
      <datalist id="area-names">{areas.map((a) => <option key={a} value={a} />)}</datalist>
      <Table stack data-testid="triggers-table">
        <thead><tr><Th>Lot</Th><Th>Area</Th><Th>Plow trigger</Th><Th>Salt runs</Th><Th>Services</Th><Th>Now, next 12 h</Th></tr></thead>
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
              <Td label="Plow trigger">{r.contract === 'signed' ? (r.trigger_in !== null ? `${r.trigger_in}"` : 'Salt only') : <Badge tone="amber">{r.contract === 'waiting' ? 'Quote not signed: never triggers' : 'No contract: never triggers'}</Badge>}</Td>
              <Td label="Salt runs">
                {!r.has_salt ? <span className="text-muted">No salt in contract</span> : canEdit ? (
                  <Select aria-label={`Salt runs for ${r.label}`} className="h-9 w-full min-w-0 sm:w-56" value={r.salt_custom ? presetOf(r.salt_rule)?.id ?? 'custom' : 'default'} data-testid="trigger-salt" onChange={async (e) => {
                    const v = e.target.value;
                    if (v === 'custom') return;
                    await api('/api/settings/triggers', { method: 'PATCH', body: { site_id: r.id, salt: v === 'default' ? null : PRESETS.find((p) => p.id === v)!.rule } });
                    router.refresh();
                  }}>
                    <option value="default">Company default ({ruleText(saltDefault)})</option>
                    {PRESETS.map((p) => <option key={p.id} value={p.id}>{p.label}</option>)}
                    {r.salt_custom && !presetOf(r.salt_rule) ? <option value="custom">{ruleText(r.salt_rule)}</option> : null}
                  </Select>
                ) : ruleText(r.salt_rule)}
              </Td>
              <Td label="Services">{r.services.length ? r.services.map((s) => WORD[s] ?? s).join(', ') : '-'}</Td>
              <Td label="Now" className="sm:min-w-44">
                {r.forecast_in === null ? <span className="text-muted">No forecast yet</span> : (
                  <span>
                    <span className="block sm:whitespace-nowrap">{r.forecast_in}&quot; forecast{r.trigger_in !== null ? ` of ${r.trigger_in}"` : ''}</span>
                    {r.range_in ? <span className="block text-xs text-muted">Models: {r.range_in[0]} to {r.range_in[1]}&quot;</span> : null}
                    {r.contract === 'signed' ? (
                      <span className={r.now.plow || r.now.salt ? 'font-semibold text-warn-ink' : 'text-muted'} data-testid={r.now.plow ? 'will-trigger' : r.now.salt ? 'will-salt' : 'no-trigger'}>{r.now.text}</span>
                    ) : null}
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

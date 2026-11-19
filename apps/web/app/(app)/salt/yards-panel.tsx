'use client';

import { Badge, Button, Card, Input, Label, Select } from '@flake/ui';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { useConfirm } from '@/components/confirm';
import { api, dollarsToCents, money } from '@/lib/client';

interface Line { id: string; qty_tons: number; cost_cents: number | null; source: string; supplier: string | null; note: string | null; at: string }
interface Yard { yard: { id: string; name: string; address: string | null; reorder_tons: number | null }; tons: number; since: string | null; low: boolean; costPerTon: number | null; entries: Line[] }

const SOURCE: Record<string, string> = { order: 'Salt order', delivery: 'Delivery', adjustment: 'Adjustment', count: 'Count' };

export function YardsPanel({ yards, tz, readOnly }: { yards: Yard[]; tz: string; readOnly: boolean }) {
  const router = useRouter();
  const [ask, dialog] = useConfirm();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [forms, setForms] = useState<Record<string, { source: string; tons: string; cost: string; supplier: string; note: string }>>({});
  const [reorder, setReorder] = useState<Record<string, string>>(Object.fromEntries(yards.map((y) => [y.yard.id, y.yard.reorder_tons == null ? '' : String(y.yard.reorder_tons)])));
  const [add, setAdd] = useState({ name: '', address: '' });
  const blank = { source: 'delivery', tons: '', cost: '', supplier: '', note: '' };
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
  return (
    <div className="max-w-5xl space-y-4">
      {dialog}
      {error ? <p className="text-sm text-danger" role="alert" data-testid="yards-error">{error}</p> : null}
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        {yards.map((y) => {
          const f = forms[y.yard.id] ?? blank;
          const set = (v: Partial<typeof f>) => setForms({ ...forms, [y.yard.id]: { ...f, ...v } });
          return (
            <Card key={y.yard.id} data-testid="yard-card">
              <div className="flex flex-wrap items-baseline justify-between gap-2">
                <h2 className="font-semibold wrap-anywhere">{y.yard.name}</h2>
                {y.low ? <Badge tone="red" data-testid="yard-low">Reorder</Badge> : null}
              </div>
              {y.yard.address ? <p className="text-sm text-muted wrap-anywhere">{y.yard.address}</p> : null}
              <p className="mt-2 text-2xl font-semibold tabular" data-testid="yard-tons">{y.tons} tons</p>
              <p className="text-xs text-muted">{y.since ? `Counted ${when(y.since)}, then deliveries and use since.` : 'No count yet: deliveries less use.'}{y.costPerTon != null ? ` Average cost ${money(y.costPerTon)} a ton.` : ''}</p>
              {!readOnly ? (
                <>
                  <div className="mt-3 flex flex-wrap items-end gap-2">
                    <div><Label htmlFor={`ro-${y.yard.id}`}>Reorder at (tons)</Label><Input id={`ro-${y.yard.id}`} type="number" inputMode="decimal" min={0} className="w-28" value={reorder[y.yard.id] ?? ''} onChange={(e) => setReorder({ ...reorder, [y.yard.id]: e.target.value })} data-testid="yard-reorder" /></div>
                    <Button size="sm" variant="outline" disabled={busy} data-testid="yard-reorder-save" onClick={() => run(() => api(`/api/yards/${y.yard.id}`, { method: 'PATCH', body: { reorder_tons: reorder[y.yard.id] === '' ? null : Number(reorder[y.yard.id]) } }))}>Save</Button>
                  </div>
                  <div className="mt-3 grid gap-2 border-t border-line-faint pt-3 sm:grid-cols-2">
                    <div><Label htmlFor={`src-${y.yard.id}`}>Add</Label><Select id={`src-${y.yard.id}`} value={f.source} onChange={(e) => set({ source: e.target.value })} data-testid="yard-source"><option value="delivery">A delivery</option><option value="count">A count of the pile</option><option value="adjustment">An adjustment (spill, shrink)</option></Select></div>
                    <div><Label htmlFor={`t-${y.yard.id}`}>{f.source === 'count' ? 'Tons in the pile now' : f.source === 'adjustment' ? 'Tons (minus for out)' : 'Tons delivered'}</Label><Input id={`t-${y.yard.id}`} type="number" inputMode="decimal" step="0.1" value={f.tons} onChange={(e) => set({ tons: e.target.value })} data-testid="yard-tons-input" /></div>
                    {f.source === 'delivery' ? <>
                      <div><Label htmlFor={`c-${y.yard.id}`}>What it cost, total ($)</Label><Input id={`c-${y.yard.id}`} type="number" inputMode="decimal" min={0} step="0.01" value={f.cost} onChange={(e) => set({ cost: e.target.value })} data-testid="yard-cost" /></div>
                      <div><Label htmlFor={`s-${y.yard.id}`}>From (optional)</Label><Input id={`s-${y.yard.id}`} maxLength={200} value={f.supplier} onChange={(e) => set({ supplier: e.target.value })} /></div>
                    </> : null}
                    <div className="sm:col-span-2"><Label htmlFor={`n-${y.yard.id}`}>Note{f.source === 'adjustment' ? '' : ' (optional)'}</Label><Input id={`n-${y.yard.id}`} maxLength={500} value={f.note} onChange={(e) => set({ note: e.target.value })} data-testid="yard-note" /></div>
                  </div>
                  <Button className="mt-2" size="sm" disabled={busy || f.tons.trim() === ''} data-testid="yard-add-line" onClick={async () => {
                    const ok = await run(() => api(`/api/yards/${y.yard.id}`, { body: { source: f.source, tons: Number(f.tons), ...(f.source === 'delivery' && f.cost ? { cost_cents: dollarsToCents(f.cost) } : {}), ...(f.supplier ? { supplier: f.supplier } : {}), ...(f.note ? { note: f.note } : {}) } }));
                    if (ok) setForms({ ...forms, [y.yard.id]: blank });
                  }}>Add</Button>
                </>
              ) : null}
              {y.entries.length ? (
                <details className="mt-3 text-sm">
                  <summary className="cursor-pointer text-link">Ledger ({y.entries.length})</summary>
                  <ul className="mt-1 divide-y divide-line-faint">
                    {y.entries.map((l) => (
                      <li key={l.id} className="flex flex-wrap items-center gap-2 py-1" data-testid="yard-line">
                        <span className="tabular">{when(l.at)}</span><span>{SOURCE[l.source] ?? l.source}</span>
                        <span className="tabular">{l.source === 'count' ? `${Number(l.qty_tons)} t on hand` : `${Number(l.qty_tons) > 0 ? '+' : ''}${Number(l.qty_tons)} t`}</span>
                        {l.cost_cents != null ? <span className="text-muted">{money(l.cost_cents)}</span> : null}
                        {l.supplier || l.note ? <span className="text-muted wrap-anywhere">{[l.supplier, l.note].filter(Boolean).join(', ')}</span> : null}
                        {!readOnly && l.source !== 'order' ? <Button size="sm" variant="ghost" className="ml-auto" disabled={busy} aria-label="Remove this line" onClick={async () => {
                          if (await ask({ title: 'Remove this line?', body: 'For a line entered by mistake.', confirm: 'Remove', danger: true })) await run(() => api(`/api/yards/${y.yard.id}?line=${l.id}`, { method: 'DELETE' }));
                        }}>Remove</Button> : null}
                      </li>
                    ))}
                  </ul>
                </details>
              ) : null}
              {!readOnly && yards.length > 1 ? <Button size="sm" variant="ghost" className="mt-2" disabled={busy} onClick={async () => {
                if (await ask({ title: `Retire ${y.yard.name}?`, body: 'It leaves this list. Its ledger stays on file.', confirm: 'Retire', danger: true })) await run(() => api(`/api/yards/${y.yard.id}`, { method: 'PATCH', body: { active: false } }));
              }}>Retire yard</Button> : null}
            </Card>
          );
        })}
      </div>
      {!readOnly ? (
        <Card className="max-w-md">
          <h2 className="font-semibold">Another yard</h2>
          <div className="mt-2 grid gap-2">
            <div><Label htmlFor="ny-name">Name</Label><Input id="ny-name" maxLength={120} placeholder="West side lot" value={add.name} onChange={(e) => setAdd({ ...add, name: e.target.value })} data-testid="yard-new-name" /></div>
            <div><Label htmlFor="ny-addr">Address (optional)</Label><Input id="ny-addr" maxLength={300} value={add.address} onChange={(e) => setAdd({ ...add, address: e.target.value })} /></div>
          </div>
          <Button className="mt-2" size="sm" disabled={busy || !add.name.trim()} data-testid="yard-new-add" onClick={async () => {
            if (await run(() => api('/api/yards', { body: { name: add.name.trim(), ...(add.address.trim() ? { address: add.address.trim() } : {}) } }))) setAdd({ name: '', address: '' });
          }}>Add yard</Button>
        </Card>
      ) : null}
    </div>
  );
}

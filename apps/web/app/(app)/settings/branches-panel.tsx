'use client';

import { Button, Card, Input, Label, Select } from '@flake/ui';
import { useRouter } from 'next/navigation';
import { useMemo, useState } from 'react';
import { api } from '@/lib/client';

interface Branch { id: string; name: string; yard: { address: string } | null; counts: { sites: number; routes: number; crew: number; yards: number } | null }
type Kind = 'site' | 'route' | 'crew' | 'yard';
interface Item { id: string; name: string; sub: string | null; branch_id: string | null }

const KIND_WORD: Record<Kind, string> = { site: 'Lots', route: 'Routes', crew: 'Crew', yard: 'Salt yards' };

/**
 * Settings, Team: branches (issue 227). A one-yard company sees one line offering to add a second yard and nothing
 * else changes for it. Adding the first branch puts everything you have now in "Main".
 */
export function BranchesPanel({ branches, items }: { branches: Branch[]; items: Record<Kind, Item[]> }) {
  const router = useRouter();
  const [name, setName] = useState('');
  const [yard, setYard] = useState('');
  const [msg, setMsg] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [kind, setKind] = useState<Kind>('site');
  const [to, setTo] = useState(branches[0]?.id ?? '');
  const [filter, setFilter] = useState('');
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const run = async (fn: () => Promise<unknown>, ok: string) => {
    setMsg(null);
    setBusy(true);
    try {
      await fn();
      setMsg(ok);
      router.refresh();
    } catch (e) {
      setMsg((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  const shown = useMemo(() => {
    const f = filter.trim().toLowerCase();
    return items[kind].filter((i) => !f || `${i.name} ${i.sub ?? ''}`.toLowerCase().includes(f)).slice(0, 300);
  }, [items, kind, filter]);
  const bname = (id: string | null) => branches.find((b) => b.id === id)?.name ?? 'No branch';
  return (
    <Card className="mt-4" data-testid="branches-panel">
      <h2 className="font-semibold">Branches</h2>
      <p className="mt-1 max-w-2xl text-sm text-muted">
        {branches.length ? 'Each branch has its own yard, lots, routes, crew, salt and storms. A branch manager sees only theirs. Reports and Profit per lot can show one branch.' : 'Run more than one yard? Add a branch for each. Everything you have now goes in "Main", so nothing changes until you move lots, routes and crew to the new one.'}
      </p>
      {branches.length ? (
        <ul className="mt-3 divide-y divide-line-faint rounded-md border border-line-faint text-sm">
          {branches.map((b) => (
            <li key={b.id} className="flex flex-wrap items-center gap-2 p-2" data-testid="branch-row">
              <span className="font-medium">{b.name}</span>
              <span className="text-muted">{b.counts ? `${b.counts.sites} lots, ${b.counts.routes} routes, ${b.counts.crew} crew` : ''}{b.yard ? `. Yard: ${b.yard.address}` : '. No yard address yet'}</span>
              <span className="flex-1" />
              <Button size="sm" variant="ghost" disabled={busy} onClick={() => { const n = prompt('Yard address for this branch', b.yard?.address ?? ''); if (n !== null) void run(() => api(`/api/branches/${b.id}`, { method: 'PATCH', body: { yard_address: n } }), 'Yard saved'); }}>Yard</Button>
              <Button size="sm" variant="ghost" disabled={busy} onClick={() => { const n = prompt('Branch name', b.name); if (n?.trim()) void run(() => api(`/api/branches/${b.id}`, { method: 'PATCH', body: { name: n } }), 'Renamed'); }}>Rename</Button>
              {branches.length > 1 ? <Button size="sm" variant="ghost" disabled={busy} data-testid="branch-archive" onClick={() => void run(() => api(`/api/branches/${b.id}`, { method: 'PATCH', body: { archived: true } }), 'Archived')}>Archive</Button> : null}
            </li>
          ))}
        </ul>
      ) : null}
      <div className="mt-3 flex flex-wrap items-end gap-2">
        <div><Label htmlFor="branch-name">{branches.length ? 'New branch' : 'Second yard name'}</Label><Input id="branch-name" placeholder="West yard" value={name} onChange={(e) => setName(e.target.value)} data-testid="branch-name" /></div>
        <div className="min-w-64 flex-1"><Label htmlFor="branch-yard">Yard address (optional)</Label><Input id="branch-yard" placeholder="1200 Industrial Pkwy, Medina OH" value={yard} onChange={(e) => setYard(e.target.value)} data-testid="branch-yard" /></div>
        <Button disabled={busy || !name.trim()} data-testid="branch-add" onClick={() => void run(async () => { await api('/api/branches', { body: { name, yard_address: yard || null } }); setName(''); setYard(''); }, branches.length ? 'Branch added' : 'Added. Everything you had is now in Main.')}>Add branch</Button>
      </div>
      {branches.length > 1 ? (
        <div className="mt-4 rounded-md border border-line-faint p-3 text-sm" data-testid="branch-move">
          <h3 className="font-medium">Move to a branch</h3>
          <div className="mt-2 flex flex-wrap items-end gap-2">
            <div><Label htmlFor="bm-kind">What</Label><Select id="bm-kind" value={kind} onChange={(e) => { setKind(e.target.value as Kind); setPicked(new Set()); }} data-testid="branch-move-kind">{(Object.keys(KIND_WORD) as Kind[]).map((k) => <option key={k} value={k}>{KIND_WORD[k]}</option>)}</Select></div>
            <div><Label htmlFor="bm-to">To</Label><Select id="bm-to" value={to} onChange={(e) => setTo(e.target.value)} data-testid="branch-move-to">{branches.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}</Select></div>
            <div className="min-w-48 flex-1"><Label htmlFor="bm-find">Find</Label><Input id="bm-find" value={filter} onChange={(e) => setFilter(e.target.value)} placeholder="Name" /></div>
          </div>
          <ul className="mt-2 max-h-64 overflow-y-auto">
            {shown.map((i) => <li key={i.id}><label className="flex items-center gap-2 py-1"><input type="checkbox" className="h-4 w-4" checked={picked.has(i.id)} onChange={(e) => { const n = new Set(picked); if (e.target.checked) n.add(i.id); else n.delete(i.id); setPicked(n); }} data-testid="branch-move-item" />{i.name}{i.sub ? <span className="text-muted"> {i.sub}</span> : null}<span className="ml-auto text-xs text-muted">{bname(i.branch_id)}</span></label></li>)}
          </ul>
          <Button className="mt-2" size="sm" disabled={busy || !picked.size || !to} data-testid="branch-move-save" onClick={() => void run(async () => { await api('/api/branches/assign', { body: { kind, ids: [...picked], branch_id: to } }); setPicked(new Set()); }, `Moved ${picked.size} to ${bname(to)}`)}>Move {picked.size || ''}</Button>
        </div>
      ) : null}
      {msg ? <p className="mt-2 text-sm" role="status" data-testid="branches-msg">{msg}</p> : null}
    </Card>
  );
}

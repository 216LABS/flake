'use client';

import { Button, Card, Input, Label, Select } from '@flake/ui';
import { useRouter } from 'next/navigation';
import { useMemo, useState } from 'react';
import { ButtonA } from '@/components/links';
import { CopyLink } from '@/components/text-it';
import { api, money } from '@/lib/client';

interface Sub { id: string; name: string; contact_name: string | null; phone_e164: string | null; email: string | null; portal_url: string | null; drivers: { id: string; name: string }[]; lots: number }
interface Lot { id: string; label: string; customer: string; sub_company_id: string | null }
interface Driver { id: string; name: string; kind: string; sub_company_id: string | null }
interface Statement { total_cents: number; visits: number; drivers: { crew_id: string; driver: string; visits: number; total_cents: number }[]; answer: { status: string; note: string | null; disputed_line: string | null; responded_at: string } | null }

/**
 * Settings, Crew: sub companies (issue 226). A sub outfit with several drivers, a block of lots it covers, its
 * private portal link, its statement and whether it agreed, the season scorecard, and the insurance block.
 */
export function SubsPanel({ subs, lots, drivers, block, owner, pro }: { subs: Sub[]; lots: Lot[]; drivers: Driver[]; block: boolean; owner: boolean; pro: boolean }) {
  const router = useRouter();
  const [name, setName] = useState('');
  const [msg, setMsg] = useState<string | null>(null);
  const run = async (fn: () => Promise<unknown>, ok?: string) => {
    setMsg(null);
    try {
      await fn();
      if (ok) setMsg(ok);
      router.refresh();
    } catch (e) {
      setMsg((e as Error).message);
    }
  };
  return (
    <Card className="mt-4" data-testid="subs-panel">
      <h2 className="font-semibold">Sub companies</h2>
      <p className="mt-1 max-w-2xl text-sm text-muted">A sub outfit with its own drivers. Its drivers&apos; pay rolls up to one statement, lots you give it go on its own run when you start a storm, and its portal link shows its own visits, photos and pay, never your customers&apos; contacts or prices.</p>
      <div className="mt-3 flex flex-wrap items-end gap-2">
        <div><Label htmlFor="sub-new">New sub company</Label><Input id="sub-new" placeholder="Ridge Plowing LLC" value={name} onChange={(e) => setName(e.target.value)} data-testid="sub-new-name" /></div>
        <Button disabled={!name.trim()} data-testid="sub-add" onClick={() => void run(async () => { await api('/api/subs', { body: { name } }); setName(''); }, 'Added')}>Add</Button>
        <ButtonA variant="outline" href="/api/subs/scorecard.csv" download data-testid="sub-scorecard">Season scorecard (CSV)</ButtonA>
      </div>
      {owner ? (
        <label className="mt-3 flex max-w-2xl items-start gap-2 text-sm">
          <input type="checkbox" className="mt-1 h-4 w-4" defaultChecked={block} data-testid="coi-block" onChange={(e) => void run(() => api('/api/settings/coi-block', { method: 'PUT', body: { on: e.target.checked } }), e.target.checked ? 'Subs without current insurance are now blocked from storm runs.' : 'Back to a warning only.')} />
          <span><span className="font-medium">Block subs with an expired or missing certificate from storm runs.</span> <span className="text-muted">Off, the dashboard warns, as now. On, Start storm, Move to and swapping drivers refuse a sub whose certificate has ended or was never added.</span></span>
        </label>
      ) : block ? <p className="mt-3 text-sm" data-testid="coi-block-on">Subs without current insurance are blocked from storm runs.</p> : null}
      {msg ? <p className="mt-2 text-sm" role="status" data-testid="subs-msg">{msg}</p> : null}
      <ul className="mt-4 space-y-3">
        {subs.map((s) => <SubRow key={s.id} sub={s} lots={lots} drivers={drivers} pro={pro} run={run} />)}
      </ul>
    </Card>
  );
}

function SubRow({ sub, lots, drivers, pro, run }: { sub: Sub; lots: Lot[]; drivers: Driver[]; pro: boolean; run: (fn: () => Promise<unknown>, ok?: string) => Promise<void> }) {
  const [pickDriver, setPickDriver] = useState('');
  const [giving, setGiving] = useState(false);
  const [filter, setFilter] = useState('');
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [st, setSt] = useState<Statement | null>(null);
  const [range, setRange] = useState({ from: '', to: '' });
  const mineLots = lots.filter((l) => l.sub_company_id === sub.id);
  const shown = useMemo(() => {
    const f = filter.trim().toLowerCase();
    return lots.filter((l) => l.sub_company_id !== sub.id && (!f || `${l.label} ${l.customer}`.toLowerCase().includes(f))).slice(0, 200);
  }, [lots, filter, sub.id]);
  return (
    <li className="rounded-md border border-line p-3 text-sm" data-testid="sub-row">
      <div className="flex flex-wrap items-center gap-2">
        <span className="font-semibold">{sub.name}</span>
        <span className="text-muted">{sub.drivers.length} driver{sub.drivers.length === 1 ? '' : 's'}, {sub.lots} lot{sub.lots === 1 ? '' : 's'}</span>
        <span className="flex-1" />
        <Button size="sm" variant="ghost" data-testid="sub-archive" onClick={() => { if (confirm(`Archive ${sub.name}? Its lots go back to your routes and its portal link stops working.`)) void run(() => api(`/api/subs/${sub.id}`, { method: 'PATCH', body: { archived: true } }), 'Archived'); }}>Archive</Button>
      </div>
      <p className="mt-1">Drivers: {sub.drivers.length ? sub.drivers.map((d) => d.name).join(', ') : 'none yet'}.</p>
      <div className="mt-1 flex flex-wrap items-end gap-2">
        <Select aria-label={`Add a driver to ${sub.name}`} className="w-56" value={pickDriver} onChange={(e) => setPickDriver(e.target.value)} data-testid="sub-driver-pick">
          <option value="">Add a driver...</option>
          {drivers.filter((d) => d.sub_company_id !== sub.id).map((d) => <option key={d.id} value={d.id}>{d.name}{d.kind === 'employee' ? ' (employee, becomes a sub)' : ''}</option>)}
        </Select>
        <Button size="sm" variant="outline" disabled={!pickDriver} data-testid="sub-driver-add" onClick={() => void run(async () => { await api('/api/subs/driver', { body: { crew_id: pickDriver, sub_company_id: sub.id } }); setPickDriver(''); }, 'Driver added')}>Add driver</Button>
        {sub.drivers.length ? <Select aria-label={`Take a driver off ${sub.name}`} className="w-48" value="" onChange={(e) => e.target.value && void run(() => api('/api/subs/driver', { body: { crew_id: e.target.value, sub_company_id: null } }), 'Driver taken off')} data-testid="sub-driver-remove"><option value="">Take a driver off...</option>{sub.drivers.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}</Select> : null}
      </div>
      <div className="mt-2">
        {mineLots.length ? <p className="text-xs text-muted">Lots: {mineLots.slice(0, 8).map((l) => l.label).join(', ')}{mineLots.length > 8 ? ` and ${mineLots.length - 8} more` : ''}.</p> : null}
        {giving ? (
          <div className="mt-2 rounded-md border border-line-faint p-2" data-testid="sub-give">
            <Input placeholder="Find a lot or customer" value={filter} onChange={(e) => setFilter(e.target.value)} data-testid="sub-give-filter" />
            <ul className="mt-2 max-h-56 overflow-y-auto">
              {shown.map((l) => (
                <li key={l.id}><label className="flex items-center gap-2 py-1"><input type="checkbox" className="h-4 w-4" checked={picked.has(l.id)} onChange={(e) => { const n = new Set(picked); if (e.target.checked) n.add(l.id); else n.delete(l.id); setPicked(n); }} />{l.label} <span className="text-muted">{l.customer}{l.sub_company_id ? ', with another sub' : ''}</span></label></li>
              ))}
            </ul>
            <div className="mt-2 flex gap-2">
              <Button size="sm" disabled={!picked.size} data-testid="sub-give-save" onClick={() => void run(async () => { await api('/api/subs/assign', { body: { site_ids: [...picked], sub_company_id: sub.id } }); setPicked(new Set()); setGiving(false); }, `${picked.size} lot${picked.size === 1 ? '' : 's'} given to ${sub.name}`)}>Give {picked.size || ''} lot{picked.size === 1 ? '' : 's'}</Button>
              <Button size="sm" variant="ghost" onClick={() => setGiving(false)}>Cancel</Button>
            </div>
          </div>
        ) : (
          <div className="mt-1 flex flex-wrap gap-2">
            <Button size="sm" variant="outline" data-testid="sub-give-open" onClick={() => setGiving(true)}>Give lots</Button>
            {mineLots.length ? <Button size="sm" variant="ghost" data-testid="sub-take-back" onClick={() => void run(() => api('/api/subs/assign', { body: { site_ids: mineLots.map((l) => l.id), sub_company_id: null } }), 'Lots back on your routes')}>Take its lots back</Button> : null}
          </div>
        )}
      </div>
      <div className="mt-2 flex flex-wrap items-center gap-2">
        {sub.portal_url ? <><span className="text-xs text-muted">Portal link:</span><CopyLink url={sub.portal_url} testId="sub-portal-copy" /></> : null}
        <Button size="sm" variant="ghost" data-testid="sub-portal-new" onClick={() => void run(() => api(`/api/subs/${sub.id}/portal`, { method: 'POST' }), sub.portal_url ? 'New link made; the old one no longer works.' : 'Portal link made. Copy it and text it to the sub.')}>{sub.portal_url ? 'New link' : 'Make a portal link'}</Button>
      </div>
      {pro ? (
        <div className="mt-2 flex flex-wrap items-end gap-2">
          <div><Label htmlFor={`st-from-${sub.id}`}>Statement from</Label><Input id={`st-from-${sub.id}`} type="date" value={range.from} onChange={(e) => setRange({ ...range, from: e.target.value })} /></div>
          <div><Label htmlFor={`st-to-${sub.id}`}>To</Label><Input id={`st-to-${sub.id}`} type="date" value={range.to} onChange={(e) => setRange({ ...range, to: e.target.value })} /></div>
          <Button size="sm" variant="outline" data-testid="sub-statement-open" onClick={() => void run(async () => setSt(await api<Statement>(`/api/subs/${sub.id}/statement?from=${range.from}&to=${range.to}`)))}>Show statement</Button>
        </div>
      ) : null}
      {st ? (
        <div className="mt-2 rounded-md bg-tint p-2" data-testid="sub-statement">
          <p>{st.drivers.map((d) => `${d.driver} ${money(d.total_cents)}`).join(', ') || 'No paid work'}. <span className="font-semibold">Total {money(st.total_cents)}</span> for {st.visits} visit{st.visits === 1 ? '' : 's'}.</p>
          <p className="text-xs" data-testid="sub-statement-answer">{st.answer ? (st.answer.status === 'acknowledged' ? 'The sub said this looks right.' : `The sub disputed ${st.answer.disputed_line ? `"${st.answer.disputed_line}"` : 'a line'}: ${st.answer.note ?? ''}`) : 'The sub hasn’t answered for these dates yet.'}</p>
        </div>
      ) : null}
    </li>
  );
}

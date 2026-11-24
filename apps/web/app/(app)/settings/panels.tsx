'use client';

import { FREE_SITE_LIMIT, seasonLabel } from '@flake/core/fees';
import { longDate } from '@/lib/legal';
import type { RateCard } from '@flake/core/quote';
import { Badge, Button, Card, Input, Label, Select, Table, Td, Textarea, Th } from '@flake/ui';
import { ButtonA, ButtonLink } from '@/components/links';
import { useRouter } from 'next/navigation';
import QRCode from 'qrcode';
import { useEffect, useState } from 'react';
import { api, dollarsToCents, money, phone } from '@/lib/client';
import { useConfirm } from '@/components/confirm';
import { rateCardProblem, tierProblem } from '@/lib/limits';

function useAction() {
  const [msg, setMsg] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const run = async (fn: () => Promise<unknown>, ok = 'Saved') => {
    setBusy(true);
    setMsg(null);
    try {
      await fn();
      setMsg(ok);
    } catch (e) {
      setMsg((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  return { msg, busy, run };
}

export function RateCardForm({ card }: { card: RateCard }) {
  // Kept as typed, so "-1" stays "-1" and is caught here instead of being turned into something else.
  const [f, setF] = useState({ rate: String(card.per_sqft_cents_per_push), min: String(card.min_push_cents / 100), walk: String(card.walks_per_lf_cents), salt: String(card.salt_bag_cents / 100), pushes: String(card.season_pushes) });
  // The depth tiers are the owner's too (issue 153): 2", 6", 12" and above is as common as 4", 8" and above.
  const [tiers, setTiers] = useState(() => card.tiers.map((t) => ({ depth: t.up_to_in === null ? '' : String(t.up_to_in), mult: String(t.multiplier) })));
  const { msg, busy, run } = useAction();
  const [shown, setShown] = useState(false);
  const problem = rateCardProblem(f) ?? tierProblem(tiers);
  const setTier = (i: number, patch: Partial<{ depth: string; mult: string }>) => { setShown(false); setTiers(tiers.map((t, k) => (k === i ? { ...t, ...patch } : t))); };
  const field = (key: keyof typeof f, label: string, attrs: { step?: string; min: number; max: number }, testId?: string) => (
    <div><Label htmlFor={`rc-${key}`}>{label}</Label><Input id={`rc-${key}`} type="number" inputMode="decimal" {...attrs} value={f[key]} onChange={(e) => { setShown(false); setF({ ...f, [key]: e.target.value }); }} {...(testId ? { 'data-testid': testId } : {})} /></div>
  );
  return (
    <Card className="max-w-xl">
      <h2 className="font-semibold">Rate card</h2>
      <p className="mt-1 text-sm text-muted">These are your numbers, and they set suggested prices on new quotes. The starting values are placeholders, not market data.</p>
      <div className="mt-3 grid gap-3 sm:grid-cols-2">
        {field('rate', 'Cents per sq ft, per push', { step: '0.01', min: 0, max: 100 }, 'rate-sqft')}
        {field('min', 'Minimum push ($)', { step: '0.01', min: 0, max: 100000 })}
        {field('walk', 'Cents per foot of walk', { step: '0.01', min: 0, max: 1000 })}
        {field('salt', 'Salt per 50 lb bag ($)', { step: '0.01', min: 0, max: 100000 })}
        {field('pushes', 'Pushes per season', { step: '1', min: 1, max: 100 })}
      </div>
      <fieldset className="mt-4" data-testid="rate-tiers">
        <legend className="text-sm font-medium">Depth tiers</legend>
        <p className="text-xs text-muted">A per-inch quote suggests each tier as a multiple of the push price.</p>
        <ul className="mt-2 space-y-2">
          {tiers.map((t, i) => (
            <li key={i} className="flex flex-wrap items-end gap-2" data-testid="rate-tier">
              {i < tiers.length - 1 ? (
                <div><Label htmlFor={`tier-d-${i}`}>Up to (inches)</Label><Input id={`tier-d-${i}`} className="w-24" type="number" inputMode="decimal" step="0.5" min={0.5} max={120} value={t.depth} onChange={(e) => setTier(i, { depth: e.target.value })} data-testid="tier-depth" /></div>
              ) : <div className="w-24 pb-2 text-sm font-medium">Above that</div>}
              <div><Label htmlFor={`tier-m-${i}`}>Times the push price</Label><Input id={`tier-m-${i}`} className="w-24" type="number" inputMode="decimal" step="0.1" min={0.1} max={10} value={t.mult} onChange={(e) => setTier(i, { mult: e.target.value })} data-testid="tier-mult" /></div>
              {i < tiers.length - 1 && tiers.length > 2 ? <Button type="button" size="sm" variant="ghost" aria-label={`Remove tier ${i + 1}`} onClick={() => { setShown(false); setTiers(tiers.filter((_, k) => k !== i)); }}>Remove</Button> : null}
            </li>
          ))}
        </ul>
        {tiers.length < 8 ? <Button type="button" size="sm" variant="outline" className="mt-2" data-testid="tier-add" onClick={() => {
          setShown(false);
          const before = tiers.slice(0, -1);
          const deepest = Number(before.at(-1)?.depth || 0);
          setTiers([...before, { depth: String(deepest ? deepest + 4 : 4), mult: tiers.at(-1)!.mult }, tiers.at(-1)!]);
        }}>Add a tier</Button> : null}
      </fieldset>
      {problem ? <p className="mt-3 text-sm text-danger" role="alert" data-testid="rate-problem">{problem}</p> : null}
      <div className="mt-4 flex items-center gap-2">
        <Button disabled={busy || Boolean(problem)} data-testid="rate-save" onClick={() => { setShown(true); void run(() => api('/api/settings/rate-card', { method: 'PUT', body: { ...card, per_sqft_cents_per_push: Number(f.rate), min_push_cents: dollarsToCents(f.min), walks_per_lf_cents: Number(f.walk), salt_bag_cents: dollarsToCents(f.salt), season_pushes: Number(f.pushes), tiers: tiers.map((t, i) => ({ up_to_in: i === tiers.length - 1 ? null : Number(t.depth), multiplier: Number(t.mult) })) } })); }}>Save</Button>
        {msg && shown ? <span className={msg === 'Saved' ? 'text-sm font-medium text-ok-ink' : 'text-sm text-danger'} role={msg === 'Saved' ? 'status' : 'alert'} data-testid="rate-msg">{msg}</span> : null}
      </div>
    </Card>
  );
}

export function CrewPanel({ crew, canText = true, cover = {} }: { crew: any[]; canText?: boolean; cover?: Record<string, string> }) {
  const router = useRouter();
  const blank = { name: '', phone_e164: '', email: '', kind: 'employee', language: 'en', per_visit: '', hourly: '', per_storm: '', per_season: '', pay: '', pay_ot: '', pay_storm: '', pay_holiday: '', payroll_id: '' };
  const [f, setF] = useState(blank);
  const [editing, setEditing] = useState<string | null>(null);
  const [invite, setInvite] = useState<string | null>(null);
  const [invitePhone, setInvitePhone] = useState<string | null>(null);
  // A driver standing in the office scans the join link instead of being sent it (issue 211).
  const [inviteQr, setInviteQr] = useState<string | null>(null);
  useEffect(() => {
    let stale = false;
    if (!invite) setInviteQr(null);
    else void QRCode.toDataURL(invite, { margin: 1, width: 240 }).then((q) => { if (!stale) setInviteQr(q); }, () => {});
    return () => { stale = true; };
  }, [invite]);
  const { msg, busy, run } = useAction();
  const [ask, dialog] = useConfirm();
  const load = (c: any) => {
    setEditing(c.id);
    setInvite(null);
    setF({ name: c.name, phone_e164: c.phone_e164 ?? '', email: c.email ?? '', kind: c.kind, language: c.language, per_visit: c.sub_rate_card?.per_visit_cents ? String(c.sub_rate_card.per_visit_cents / 100) : '', hourly: c.sub_rate_card?.hourly_cents ? String(c.sub_rate_card.hourly_cents / 100) : '', per_storm: c.sub_rate_card?.flat_per_storm_cents ? String(c.sub_rate_card.flat_per_storm_cents / 100) : '', per_season: c.sub_rate_card?.flat_per_season_cents ? String(c.sub_rate_card.flat_per_season_cents / 100) : '', pay: c.pay_regular_cents != null ? String(c.pay_regular_cents / 100) : '', pay_ot: c.pay_ot_cents != null ? String(c.pay_ot_cents / 100) : '', pay_storm: c.pay_storm_cents != null ? String(c.pay_storm_cents / 100) : '', pay_holiday: c.pay_holiday_cents != null ? String(c.pay_holiday_cents / 100) : '', payroll_id: c.payroll_id ?? '' });
  };
  const body = () => {
    const { per_visit, hourly, per_storm, per_season, pay, pay_ot, pay_storm, pay_holiday, payroll_id, ...rest } = f;
    const rate = (v: string) => (f.kind === 'employee' && v.trim() ? dollarsToCents(v) : null);
    return { ...rest, kind: f.kind, pay_regular_cents: rate(pay), pay_ot_cents: rate(pay_ot), pay_storm_cents: rate(pay_storm), pay_holiday_cents: rate(pay_holiday), payroll_id: f.kind === 'employee' ? payroll_id : '', sub_rate_card: f.kind === 'sub' ? { ...(per_visit ? { per_visit_cents: dollarsToCents(per_visit) } : {}), ...(hourly ? { hourly_cents: dollarsToCents(hourly) } : {}), ...(per_storm ? { flat_per_storm_cents: dollarsToCents(per_storm) } : {}), ...(per_season ? { flat_per_season_cents: dollarsToCents(per_season) } : {}) } : null };
  };
  return (
    <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
      {dialog}
      <div className="min-w-0 lg:col-span-2">
        {/* A card per person on a phone, with the actions on it, not off the edge (issue 73). */}
        {crew.length ? null : <p className="mb-3 rounded-md border border-line-faint bg-surface p-4 text-sm text-ink-2" data-testid="crew-empty">No drivers yet. Add one with the form here: they get a join link, and route links once a storm starts.</p>}
        {crew.length ? <Table stack data-testid="crew-table">
          <thead><tr><Th>Name</Th><Th>Kind</Th><Th>Contact</Th><Th>Language</Th><Th>Joined</Th><Th><span className="sr-only">Actions</span></Th></tr></thead>
          <tbody>
            {crew.map((c) => (
              <tr key={c.id} className={c.active ? '' : 'bg-tint text-muted'} data-testid="crew-row">
                <Td className="font-medium">{c.name}{c.active ? null : <span className="ml-2 text-xs font-medium">(no longer on the crew)</span>}</Td>
                <Td label="Kind"><div className="flex flex-col items-end gap-1 md:items-start"><Badge className="self-end md:self-start">{c.kind}</Badge>{c.kind === 'sub' && c.active && cover[c.id] && cover[c.id] !== 'covered' ? <span className="flex flex-wrap items-center justify-end gap-1 md:justify-start" data-testid="crew-no-cover"><Badge tone="red">{cover[c.id] === 'missing' ? 'No insurance on file' : cover[c.id] === 'expired' ? 'Insurance ended' : 'Insurance ends soon'}</Badge><ButtonLink size="sm" href="/compliance">Fix insurance</ButtonLink></span> : null}</div></Td>
                <Td label="Contact"><div className="min-w-0"><div className="whitespace-nowrap">{phone(c.phone_e164)}</div><div>{c.email ?? ''}</div></div></Td>
                <Td label="Language">{c.language === 'es' ? 'Español' : 'English'}</Td>
                <Td label="Joined">{c.joined_at ? 'Yes' : 'Invited'}</Td>
                <Td>{c.active ? (
                  <div className="flex flex-wrap gap-0.5 max-md:mt-1">
                    <Button size="sm" variant="ghost" className="px-2" data-testid="crew-edit" onClick={() => load(c)}>Edit</Button>
                    <Button size="sm" variant="ghost" className="px-2" data-testid="crew-reinvite" onClick={() => run(async () => { setInvitePhone(c.phone_e164 ?? null); setInvite((await api(`/api/crew/${c.id}/invite`, { method: 'POST' })).invite_url); }, 'New link ready')}>New link</Button>
                    <Button size="sm" variant="ghost" className="px-2" data-testid="crew-remove" onClick={async () => {
                      if (!(await ask({ title: `Take ${c.name} off the crew?`, body: 'Any route link they have open stops working now. Work they already finished stays on record.', confirm: 'Take off the crew', danger: true }))) return;
                      void run(async () => { await api(`/api/crew/${c.id}`, { method: 'DELETE' }); router.refresh(); }, 'Removed');
                    }}>Remove</Button>
                  </div>
                ) : (
                  <Button size="sm" variant="ghost" className="px-2" data-testid="crew-restore" onClick={() => run(async () => { await api(`/api/crew/${c.id}`, { method: 'PATCH', body: { active: true } }); router.refresh(); }, 'Back on the crew. Send them a new link.')}>Bring back</Button>
                )}</Td>
              </tr>
            ))}
          </tbody>
        </Table> : null}
      </div>
      <Card data-write>
        <h2 className="font-semibold">{editing ? 'Edit crew member' : 'Invite crew'}</h2>
        <p className="mt-1 text-sm text-muted">{editing ? 'Texts stay opt-in. A changed number needs a new opt-in from the invite link.' : 'They choose on the join page whether to get texts.'}</p>
        <div className="mt-2 space-y-2">
          <div><Label htmlFor="crew-name">Name</Label><Input id="crew-name" data-testid="crew-name" value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} /></div>
          <div><Label htmlFor="crew-phone">Mobile</Label><Input id="crew-phone" value={f.phone_e164} onChange={(e) => setF({ ...f, phone_e164: e.target.value })} /></div>
          {!canText ? <p className="text-xs text-warn-ink" data-testid="crew-text-hint">Texting isn&apos;t set up yet, so drivers open their route from the QR code or link on the storm board.</p> : null}
          <div className="grid grid-cols-2 gap-2">
            <div><Label htmlFor="crew-kind">Kind</Label><Select id="crew-kind" value={f.kind} onChange={(e) => setF({ ...f, kind: e.target.value })}><option value="employee">Employee</option><option value="sub">Subcontractor</option></Select></div>
            <div><Label htmlFor="crew-lang">Language</Label><Select id="crew-lang" data-testid="crew-lang" value={f.language} onChange={(e) => setF({ ...f, language: e.target.value })}><option value="en">English</option><option value="es">Spanish</option></Select></div>
          </div>
          {f.kind === 'employee' ? (
            <div className="grid grid-cols-2 gap-2" data-testid="crew-pay">
              <div><Label htmlFor="pay-reg">Pay per hour ($)</Label><Input id="pay-reg" type="number" inputMode="decimal" value={f.pay} onChange={(e) => setF({ ...f, pay: e.target.value })} data-testid="pay-regular" /></div>
              <div><Label htmlFor="pay-ot">Overtime ($, optional)</Label><Input id="pay-ot" type="number" inputMode="decimal" placeholder="1.5x" value={f.pay_ot} onChange={(e) => setF({ ...f, pay_ot: e.target.value })} /></div>
              <div><Label htmlFor="pay-storm">Storm rate ($, optional)</Label><Input id="pay-storm" type="number" inputMode="decimal" value={f.pay_storm} onChange={(e) => setF({ ...f, pay_storm: e.target.value })} /></div>
              <div><Label htmlFor="pay-hol">Holiday rate ($, optional)</Label><Input id="pay-hol" type="number" inputMode="decimal" value={f.pay_holiday} onChange={(e) => setF({ ...f, pay_holiday: e.target.value })} /></div>
              <div className="col-span-2"><Label htmlFor="pay-id">Gusto or ADP employee id (optional)</Label><Input id="pay-id" maxLength={50} value={f.payroll_id} onChange={(e) => setF({ ...f, payroll_id: e.target.value })} /></div>
              <p className="col-span-2 text-xs text-muted">For Reports, Payroll. Only owners and dispatchers see pay.</p>
            </div>
          ) : null}
          {f.kind === 'sub' ? (
            <div className="grid grid-cols-2 gap-2">
              <div><Label htmlFor="sub-visit">Pay per visit ($)</Label><Input id="sub-visit" type="number" value={f.per_visit} onChange={(e) => setF({ ...f, per_visit: e.target.value })} /></div>
              <div><Label htmlFor="sub-hour">Pay per hour ($)</Label><Input id="sub-hour" type="number" value={f.hourly} onChange={(e) => setF({ ...f, hourly: e.target.value })} /></div>
              <div><Label htmlFor="sub-storm">Flat per storm ($)</Label><Input id="sub-storm" type="number" value={f.per_storm} onChange={(e) => setF({ ...f, per_storm: e.target.value })} data-testid="sub-per-storm" /></div>
              <div><Label htmlFor="sub-season">Flat per season ($)</Label><Input id="sub-season" type="number" value={f.per_season} onChange={(e) => setF({ ...f, per_season: e.target.value })} data-testid="sub-per-season" /></div>
              <p className="col-span-2 text-xs text-muted">A season rate is paid in five equal months, November through March, while they&apos;re on the crew.</p>
            </div>
          ) : null}
        </div>
        {editing ? (
          <div className="mt-3 flex gap-2">
            <Button className="flex-1" disabled={busy || !f.name} data-testid="crew-save" onClick={() => run(async () => { await api(`/api/crew/${editing}`, { method: 'PATCH', body: body() }); setEditing(null); setF(blank); router.refresh(); })}>Save</Button>
            <Button variant="ghost" onClick={() => { setEditing(null); setF(blank); }}>Cancel</Button>
          </div>
        ) : (
          <Button className="mt-3 w-full" disabled={busy || !f.name} data-testid="crew-invite" onClick={() => run(async () => {
            const out = await api('/api/crew', { body: body() });
            setInvitePhone(out.phone_e164 ?? null);
            setInvite(out.invite_url);
            setF(blank);
            router.refresh();
          }, 'Invited')}>Invite</Button>
        )}
        {!editing ? <ButtonLink href="/settings/crew-import" className="ml-2 mt-3" data-testid="crew-import-link">Import crew</ButtonLink> : null}
        {msg ? <p className="mt-2 text-sm text-muted" data-testid="crew-msg">{msg}</p> : null}
        {invite ? (
          // The next step after Invite, set apart so it doesn't read as more of the form (journey walk, Nov 23).
          <div className="mt-4 rounded-md border border-ok-line bg-ok-tint p-3" data-testid="invite-result">
            <p className="mb-2 font-semibold text-ok-ink">Invited. Now get them this link.</p>
            <Label>Join link</Label>
            <Input readOnly value={invite} data-testid="invite-url" onFocus={(e) => e.target.select()} />
            {inviteQr ? <img src={inviteQr} alt="QR code for the join link" width={160} height={160} className="mt-2 rounded-sm bg-white p-1" data-testid="invite-qr" /> : null}
            <p className="mt-1 text-xs text-muted">The driver scans this with their phone camera, or you send it from your own phone. They open it, confirm their mobile and say yes to texts.</p>
            <ButtonA size="lg" className="mt-2 w-full sm:w-auto" href={`sms:${invitePhone ?? ''}${typeof navigator !== 'undefined' && /iPhone|iPad/.test(navigator.userAgent) ? '&' : '?'}body=${encodeURIComponent(`Join our snow crew on Flake: ${invite}`)}`} data-testid="invite-sms">Text from my phone</ButtonA>
          </div>
        ) : null}
      </Card>
    </div>
  );
}

const ROLE_OPTIONS: [string, string][] = [['owner', 'Owner'], ['dispatcher', 'Dispatcher'], ['viewer', 'Viewer'], ['billing', 'Billing'], ['field_lead', 'Field lead'], ['branch_manager', 'Branch manager']];
const ROLE_HELP: Record<string, string> = {
  owner: 'Everything, including company settings and plans.',
  dispatcher: 'Storms, routes, customers and billing.',
  viewer: 'Sees everything, changes nothing.',
  billing: 'Billing review, receivables and exports. Can look at storms but not run them.',
  field_lead: 'Runs the storm board. Sees no prices, bills or pay.',
  branch_manager: 'Dispatcher powers for the branches you pick, and nothing outside them.',
};

/** Office team (issue 227 added billing, field lead and branch manager, and limiting someone to branches). */
export function TeamPanel({ members, me, branches = [] }: { members: { user_id: string; email: string | null; role: string; branch_ids?: string[] | null; pending?: boolean }[]; me: string; branches?: { id: string; name: string }[] }) {
  const router = useRouter();
  const [email, setEmail] = useState('');
  const [role, setRole] = useState('dispatcher');
  const [picked, setPicked] = useState<string[]>([]);
  const { msg, busy, run } = useAction();
  const [ask, dialog] = useConfirm();
  // Branch managers need branches; the role only shows once the company has more than one.
  const options = ROLE_OPTIONS.filter(([k]) => k !== 'branch_manager' || branches.length > 1);
  const limitable = (r: string) => branches.length > 1 && (r === 'branch_manager' || r === 'field_lead');
  const branchNames = (ids: string[] | null | undefined) => (ids?.length ? ids.map((id) => branches.find((b) => b.id === id)?.name ?? 'removed branch').join(', ') : null);
  return (
    <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
      {dialog}
      <div className="min-w-0 lg:col-span-2">
        <Table>
          <thead><tr><Th>Email</Th><Th>Role</Th><Th><span className="sr-only">Actions</span></Th></tr></thead>
          <tbody>
            {members.map((m) => (
              <tr key={m.user_id} data-testid="team-row">
                <Td>{m.email}{m.pending ? <Badge tone="amber" className="ml-2" data-testid="team-pending">invited, not signed in yet</Badge> : null}{branchNames(m.branch_ids) ? <span className="block text-xs text-muted" data-testid="team-branches">Only {branchNames(m.branch_ids)}</span> : null}</Td>
                <Td>{m.user_id !== me ? (
                  <Select aria-label={`Role for ${m.email ?? 'this person'}`} className="h-8 w-36 py-0 text-xs" value={m.role} data-testid="team-role-change" disabled={busy} onChange={(e) => {
                    const next = e.target.value;
                    // Becoming a branch manager needs branches: start them on the first, changeable below.
                    const ids = limitable(next) ? (m.branch_ids?.length ? m.branch_ids : next === 'branch_manager' ? [branches[0]!.id] : null) : null;
                    void run(async () => { await api(`/api/settings/team/${m.user_id}`, { method: 'PATCH', body: { role: next, branch_ids: ids } }); router.refresh(); }, 'Role changed');
                  }}>
                    {ROLE_OPTIONS.filter(([k]) => k !== 'branch_manager' || branches.length > 1 || m.role === k).map(([k, label]) => <option key={k} value={k}>{label}</option>)}
                  </Select>
                ) : <Badge>{ROLE_OPTIONS.find(([k]) => k === m.role)?.[1] ?? m.role}</Badge>}
                {m.user_id !== me && limitable(m.role) ? (
                  <details className="mt-1 text-xs"><summary className="cursor-pointer text-muted">Branches</summary>
                    {branches.map((b) => <label key={b.id} className="flex items-center gap-1 py-0.5"><input type="checkbox" checked={!m.branch_ids?.length || m.branch_ids.includes(b.id)} disabled={busy} data-testid="team-branch-toggle" onChange={(e) => {
                      const cur = m.branch_ids?.length ? m.branch_ids : branches.map((x) => x.id);
                      const ids = e.target.checked ? [...new Set([...cur, b.id])] : cur.filter((x) => x !== b.id);
                      void run(async () => { await api(`/api/settings/team/${m.user_id}`, { method: 'PATCH', body: { role: m.role, branch_ids: ids.length === branches.length && m.role !== 'branch_manager' ? null : ids } }); router.refresh(); }, 'Branches changed');
                    }} />{b.name}</label>)}
                  </details>
                ) : null}</Td>
                <Td>{m.user_id !== me ? (
                  <div className="flex flex-wrap gap-1">
                    {m.pending ? <Button size="sm" variant="ghost" data-testid="team-resend" disabled={busy} onClick={() => void run(async () => { await api(`/api/settings/team/${m.user_id}`, { method: 'POST' }); }, `Sent the invite to ${m.email} again.`)}>Resend invite</Button> : null}
                    <Button size="sm" variant="ghost" data-testid="team-remove" onClick={async () => {
                      if (!(await ask({ title: `Remove ${m.email ?? 'this person'}?`, body: 'They lose access to your company right away.', confirm: 'Remove', danger: true }))) return;
                      void run(async () => { await api(`/api/settings/team/${m.user_id}`, { method: 'DELETE' }); router.refresh(); }, 'Removed');
                    }}>Remove</Button>
                  </div>
                ) : <span className="text-xs text-faint">You</span>}</Td>
              </tr>
            ))}
          </tbody>
        </Table>
      </div>
      <Card>
        <h2 className="font-semibold">Add someone to the office</h2>
        <p className="mt-1 text-sm text-muted">Dispatchers run storms and billing. Viewers can only look. They sign in with a code to that email, or connect their work Microsoft or Google account under Account.</p>
        <Label className="mt-3" htmlFor="team-email">Email</Label>
        <Input id="team-email" type="email" data-testid="team-email" value={email} onChange={(e) => setEmail(e.target.value)} />
        <Label className="mt-2" htmlFor="team-role">Role</Label>
        <Select id="team-role" data-testid="team-role" value={role} onChange={(e) => { setRole(e.target.value); setPicked(e.target.value === 'branch_manager' && branches[0] ? [branches[0].id] : []); }}>{[...options.filter(([k]) => k !== 'owner'), ...options.filter(([k]) => k === 'owner')].map(([k, label]) => <option key={k} value={k}>{label}</option>)}</Select>
        <p className="mt-1 text-xs text-muted" data-testid="team-role-help">{ROLE_HELP[role]}</p>
        {limitable(role) ? (
          <fieldset className="mt-2 text-sm"><legend className="font-medium">{role === 'branch_manager' ? 'Their branches' : 'Only these branches (none ticked is all)'}</legend>
            {branches.map((b) => <label key={b.id} className="flex items-center gap-2 py-0.5"><input type="checkbox" checked={picked.includes(b.id)} onChange={(e) => setPicked(e.target.checked ? [...picked, b.id] : picked.filter((x) => x !== b.id))} data-testid="team-add-branch" />{b.name}</label>)}
          </fieldset>
        ) : null}
        <Button className="mt-3 w-full" disabled={busy || !email.includes('@') || (role === 'branch_manager' && !picked.length)} data-testid="team-add" onClick={() => run(async () => { await api('/api/settings/team', { body: { email, role, branch_ids: limitable(role) && picked.length ? picked : null } }); setEmail(''); setPicked([]); router.refresh(); }, 'Added. We emailed them a sign-in link.')}>Add</Button>
        {msg ? <p className="mt-2 text-sm text-muted" data-testid="team-msg">{msg}</p> : null}
      </Card>
    </div>
  );
}

export function PaymentsPanel({ connected, enabled, payInstructions, available = true }: { connected: boolean; enabled: boolean; payInstructions: string | null; available?: boolean }) {
  const { msg, busy, run } = useAction();
  return (
    <div className="max-w-xl space-y-4">
    <PayInstructions saved={payInstructions} />
    <Card>
      <h2 className="font-semibold">Stripe</h2>
      <p className="mt-1 text-sm">Status: <Badge tone={enabled ? 'green' : connected ? 'amber' : 'gray'} data-testid="stripe-status">{enabled ? 'Charges enabled' : connected ? 'Finish onboarding' : 'Not connected'}</Badge></p>
      <p className="mt-2 text-sm text-muted">Payments go straight to your own Stripe account. You pay Stripe&apos;s fees, Stripe handles disputes and losses, and you log in to your own Stripe Dashboard. Flake takes a small application fee on each payment, shown on every billing review. You can skip this and use Flake without online payments.</p>
      {/* Once charges are on there's nothing left to onboard; a dead button there read as broken (QA walk). */}
      {/* No Stripe keys on the platform: say so instead of a button that only errors (issue 175). */}
      {!available && !enabled ? <p className="mt-3 rounded-md bg-tint p-3 text-sm" data-testid="stripe-unavailable">Card and bank payments aren&apos;t available in Flake yet. You can still send bills as PDFs, mark them paid when the check comes, and tell customers how to pay above.</p> : enabled ? <p className="mt-3 text-sm" data-testid="stripe-done">You&apos;re set up. Payouts, refunds and disputes are in your Stripe Dashboard.</p> : <Button className="mt-3" variant="accent" disabled={busy} data-testid="stripe-connect" onClick={() => run(async () => { window.location.href = (await api('/api/settings/stripe', { method: 'POST' })).url; }, 'Opening Stripe...')}>{connected ? 'Continue onboarding' : 'Connect Stripe'}</Button>}
      {msg ? <p className="mt-2 text-sm text-muted">{msg}</p> : null}
    </Card>
    </div>
  );
}

/** What customers see on their records page for a bill the company collects itself: checks to, mail to, Zelle. */
function PayInstructions({ saved }: { saved: string | null }) {
  const { msg, busy, run } = useAction();
  const [text, setText] = useState(saved ?? '');
  const router = useRouter();
  return (
    <Card>
      <h2 className="font-semibold">How customers pay you</h2>
      <p className="mt-1 text-sm text-muted">For bills you collect yourself, by check or bank transfer. Customers see this on their records page, under what they owe.</p>
      <Label className="mt-3" htmlFor="pay-instructions">Payment details</Label>
      <Textarea id="pay-instructions" rows={3} maxLength={500} value={text} onChange={(e) => setText(e.target.value)} placeholder={'Checks to Flip\'s Plowing, 12 Main St, Lakewood OH 44107. Or Zelle to 216-555-0100.'} data-testid="pay-instructions-input" />
      <Button className="mt-3" disabled={busy || text.trim() === (saved ?? '')} data-testid="pay-instructions-save" onClick={() => run(async () => { await api('/api/settings', { method: 'PATCH', body: { pay_instructions: text.trim() } }); router.refresh(); })}>Save</Button>
      {msg ? <p className="mt-2 text-sm text-muted" role="status" data-testid="pay-instructions-msg">{msg}</p> : null}
    </Card>
  );
}

export function SmsSubmit({ status }: { status: string }) {
  const router = useRouter();
  const [ein, setEin] = useState('');
  const { msg, busy, run } = useAction();
  if (status === 'approved') return null;
  return (
    <div className="mt-3">
      <Label htmlFor="ein">EIN (sent to Twilio for verification; we keep only the last 4 digits)</Label>
      <Input id="ein" value={ein} placeholder="12-3456789" onChange={(e) => setEin(e.target.value)} data-testid="ein" />
      <Button className="mt-2" variant="accent" disabled={busy || status === 'pending' || !/^\d{2}-?\d{7}$/.test(ein)} data-testid="sms-submit" onClick={() => run(async () => { await api('/api/settings', { body: { ein } }); router.refresh(); }, 'Submitted')}>{status === 'rejected' ? 'Resubmit' : 'Submit for verification'}</Button>
      {msg ? <p className="mt-2 text-sm text-muted" data-testid="sms-msg">{msg}</p> : null}
    </div>
  );
}

const ZONES = [
  ['America/New_York', 'Eastern'], ['America/Detroit', 'Eastern (Michigan)'], ['America/Indiana/Indianapolis', 'Eastern (Indiana)'], ['America/Chicago', 'Central'],
  ['America/Denver', 'Mountain'], ['America/Boise', 'Mountain (Idaho)'], ['America/Phoenix', 'Arizona'], ['America/Los_Angeles', 'Pacific'], ['America/Anchorage', 'Alaska'],
  ['America/Juneau', 'Alaska (Juneau)'], ['America/Adak', 'Aleutian'], ['Pacific/Honolulu', 'Hawaii'], ['America/Kentucky/Louisville', 'Eastern (Kentucky)'], ['America/Menominee', 'Central (Michigan UP)'],
  ['America/North_Dakota/Center', 'Central (North Dakota)'], ['America/Indiana/Knox', 'Central (Indiana)'], ['America/Puerto_Rico', 'Atlantic (Puerto Rico)'], ['Pacific/Guam', 'Chamorro (Guam)'],
  ['America/Toronto', 'Eastern (Canada)'], ['America/Winnipeg', 'Central (Canada)'], ['America/Regina', 'Saskatchewan'], ['America/Edmonton', 'Mountain (Canada)'], ['America/Vancouver', 'Pacific (Canada)'], ['America/Halifax', 'Atlantic (Canada)'], ['America/St_Johns', 'Newfoundland'],
] as const;

/** What customers and crew see: the name on every message, the office's reply address and phone, and the clock. */
export function CompanyForm({ tenant }: { tenant: any }) {
  const router = useRouter();
  const [f, setF] = useState({ name: tenant.name ?? '', timezone: tenant.timezone ?? 'America/New_York', contact_email: tenant.contact_email ?? '', contact_phone: phone(tenant.contact_phone), yard_address: tenant.yard?.address ?? '',
    // The mailing address every customer email ends with (issue 149), here where every company sees it, not only
    // under Text messages. The toll-free form shares it.
    business_legal_name: tenant.business_legal_name ?? '', line1: tenant.address?.line1 ?? '', city: tenant.address?.city ?? '', state: tenant.address?.state ?? '', zip: tenant.address?.zip ?? '' });
  // Real matches as the owner types, and again when a typed address can't be found (issue 79).
  const [yardHits, setYardHits] = useState<{ label: string; lat: number; lon: number }[]>([]);
  const [yardPoint, setYardPoint] = useState<{ lat: number; lon: number } | null>(null);
  const [yardMissed, setYardMissed] = useState(false);
  useEffect(() => {
    const q = f.yard_address.trim();
    if (yardPoint || q.length < 4 || q === (tenant.yard?.address ?? '')) { setYardHits([]); return; }
    let stale = false;
    const t = setTimeout(() => {
      api<{ hits: { label: string; lat: number; lon: number }[] }>('/api/sites/suggest', { body: { q } }).then((o) => !stale && setYardHits(o.hits), () => undefined);
    }, 300);
    return () => { stale = true; clearTimeout(t); };
  }, [f.yard_address, yardPoint, tenant.yard?.address]);
  const { msg, busy, run } = useAction();
  const zones = ZONES.some(([z]) => z === f.timezone) ? ZONES : [[f.timezone, f.timezone] as const, ...ZONES];
  return (
    <Card className="max-w-2xl">
      <h2 className="font-semibold">Company</h2>
      <p className="mt-1 text-sm text-muted">Your name goes on every quote, invoice and text. Customer replies go to the email, and drivers see the phone on their route.</p>
      <div className="mt-2 grid gap-2 sm:grid-cols-2">
        <div><Label htmlFor="co-name">Company name</Label><Input id="co-name" data-testid="co-name" maxLength={120} value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} />{f.name.trim().length < 2 ? <p className="mt-1 text-xs text-danger" data-testid="co-name-needed">Enter your company name, at least 2 letters. It goes on every quote, invoice and text.</p> : null}</div>
        <div>
          <Label htmlFor="co-tz">Time zone</Label>
          <Select id="co-tz" data-testid="co-tz" value={f.timezone} onChange={(e) => setF({ ...f, timezone: e.target.value })}>
            {zones.map(([z, label]) => <option key={z} value={z}>{label}</option>)}
          </Select>
        </div>
        <div><Label htmlFor="co-email">Office email</Label><Input id="co-email" type="email" data-testid="co-email" value={f.contact_email} onChange={(e) => setF({ ...f, contact_email: e.target.value })} /></div>
        <div><Label htmlFor="co-phone">Office phone</Label><Input id="co-phone" type="tel" data-testid="co-phone" value={f.contact_phone} onChange={(e) => setF({ ...f, contact_phone: e.target.value })} /></div>
        <div className="sm:col-span-2"><Label htmlFor="co-legal">Legal business name (optional)</Label><Input id="co-legal" data-testid="co-legal" maxLength={200} placeholder={f.name || 'As registered'} value={f.business_legal_name} onChange={(e) => setF({ ...f, business_legal_name: e.target.value })} /></div>
        <fieldset className="grid gap-2 sm:col-span-2 sm:grid-cols-6" data-testid="co-mailing">
          <legend className="mb-1 text-sm font-medium">Mailing address</legend>
          <p className="-mt-1 mb-1 text-xs text-muted sm:col-span-6">Printed at the bottom of every email to customers, as the law asks for business email.</p>
          <div className="sm:col-span-6"><Label htmlFor="co-line1">Street</Label><Input id="co-line1" data-testid="co-line1" maxLength={200} autoComplete="address-line1" value={f.line1} onChange={(e) => setF({ ...f, line1: e.target.value })} /></div>
          <div className="sm:col-span-3"><Label htmlFor="co-city">City</Label><Input id="co-city" data-testid="co-city" maxLength={100} autoComplete="address-level2" value={f.city} onChange={(e) => setF({ ...f, city: e.target.value })} /></div>
          <div className="sm:col-span-1"><Label htmlFor="co-state">State</Label><Input id="co-state" data-testid="co-state" maxLength={40} autoComplete="address-level1" value={f.state} onChange={(e) => setF({ ...f, state: e.target.value })} /></div>
          <div className="sm:col-span-2"><Label htmlFor="co-zip">ZIP</Label><Input id="co-zip" data-testid="co-zip" maxLength={20} inputMode="numeric" autoComplete="postal-code" value={f.zip} onChange={(e) => setF({ ...f, zip: e.target.value })} /></div>
        </fieldset>
        <div className="sm:col-span-2">
          <Label htmlFor="co-yard">Yard address (optional)</Label>
          <Input id="co-yard" data-testid="co-yard" maxLength={300} autoComplete="off" placeholder="Where your trucks start and end a storm" value={f.yard_address} onChange={(e) => { setF({ ...f, yard_address: e.target.value }); setYardPoint(null); setYardMissed(false); }} />
          {yardMissed ? <p className="mt-1 text-sm text-warn-ink" data-testid="co-yard-missed">That exact address isn't on the map. Pick the closest match{yardHits.length ? ' below' : ', or try the street number next door'}.</p> : null}
          {yardHits.length ? (
            <ul className="mt-1 divide-y divide-line-faint rounded-md border border-line-faint bg-surface" data-testid="co-yard-hits">
              {yardHits.map((h) => <li key={h.label}><button type="button" className="block min-h-11 w-full px-3 py-2 text-left text-sm hover:bg-tint" data-testid="co-yard-hit" onClick={() => { setF({ ...f, yard_address: h.label }); setYardPoint({ lat: h.lat, lon: h.lon }); setYardHits([]); setYardMissed(false); }}>{h.label}</button></li>)}
            </ul>
          ) : null}
          <p className="mt-1 text-xs text-muted">With a yard, Suggest order starts and ends each route there. Turn that off for a route on the Routes page.</p>
        </div>
      </div>
      <div className="mt-3 flex items-center gap-2">
        <Button disabled={busy || f.name.trim().length < 2} data-testid="co-save" onClick={() => run(async () => {
          try {
            if (f.line1.trim() && (!f.city.trim() || !f.state.trim() || !f.zip.trim())) throw new Error('Add the city, state and ZIP to the mailing address, or clear the street.');
            await api('/api/settings', { method: 'PATCH', body: { name: f.name, timezone: f.timezone, contact_email: f.contact_email, contact_phone: f.contact_phone, business_legal_name: f.business_legal_name, address: f.line1.trim() ? { line1: f.line1.trim(), city: f.city.trim(), state: f.state.trim(), zip: f.zip.trim() } : null, ...(f.yard_address.trim() !== (tenant.yard?.address ?? '') ? { yard_address: f.yard_address.trim() || null, yard_point: yardPoint } : {}) } });
          } catch (e) {
            // No exact match: offer the nearest ones instead of a dead end (issue 79).
            if ((e as { code?: string }).code !== 'address_not_found') throw e;
            setYardMissed(true);
            // The numbers next door, then the street itself, kept near the company (issue 87).
            const o = await api<{ hits: { label: string; lat: number; lon: number }[] }>('/api/sites/suggest', { body: { q: f.yard_address.trim(), expand: true } }).catch(() => ({ hits: [] }));
            setYardHits(o.hits);
            throw new Error("That yard address isn't on the map. Pick the closest match under the field.", { cause: e });
          }
          router.refresh();
        })}>Save</Button>
        {msg ? <span className="text-sm text-muted" role="status" data-testid="co-msg">{msg}</span> : null}
      </div>
    </Card>
  );
}

/** The company's logo on quotes, the records page and PDF bills (issue 173). Optional. */
export function LogoForm({ url }: { url: string | null }) {
  const router = useRouter();
  const { msg, busy, run } = useAction();
  const [ask, dialog] = useConfirm();
  return (
    <Card className="max-w-xl" data-testid="logo-form">
      <h2 className="font-semibold">Logo (optional)</h2>
      <p className="mt-1 text-sm text-muted">Shown on your quotes, your customers&apos; records page and PDF bills. PNG or JPEG, up to 1 MB.</p>
      {url ? <img src={url} alt="Your logo" className="mt-3 max-h-16 max-w-48 object-contain" data-testid="logo-preview" /> : null}
      <Label className="mt-3" htmlFor="logo-file">{url ? 'Replace it' : 'Choose a file'}</Label>
      <input id="logo-file" type="file" accept="image/png,image/jpeg" disabled={busy} className="mt-1 block text-base" data-testid="logo-file" onChange={(e) => {
        const file = e.target.files?.[0];
        if (!file) return;
        void run(async () => {
          const form = new FormData();
          form.append('file', file);
          const res = await fetch('/api/settings/logo', { method: 'POST', body: form });
          if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error ?? 'That logo could not be saved.');
          router.refresh();
        }, 'Saved');
      }} />
      {url ? <Button size="sm" variant="ghost" className="mt-2" disabled={busy} data-testid="logo-remove" onClick={async () => {
        if (!(await ask({ title: 'Remove your logo?', body: 'Quotes, the records page and PDF bills go back to showing your company name only.', confirm: 'Remove logo', danger: true }))) return;
        await run(async () => { await api('/api/settings/logo', { method: 'DELETE' }); router.refresh(); }, 'Removed');
      }}>Remove logo</Button> : null}
      {dialog}
      {msg ? <p className="mt-2 text-sm text-muted" role="status" data-testid="logo-msg">{msg}</p> : null}
    </Card>
  );
}

export function BusinessForm({ tenant }: { tenant: any }) {
  const router = useRouter();
  const v = tenant.sms_verification ?? {};
  const [f, setF] = useState({
    business_legal_name: tenant.business_legal_name ?? '', contact_email: tenant.contact_email ?? '', contact_phone: phone(tenant.contact_phone), contact_name: v.contact_name ?? '', website: v.website ?? '',
    line1: tenant.address?.line1 ?? '', city: tenant.address?.city ?? '', state: tenant.address?.state ?? '', zip: tenant.address?.zip ?? '', expected_monthly_volume: v.expected_monthly_volume ?? 1000,
  });
  const { msg, busy, run } = useAction();
  const text = (key: keyof typeof f, label: string, testId?: string) => (
    <div><Label htmlFor={key}>{label}</Label><Input id={key} data-testid={testId} value={f[key]} onChange={(e) => setF({ ...f, [key]: e.target.value })} /></div>
  );
  return (
    <Card>
      <h2 className="font-semibold">Business details for verification</h2>
      <div className="mt-2 grid gap-2 sm:grid-cols-2">
        {text('business_legal_name', 'Legal business name', 'legal-name')}
        {text('contact_name', 'Contact name', 'contact-name')}
        {text('contact_email', 'Contact email', 'contact-email')}
        {text('contact_phone', 'Contact phone', 'contact-phone')}
        {text('line1', 'Street', 'line1')}
        {text('city', 'City', 'city')}
        {text('state', 'State', 'state')}
        {text('zip', 'ZIP', 'zip')}
        {text('website', 'Website (blank uses your Flake page)')}
      </div>
      <div className="mt-3 flex items-center gap-2">
        <Button disabled={busy} data-testid="business-save" onClick={() => run(async () => {
          await api('/api/settings', { method: 'PATCH', body: { business_legal_name: f.business_legal_name, contact_email: f.contact_email, contact_phone: f.contact_phone, contact_name: f.contact_name, website: f.website, expected_monthly_volume: Number(f.expected_monthly_volume), address: f.line1 ? { line1: f.line1, city: f.city, state: f.state, zip: f.zip } : null } });
          router.refresh();
        })}>Save</Button>
        {msg ? <span className="text-sm text-muted" data-testid="business-msg">{msg}</span> : null}
      </div>
    </Card>
  );
}

export function PlanPanel({ plan, freeUntil, inSeason, available = true }: { plan: string; freeUntil: string | null; inSeason: boolean; available?: boolean }) {
  const { msg, busy, run } = useAction();
  // Issue 182: during the free season there are no plans, prices or upgrade buttons to show, only what's true now.
  if (inSeason && plan !== 'pro') {
    return (
      <Card className="max-w-xl">
        <h2 className="font-semibold">Plan</h2>
        <p className="mt-2 text-sm text-ink-2" data-testid="free-season">Free for the {seasonLabel(freeUntil ?? undefined)} season, through {freeUntil ? longDate(freeUntil) : 'the end of the season'}: every feature is on, with <b>unlimited sites</b>. No card needed. Pricing for next season will be announced before it starts, and nobody is charged without agreeing first.</p>
        <p className="mt-2 text-sm text-muted">Card and bank payments through Flake carry Stripe&apos;s fees and a small Flake fee. Both are shown on each bill before you send it.</p>
      </Card>
    );
  }
  return (
    <Card className="max-w-xl">
      <h2 className="font-semibold">Plan</h2>
      <p className="mt-1 text-sm">Current: <Badge tone={plan === 'pro' ? 'green' : 'gray'} data-testid="plan">{plan}</Badge></p>
      {/* The free first season lifts the site cap with the other Pro features, so the copy says so (issue 51). */}
      {inSeason && plan !== 'pro' ? <p className="mt-2 text-sm text-ink-2" data-testid="free-season">Free first season through {freeUntil ? new Date(`${freeUntil}T12:00:00Z`).toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric', timeZone: 'UTC' }) : 'the end of the season'}: <b>unlimited sites</b> and every Pro feature, with no Pro charge. The 1% payment fee still applies. After that, the free plan covers {FREE_SITE_LIMIT} sites; sites you already have stay, and adding more needs Pro.</p> : null}
      <ul className="mt-3 list-disc pl-5 text-sm text-ink-2">
        <li>Free{inSeason ? ', after the first season' : ''}: up to {FREE_SITE_LIMIT} sites, all core features, 1% fee on payments (min {money(50)}, max {money(2500)})</li>
        <li>Pro: {money(7900)}/mo or {money(79000)}/yr, unlimited sites, sub pay statements, QuickBooks export, 0.5% fee</li>
      </ul>
      {plan !== 'pro' && !available ? <p className="mt-3 rounded-md bg-tint p-3 text-sm" data-testid="pro-unavailable">Pro sign-up opens once card payments are available in Flake. {inSeason ? 'Until then the free first season already includes every Pro feature.' : ''}</p> : null}
      {plan !== 'pro' && available ? (
        <div className="mt-3 flex gap-2">
          <Button disabled={busy} onClick={() => run(async () => { window.location.href = (await api('/api/settings/plan', { body: { interval: 'monthly' } })).url; }, 'Opening checkout...')}>Go Pro monthly</Button>
          <Button variant="outline" disabled={busy} onClick={() => run(async () => { window.location.href = (await api('/api/settings/plan', { body: { interval: 'yearly' } })).url; }, 'Opening checkout...')}>Go Pro yearly</Button>
        </div>
      ) : null}
      {msg ? <p className="mt-2 text-sm text-muted">{msg}</p> : null}
    </Card>
  );
}

export function RetryJob({ id }: { id: number }) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  return (
    <>
      <Button size="sm" variant="ghost" onClick={async () => {
        setError(null);
        try {
          await api('/api/settings/jobs', { body: { id } });
          router.refresh();
        } catch (e) {
          setError((e as Error).message);
        }
      }}>Retry</Button>
      {error ? <p className="text-sm text-danger" role="alert">{error}</p> : null}
    </>
  );
}

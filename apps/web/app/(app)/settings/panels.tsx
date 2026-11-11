'use client';

import { FREE_SITE_LIMIT } from '@flake/core/fees';
import type { RateCard } from '@flake/core/quote';
import { Badge, Button, Card, Input, Label, Select, Table, Td, Th } from '@flake/ui';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { api, dollarsToCents, money, phone } from '@/lib/client';
import { rateCardProblem } from '@/lib/limits';

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
  const { msg, busy, run } = useAction();
  const [shown, setShown] = useState(false);
  const problem = rateCardProblem(f);
  const field = (key: keyof typeof f, label: string, attrs: { step?: string; min: number; max: number }, testId?: string) => (
    <div><Label htmlFor={`rc-${key}`}>{label}</Label><Input id={`rc-${key}`} type="number" inputMode="decimal" {...attrs} value={f[key]} onChange={(e) => { setShown(false); setF({ ...f, [key]: e.target.value }); }} {...(testId ? { 'data-testid': testId } : {})} /></div>
  );
  return (
    <Card className="max-w-xl">
      <h2 className="font-semibold">Rate card</h2>
      <p className="mt-1 text-sm text-slate-600">These are your numbers, and they set suggested prices on new quotes. The starting values are placeholders, not market data.</p>
      <div className="mt-3 grid gap-3 sm:grid-cols-2">
        {field('rate', 'Cents per sq ft, per push', { step: '0.01', min: 0, max: 100 }, 'rate-sqft')}
        {field('min', 'Minimum push ($)', { step: '0.01', min: 0, max: 100000 })}
        {field('walk', 'Cents per foot of walk', { step: '0.01', min: 0, max: 1000 })}
        {field('salt', 'Salt per 50 lb bag ($)', { step: '0.01', min: 0, max: 100000 })}
        {field('pushes', 'Pushes per season', { step: '1', min: 1, max: 100 })}
      </div>
      {problem ? <p className="mt-3 text-sm text-red-700" role="alert" data-testid="rate-problem">{problem}</p> : null}
      <div className="mt-4 flex items-center gap-2">
        <Button disabled={busy || Boolean(problem)} data-testid="rate-save" onClick={() => { setShown(true); void run(() => api('/api/settings/rate-card', { method: 'PUT', body: { ...card, per_sqft_cents_per_push: Number(f.rate), min_push_cents: dollarsToCents(f.min), walks_per_lf_cents: Number(f.walk), salt_bag_cents: dollarsToCents(f.salt), season_pushes: Number(f.pushes) } })); }}>Save</Button>
        {msg && shown ? <span className={msg === 'Saved' ? 'text-sm font-medium text-emerald-800' : 'text-sm text-red-700'} role={msg === 'Saved' ? 'status' : 'alert'} data-testid="rate-msg">{msg}</span> : null}
      </div>
    </Card>
  );
}

export function CrewPanel({ crew, canText = true }: { crew: any[]; canText?: boolean }) {
  const router = useRouter();
  const blank = { name: '', phone_e164: '', email: '', kind: 'employee', language: 'en', per_visit: '', hourly: '' };
  const [f, setF] = useState(blank);
  const [editing, setEditing] = useState<string | null>(null);
  const [invite, setInvite] = useState<string | null>(null);
  const { msg, busy, run } = useAction();
  const load = (c: any) => {
    setEditing(c.id);
    setInvite(null);
    setF({ name: c.name, phone_e164: c.phone_e164 ?? '', email: c.email ?? '', kind: c.kind, language: c.language, per_visit: c.sub_rate_card?.per_visit_cents ? String(c.sub_rate_card.per_visit_cents / 100) : '', hourly: c.sub_rate_card?.hourly_cents ? String(c.sub_rate_card.hourly_cents / 100) : '' });
  };
  const body = () => {
    const { per_visit, hourly, ...rest } = f;
    return { ...rest, kind: f.kind, sub_rate_card: f.kind === 'sub' ? { ...(per_visit ? { per_visit_cents: dollarsToCents(per_visit) } : {}), ...(hourly ? { hourly_cents: dollarsToCents(hourly) } : {}) } : null };
  };
  return (
    <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
      <div className="min-w-0 lg:col-span-2">
        <Table>
          <thead><tr><Th>Name</Th><Th>Kind</Th><Th>Contact</Th><Th>Language</Th><Th>Joined</Th><Th><span className="sr-only">Actions</span></Th></tr></thead>
          <tbody>
            {crew.map((c) => (
              <tr key={c.id} className={c.active ? '' : 'bg-slate-50 text-slate-600'} data-testid="crew-row">
                <Td>{c.name}{c.active ? null : <span className="ml-2 text-xs font-medium">(no longer on the crew)</span>}</Td>
                <Td><Badge>{c.kind}</Badge></Td>
                <Td><div className="whitespace-nowrap">{phone(c.phone_e164)}</div><div>{c.email ?? ''}</div></Td>
                <Td>{c.language === 'es' ? 'Español' : 'English'}</Td>
                <Td>{c.joined_at ? 'Yes' : 'Invited'}</Td>
                <Td>{c.active ? (
                  <div className="flex gap-0.5">
                    <Button size="sm" variant="ghost" className="px-2" data-testid="crew-edit" onClick={() => load(c)}>Edit</Button>
                    <Button size="sm" variant="ghost" className="px-2" data-testid="crew-reinvite" onClick={() => run(async () => { setInvite((await api(`/api/crew/${c.id}/invite`, { method: 'POST' })).invite_url); }, 'New link ready')}>New link</Button>
                    <Button size="sm" variant="ghost" className="px-2" data-testid="crew-remove" onClick={() => {
                      if (!confirm(`Take ${c.name} off the crew? Any route link they have open stops working now.`)) return;
                      void run(async () => { await api(`/api/crew/${c.id}`, { method: 'DELETE' }); router.refresh(); }, 'Removed');
                    }}>Remove</Button>
                  </div>
                ) : (
                  <Button size="sm" variant="ghost" className="px-2" data-testid="crew-restore" onClick={() => run(async () => { await api(`/api/crew/${c.id}`, { method: 'PATCH', body: { active: true } }); router.refresh(); }, 'Back on the crew. Send them a new link.')}>Bring back</Button>
                )}</Td>
              </tr>
            ))}
          </tbody>
        </Table>
      </div>
      <Card>
        <h2 className="font-semibold">{editing ? 'Edit crew member' : 'Invite crew'}</h2>
        <p className="mt-1 text-sm text-slate-600">{editing ? 'Texts stay opt-in. A changed number needs a new opt-in from the invite link.' : 'They choose on the join page whether to get texts.'}</p>
        <div className="mt-2 space-y-2">
          <div><Label htmlFor="crew-name">Name</Label><Input id="crew-name" data-testid="crew-name" value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} /></div>
          <div><Label htmlFor="crew-phone">Mobile</Label><Input id="crew-phone" value={f.phone_e164} onChange={(e) => setF({ ...f, phone_e164: e.target.value })} /></div>
          <div>
            <Label htmlFor="crew-email">Email</Label>
            <Input id="crew-email" type="email" value={f.email} onChange={(e) => setF({ ...f, email: e.target.value })} aria-describedby="crew-email-hint" />
            {!canText ? <p id="crew-email-hint" className="mt-1 text-xs text-amber-800" data-testid="crew-email-hint">Texting isn&apos;t approved yet, so route links go by email. Add it here, or the driver adds it when they join.</p> : null}
          </div>
          <div className="grid grid-cols-2 gap-2">
            <div><Label htmlFor="crew-kind">Kind</Label><Select id="crew-kind" value={f.kind} onChange={(e) => setF({ ...f, kind: e.target.value })}><option value="employee">Employee</option><option value="sub">Subcontractor</option></Select></div>
            <div><Label htmlFor="crew-lang">Language</Label><Select id="crew-lang" data-testid="crew-lang" value={f.language} onChange={(e) => setF({ ...f, language: e.target.value })}><option value="en">English</option><option value="es">Spanish</option></Select></div>
          </div>
          {f.kind === 'sub' ? (
            <div className="grid grid-cols-2 gap-2">
              <div><Label htmlFor="sub-visit">Pay per visit ($)</Label><Input id="sub-visit" type="number" value={f.per_visit} onChange={(e) => setF({ ...f, per_visit: e.target.value })} /></div>
              <div><Label htmlFor="sub-hour">Pay per hour ($)</Label><Input id="sub-hour" type="number" value={f.hourly} onChange={(e) => setF({ ...f, hourly: e.target.value })} /></div>
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
            setInvite(out.invite_url);
            setF(blank);
            router.refresh();
          }, 'Invited')}>Invite</Button>
        )}
        {msg ? <p className="mt-2 text-sm text-slate-600" data-testid="crew-msg">{msg}</p> : null}
        {invite ? <div className="mt-2"><Label>Invite link</Label><Input readOnly value={invite} data-testid="invite-url" /></div> : null}
      </Card>
    </div>
  );
}

export function TeamPanel({ members, me }: { members: { user_id: string; email: string | null; role: string; pending?: boolean }[]; me: string }) {
  const router = useRouter();
  const [email, setEmail] = useState('');
  const [role, setRole] = useState('dispatcher');
  const { msg, busy, run } = useAction();
  return (
    <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
      <div className="min-w-0 lg:col-span-2">
        <Table>
          <thead><tr><Th>Email</Th><Th>Role</Th><Th><span className="sr-only">Actions</span></Th></tr></thead>
          <tbody>
            {members.map((m) => (
              <tr key={m.user_id} data-testid="team-row">
                <Td>{m.email}{m.pending ? <Badge tone="amber" className="ml-2" data-testid="team-pending">invited, not signed in yet</Badge> : null}</Td>
                <Td>{m.user_id !== me ? (
                  <Select aria-label={`Role for ${m.email ?? 'this person'}`} className="h-8 w-32 py-0 text-xs" value={m.role} data-testid="team-role-change" disabled={busy} onChange={(e) => void run(async () => { await api(`/api/settings/team/${m.user_id}`, { method: 'PATCH', body: { role: e.target.value } }); router.refresh(); }, 'Role changed')}>
                    <option value="owner">Owner</option><option value="dispatcher">Dispatcher</option><option value="viewer">Viewer</option>
                  </Select>
                ) : <Badge>{m.role}</Badge>}</Td>
                <Td>{m.user_id !== me ? (
                  <div className="flex flex-wrap gap-1">
                    {m.pending ? <Button size="sm" variant="ghost" data-testid="team-resend" disabled={busy} onClick={() => void run(async () => { await api(`/api/settings/team/${m.user_id}`, { method: 'POST' }); }, `Sent the invite to ${m.email} again.`)}>Resend invite</Button> : null}
                    <Button size="sm" variant="ghost" data-testid="team-remove" onClick={() => {
                      if (!confirm(`Remove ${m.email ?? 'this person'} from your company? They lose access right away.`)) return;
                      void run(async () => { await api(`/api/settings/team/${m.user_id}`, { method: 'DELETE' }); router.refresh(); }, 'Removed');
                    }}>Remove</Button>
                  </div>
                ) : <span className="text-xs text-slate-500">You</span>}</Td>
              </tr>
            ))}
          </tbody>
        </Table>
      </div>
      <Card>
        <h2 className="font-semibold">Add someone to the office</h2>
        <p className="mt-1 text-sm text-slate-600">Dispatchers run storms and billing. Viewers can only look. They sign in with an email link, with no password.</p>
        <Label className="mt-3" htmlFor="team-email">Email</Label>
        <Input id="team-email" type="email" data-testid="team-email" value={email} onChange={(e) => setEmail(e.target.value)} />
        <Label className="mt-2" htmlFor="team-role">Role</Label>
        <Select id="team-role" data-testid="team-role" value={role} onChange={(e) => setRole(e.target.value)}><option value="dispatcher">Dispatcher</option><option value="viewer">Viewer</option><option value="owner">Owner</option></Select>
        <Button className="mt-3 w-full" disabled={busy || !email.includes('@')} data-testid="team-add" onClick={() => run(async () => { await api('/api/settings/team', { body: { email, role } }); setEmail(''); router.refresh(); }, 'Added. We emailed them a sign-in link.')}>Add</Button>
        {msg ? <p className="mt-2 text-sm text-slate-600" data-testid="team-msg">{msg}</p> : null}
      </Card>
    </div>
  );
}

export function PaymentsPanel({ connected, enabled }: { connected: boolean; enabled: boolean }) {
  const { msg, busy, run } = useAction();
  return (
    <Card className="max-w-xl">
      <h2 className="font-semibold">Stripe</h2>
      <p className="mt-1 text-sm">Status: <Badge tone={enabled ? 'green' : connected ? 'amber' : 'gray'} data-testid="stripe-status">{enabled ? 'Charges enabled' : connected ? 'Finish onboarding' : 'Not connected'}</Badge></p>
      <p className="mt-2 text-sm text-slate-600">Payments go straight to your own Stripe account. You pay Stripe&apos;s fees, Stripe handles disputes and losses, and you log in to your own Stripe Dashboard. Flake takes a small application fee on each payment, shown on every billing review. You can skip this and use Flake without online payments.</p>
      <Button className="mt-3" variant="accent" disabled={busy || enabled} data-testid="stripe-connect" onClick={() => run(async () => { window.location.href = (await api('/api/settings/stripe', { method: 'POST' })).url; }, 'Opening Stripe...')}>{connected ? 'Continue onboarding' : 'Connect Stripe'}</Button>
      {msg ? <p className="mt-2 text-sm text-slate-600">{msg}</p> : null}
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
      {msg ? <p className="mt-2 text-sm text-slate-600" data-testid="sms-msg">{msg}</p> : null}
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
  const [f, setF] = useState({ name: tenant.name ?? '', timezone: tenant.timezone ?? 'America/New_York', contact_email: tenant.contact_email ?? '', contact_phone: tenant.contact_phone ?? '' });
  const { msg, busy, run } = useAction();
  const zones = ZONES.some(([z]) => z === f.timezone) ? ZONES : [[f.timezone, f.timezone] as const, ...ZONES];
  return (
    <Card className="max-w-2xl">
      <h2 className="font-semibold">Company</h2>
      <p className="mt-1 text-sm text-slate-600">Your name goes on every quote, invoice and text. Customer replies go to the email, and drivers see the phone on their route.</p>
      <div className="mt-2 grid gap-2 sm:grid-cols-2">
        <div><Label htmlFor="co-name">Company name</Label><Input id="co-name" data-testid="co-name" maxLength={120} value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} />{f.name.trim().length < 2 ? <p className="mt-1 text-xs text-red-700" data-testid="co-name-needed">Enter your company name, at least 2 letters. It goes on every quote, invoice and text.</p> : null}</div>
        <div>
          <Label htmlFor="co-tz">Time zone</Label>
          <Select id="co-tz" data-testid="co-tz" value={f.timezone} onChange={(e) => setF({ ...f, timezone: e.target.value })}>
            {zones.map(([z, label]) => <option key={z} value={z}>{label}</option>)}
          </Select>
        </div>
        <div><Label htmlFor="co-email">Office email</Label><Input id="co-email" type="email" data-testid="co-email" value={f.contact_email} onChange={(e) => setF({ ...f, contact_email: e.target.value })} /></div>
        <div><Label htmlFor="co-phone">Office phone</Label><Input id="co-phone" type="tel" data-testid="co-phone" value={f.contact_phone} onChange={(e) => setF({ ...f, contact_phone: e.target.value })} /></div>
      </div>
      <div className="mt-3 flex items-center gap-2">
        <Button disabled={busy || f.name.trim().length < 2} data-testid="co-save" onClick={() => run(async () => {
          await api('/api/settings', { method: 'PATCH', body: { name: f.name, timezone: f.timezone, contact_email: f.contact_email, contact_phone: f.contact_phone } });
          router.refresh();
        })}>Save</Button>
        {msg ? <span className="text-sm text-slate-600" role="status" data-testid="co-msg">{msg}</span> : null}
      </div>
    </Card>
  );
}

export function BusinessForm({ tenant }: { tenant: any }) {
  const router = useRouter();
  const v = tenant.sms_verification ?? {};
  const [f, setF] = useState({
    business_legal_name: tenant.business_legal_name ?? '', contact_email: tenant.contact_email ?? '', contact_phone: tenant.contact_phone ?? '', contact_name: v.contact_name ?? '', website: v.website ?? '',
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
        {text('contact_phone', 'Contact phone (+1...)', 'contact-phone')}
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
        {msg ? <span className="text-sm text-slate-600" data-testid="business-msg">{msg}</span> : null}
      </div>
    </Card>
  );
}

export function PlanPanel({ plan, freeUntil, inSeason }: { plan: string; freeUntil: string | null; inSeason: boolean }) {
  const { msg, busy, run } = useAction();
  return (
    <Card className="max-w-xl">
      <h2 className="font-semibold">Plan</h2>
      <p className="mt-1 text-sm">Current: <Badge tone={plan === 'pro' ? 'green' : 'gray'} data-testid="plan">{plan}</Badge></p>
      {/* The free first season lifts the site cap with the other Pro features, so the copy says so (issue 51). */}
      {inSeason && plan !== 'pro' ? <p className="mt-2 text-sm text-slate-700" data-testid="free-season">Free first season through {freeUntil ? new Date(`${freeUntil}T12:00:00Z`).toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric', timeZone: 'UTC' }) : 'the end of the season'}: <b>unlimited sites</b> and every Pro feature, with no Pro charge. The 1% payment fee still applies. After that, the free plan covers {FREE_SITE_LIMIT} sites; sites you already have stay, and adding more needs Pro.</p> : null}
      <ul className="mt-3 list-disc pl-5 text-sm text-slate-700">
        <li>Free{inSeason ? ', after the first season' : ''}: up to {FREE_SITE_LIMIT} sites, all core features, 1% fee on payments (min {money(50)}, max {money(2500)})</li>
        <li>Pro: {money(7900)}/mo or {money(79000)}/yr, unlimited sites, sub pay statements, QuickBooks export, 0.5% fee</li>
      </ul>
      {plan !== 'pro' ? (
        <div className="mt-3 flex gap-2">
          <Button disabled={busy} onClick={() => run(async () => { window.location.href = (await api('/api/settings/plan', { body: { interval: 'monthly' } })).url; }, 'Opening checkout...')}>Go Pro monthly</Button>
          <Button variant="outline" disabled={busy} onClick={() => run(async () => { window.location.href = (await api('/api/settings/plan', { body: { interval: 'yearly' } })).url; }, 'Opening checkout...')}>Go Pro yearly</Button>
        </div>
      ) : null}
      {msg ? <p className="mt-2 text-sm text-slate-600">{msg}</p> : null}
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
      {error ? <p className="text-sm text-red-700" role="alert">{error}</p> : null}
    </>
  );
}

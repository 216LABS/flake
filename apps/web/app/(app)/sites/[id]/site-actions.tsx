'use client';

import { Badge, Button, Card, Input, Label, Select } from '@flake/ui';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { useConfirm } from '@/components/confirm';
import { api, dollarsToCents } from '@/lib/client';
import { scopeLine } from '@/lib/scope';

type PricingType = 'per_push' | 'per_inch_tier' | 'per_event' | 'seasonal' | 'hourly';

function pricing(type: PricingType, cents: number) {
  switch (type) {
    case 'per_push': return { type, amount_cents: cents };
    case 'per_event': return { type, amount_cents: cents };
    case 'hourly': return { type, rate_cents: cents };
    case 'seasonal': return { type, total_cents: cents, installments: 5 };
    case 'per_inch_tier': return { type, tiers: [{ up_to_in: 4, amount_cents: cents }, { up_to_in: 8, amount_cents: Math.round(cents * 1.5) }, { up_to_in: null, amount_cents: cents * 2 }] };
  }
}

/** The same limits the server checks, said in words before anything is sent. */
export function quoteProblem(price: string, trigger: number | string): string | null {
  const p = Number(price);
  if (price === '' || !Number.isFinite(p)) return 'Enter a price.';
  if (p <= 0) return 'The price must be more than $0.';
  if (p > 100000) return 'The price must be $100,000 or less.';
  const t = Number(trigger);
  if (trigger === '' || !Number.isFinite(t) || t < 0) return 'Enter a trigger depth of 0 inches or more.';
  if (t > 48) return 'The trigger depth must be 48 inches or less.';
  return null;
}

/** Renewals and price changes. The newest accepted contract is the one that prices visits. */
export function NewQuote({ siteId, defaultSeason, saltCents, signedSeasons = [] }: { siteId: string; defaultSeason: string; saltCents: number; signedSeasons?: string[] }) {
  const router = useRouter();
  const [type, setType] = useState<PricingType>('per_push');
  const [price, setPrice] = useState('');
  const [trigger, setTrigger] = useState<string>('2');
  const [season, setSeason] = useState(defaultSeason);
  const [salt, setSalt] = useState(false);
  const [url, setUrl] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [ask, dialog] = useConfirm();
  const problem = quoteProblem(price, trigger);
  const replaces = signedSeasons.includes(season.trim());
  const zero = Number(trigger) === 0 && trigger !== '';
  const [sent, setSent] = useState(true);
  const make = async (send: boolean) => {
    if (zero && type !== 'seasonal' && !(await ask({ title: `${send ? 'Send' : 'Make'} with a 0 inch trigger?`, body: 'Any measurable snow starts service, so every dusting is billable.', confirm: send ? 'Send quote' : 'Get link' }))) return;
    setError(null);
    setBusy(true);
    try {
      const services = [{ service: 'plow', trigger_in: Number(trigger), pricing: pricing(type, dollarsToCents(price)) }, ...(salt ? [{ service: 'salt', trigger_in: null }] : [])];
      const out = await api('/api/quotes', { body: { site_id: siteId, season: season.trim(), services, salt_pricing: salt ? { unit: 'bag50lb', amount_cents: saltCents } : null, send } });
      setSent(send);
      setUrl(out.url);
      router.refresh();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  return (
    <Card>
      {dialog}
      <h2 className="font-semibold">Send a new quote</h2>
      <div className="mt-2 space-y-2">
        <div><Label htmlFor="q-type">Pricing</Label><Select id="q-type" value={type} data-testid="q-type" onChange={(e) => setType(e.target.value as PricingType)}><option value="per_push">Per push</option><option value="per_inch_tier">Per inch tiers (price is the first tier)</option><option value="per_event">Per event</option><option value="seasonal">Seasonal (5 installments)</option><option value="hourly">Hourly</option></Select></div>
        <div><Label htmlFor="q-price">Price ($)</Label><Input id="q-price" type="number" step="0.01" min="0.01" max="100000" value={price} data-testid="q-price" onChange={(e) => setPrice(e.target.value)} /></div>
        <div><Label htmlFor="q-trigger">Trigger depth (in)</Label><Input id="q-trigger" type="number" step="0.5" min="0" max="48" value={trigger} data-testid="q-trigger" onChange={(e) => setTrigger(e.target.value)} /></div>
        {zero ? <p className="text-xs text-warn-ink" data-testid="q-zero-warning">0 inches means any measurable snow starts service{type === 'seasonal' ? '.' : ', so every dusting is billable.'}</p> : null}
        <div><Label htmlFor="q-season">Season</Label><Input id="q-season" value={season} maxLength={40} onChange={(e) => setSeason(e.target.value)} /></div>
        <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={salt} onChange={(e) => setSalt(e.target.checked)} /> Include salt per 50 lb bag</label>
        {replaces ? <p className="rounded-md bg-warn-tint p-2 text-xs text-warn-ink" data-testid="q-replaces">This lot already has a signed contract for {season.trim()}. If the customer accepts this quote, it replaces that one. Seasonal installments already billed carry over.</p> : null}
      </div>
      {price !== '' && problem ? <p className="mt-2 text-sm text-danger" data-testid="q-problem">{problem}</p> : null}
      <Button className="mt-3 w-full" disabled={busy || Boolean(problem) || !season.trim()} data-testid="q-send" onClick={() => void make(true)}>Send quote</Button>
      {/* For a quote handed over in person or sent from the office's own phone: nothing is emailed or texted (issue 92). */}
      <Button variant="outline" className="mt-2 w-full" disabled={busy || Boolean(problem) || !season.trim()} data-testid="q-link-only" onClick={() => void make(false)}>Get link only, don&apos;t send</Button>
      {error ? <p className="mt-2 text-sm text-danger" role="alert">{error}</p> : null}
      {url ? <div className="mt-2"><Label>{sent ? 'Quote link. Share it if the customer has no email on file.' : 'Quote link. Nothing was sent, so share it with the customer.'}</Label><Input readOnly value={url} data-testid="q-url" /></div> : null}
    </Card>
  );
}

export interface ContractRow { id: string; status: string; season: string; services: any[]; salt_pricing: any; accepted_name: string | null; accepted_at: string | null; created_at: string | null; installments_billed: number; quote_url?: string | null; decline_reason?: string | null }

const TONE: Record<string, 'green' | 'amber' | 'gray' | 'blue' | 'red'> = { accepted: 'green', sent: 'blue', draft: 'amber', void: 'gray', declined: 'red' };

/** What each contract says, and what the office can still do with it: resend a quote, or void it. */
export function ContractList({ contracts, canEdit, pdf }: { contracts: ContractRow[]; canEdit: boolean; pdf: string | null }) {
  const router = useRouter();
  const [ask, dialog] = useConfirm();
  const [links, setLinks] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const run = async (fn: () => Promise<void>) => {
    setBusy(true);
    setError(null);
    try {
      await fn();
      router.refresh();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  return (
    <Card>
      {dialog}
      <h2 className="font-semibold">Contracts</h2>
      <ul className="mt-2 space-y-3 text-sm">
        {contracts.map((k) => (
          <li key={k.id} data-testid="contract-row" data-status={k.status} className={k.status === 'void' ? 'text-faint' : ''}>
            <div className="flex flex-wrap items-center gap-2"><Badge tone={TONE[k.status] ?? 'gray'}>{k.status === 'sent' ? 'quote sent' : k.status}</Badge><span className="font-medium">{k.season}</span></div>
            <ul className="mt-1 text-ink-2">{k.services.map((s, i) => <li key={i}>{scopeLine(s, k.salt_pricing)}</li>)}</ul>
            {k.status === 'declined' ? <div className="text-ink-2" data-testid="declined-note">Declined by the customer{k.decline_reason ? `: "${k.decline_reason}"` : '.'} Send a new quote to try again.</div> : null}
            {k.accepted_name ? <div className="text-muted">Signed by {k.accepted_name}{k.installments_billed ? `. ${k.installments_billed} installment${k.installments_billed === 1 ? '' : 's'} billed.` : '.'}</div> : null}
            {links[k.id] ? <Input readOnly value={links[k.id]} className="mt-1" data-testid="resent-url" aria-label="New quote link" />
              : k.quote_url ? <Input readOnly value={k.quote_url} className="mt-1" data-testid="quote-link" aria-label="Quote link" onFocus={(e) => e.target.select()} /> : null}
            {canEdit && k.status !== 'void' ? (
              <div className="mt-1 flex flex-wrap gap-2">
                {k.status === 'draft' || k.status === 'sent' ? <Button size="sm" variant="outline" disabled={busy} data-testid="contract-resend" onClick={() => void run(async () => {
                  const out = await api<{ url: string }>(`/api/contracts/${k.id}/resend`, { method: 'POST' });
                  setLinks((all) => ({ ...all, [k.id]: out.url }));
                })}>{k.status === 'draft' ? 'Send' : 'Resend'}</Button> : null}
                <Button size="sm" variant="ghost" disabled={busy} data-testid="contract-void" onClick={async () => {
                  const signed = k.status === 'accepted';
                  const ok = await ask({
                    title: signed ? `Void the signed ${k.season} contract?` : 'Void this quote?',
                    body: signed ? 'Visits from now on aren\'t priced by it, and its seasonal installments stop. Invoices already sent stay as they are. Send a new quote to replace it.' : 'Its link stops working, so the customer can no longer accept it.',
                    confirm: signed ? 'Void contract' : 'Void quote',
                    danger: true,
                  });
                  if (ok) await run(async () => void (await api(`/api/contracts/${k.id}`, { method: 'PATCH', body: { status: 'void' } })));
                }}>Void</Button>
              </div>
            ) : null}
          </li>
        ))}
        {!contracts.length ? <li className="text-muted">None.</li> : null}
      </ul>
      {pdf ? <a className="mt-2 block text-sm text-link underline" href={pdf}>Signed contract PDF</a> : null}
      {error ? <p className="mt-2 text-sm text-danger" role="alert">{error}</p> : null}
    </Card>
  );
}

export function RetireSite({ siteId, customerId, active, canEdit = true }: { siteId: string; customerId: string; active: boolean; canEdit?: boolean }) {
  const router = useRouter();
  const [confirming, setConfirming] = useState(false);
  const [retireError, setRetireError] = useState<string | null>(null);
  if (!active) {
    return (
      <div className="flex flex-wrap items-center gap-2 text-sm">
        <p className="text-muted" data-testid="site-retired">This site is retired. Its records stay on file, and it won&apos;t join new storms or quotes.</p>
        {canEdit ? <Button size="sm" variant="outline" data-testid="restore-site" onClick={async () => {
          setRetireError(null);
          try {
            await api(`/api/sites/${siteId}`, { method: 'PATCH', body: { active: true } });
            router.refresh();
          } catch (e) {
            setRetireError((e as Error).message);
          }
        }}>Restore</Button> : null}
        {retireError ? <p className="w-full text-sm text-danger" role="alert">{retireError}</p> : null}
      </div>
    );
  }
  if (!canEdit) return null;
  if (!confirming) return <Button variant="ghost" data-testid="retire" onClick={() => setConfirming(true)}>Retire this site</Button>;
  return (
    <div className="flex flex-wrap items-center gap-2 text-sm">
      <span>It comes off its routes and any storm still running, and leaves new storms. Its records stay on file.</span>
      <Button variant="danger" size="sm" data-testid="retire-confirm" onClick={async () => { setRetireError(null); try { await api(`/api/sites/${siteId}`, { method: 'DELETE' }); router.push(`/customers/${customerId}`); router.refresh(); } catch (e) { setRetireError((e as Error).message); } }}>Retire</Button>
      <Button variant="ghost" size="sm" onClick={() => setConfirming(false)}>Cancel</Button>
      {retireError ? <p className="mt-2 text-sm text-danger" role="alert">{retireError}</p> : null}
    </div>
  );
}

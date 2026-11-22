'use client';

import { Badge, Button, Card, Input, Label, Select } from '@flake/ui';
import { ButtonA } from '@/components/links';
import { CopyLink, TextIt } from '@/components/text-it';
import type { Share } from '@/lib/share';
import { quotableSeasons } from '@flake/contracts';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { useConfirm } from '@/components/confirm';
import { api, dollarsToCents } from '@/lib/client';
import { scopeLine, type PriorBilled } from '@/lib/scope';

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
export function NewQuote({ siteId, defaultSeason, saltCents, signedSeasons = [], defaultTrigger = 2, suggested }: { siteId: string; defaultSeason: string; saltCents: number; signedSeasons?: string[]; defaultTrigger?: number; suggested?: Partial<Record<PricingType, number>> }) {
  const router = useRouter();
  const [type, setType] = useState<PricingType>('per_push');
  const hint = (t: PricingType) => (suggested?.[t] ? (suggested[t]! / 100).toFixed(2) : '');
  const [price, setPrice] = useState(() => hint('per_push'));
  // Until the price is typed over, switching the pricing type moves to that type's suggested price.
  const [priceTyped, setPriceTyped] = useState(false);
  const [trigger, setTrigger] = useState<string>(String(defaultTrigger));
  const [season, setSeason] = useState(defaultSeason);
  const [salt, setSalt] = useState(false);
  // Walks and haul on a quote (issue 192): each with its own price. Salt in the unit the yard buys in.
  const [saltUnit, setSaltUnit] = useState<'bag50lb' | 'ton' | 'application' | 'lb'>('bag50lb');
  const [saltPrice, setSaltPrice] = useState((saltCents / 100).toFixed(2));
  const [plow, setPlow] = useState(true);
  const [walks, setWalks] = useState(false);
  const [walksPrice, setWalksPrice] = useState('');
  const [haul, setHaul] = useState(false);
  const [haulRate, setHaulRate] = useState('');
  const [url, setUrl] = useState<string | null>(null);
  const [lots, setLots] = useState(1);
  const [share, setShare] = useState<Share | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [ask, dialog] = useConfirm();
  const extraProblem = !plow && !salt && !walks && !haul ? 'Pick at least one service.'
    : salt && !(Number(saltPrice) > 0) ? 'Enter a salt price.'
      : walks && !(Number(walksPrice) > 0) ? 'Enter a price for walks.'
        : haul && !(Number(haulRate) > 0) ? 'Enter an hourly rate for haul.' : null;
  const problem = (plow ? quoteProblem(price, trigger) : null) ?? extraProblem;
  const replaces = signedSeasons.includes(season.trim());
  const zero = Number(trigger) === 0 && trigger !== '';
  const [sent, setSent] = useState(true);
  const make = async (send: boolean) => {
    if (zero && type !== 'seasonal' && !(await ask({ title: `${send ? 'Send' : 'Make'} with a 0 inch trigger?`, body: 'Any measurable snow starts service, so every dusting is billable.', confirm: send ? 'Send quote' : 'Get link' }))) return;
    setError(null);
    setBusy(true);
    try {
      const services = [
        ...(plow ? [{ service: 'plow', trigger_in: Number(trigger), pricing: pricing(type, dollarsToCents(price)) }] : []),
        ...(salt ? [{ service: 'salt', trigger_in: null }] : []),
        ...(walks ? [{ service: 'walks', trigger_in: plow ? Number(trigger) : null, pricing: { type: 'per_push', amount_cents: dollarsToCents(walksPrice) } }] : []),
        ...(haul ? [{ service: 'haul', trigger_in: null, pricing: { type: 'hourly', rate_cents: dollarsToCents(haulRate) } }] : []),
      ];
      const out = await api('/api/quotes', { body: { site_id: siteId, season: season.trim(), services, salt_pricing: salt ? { unit: saltUnit, amount_cents: dollarsToCents(saltPrice) } : null, send } });
      setSent(send);
      setLots(out.lots ?? 1);
      setShare(out.share ?? null);
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
        <div><Label htmlFor="q-type">Pricing</Label><Select id="q-type" value={type} data-testid="q-type" onChange={(e) => { const t = e.target.value as PricingType; setType(t); if (!priceTyped) setPrice(hint(t)); }}><option value="per_push">Per push</option><option value="per_inch_tier">Per inch tiers (price is the first tier)</option><option value="per_event">Per event</option><option value="seasonal">Seasonal (5 installments)</option><option value="hourly">Hourly</option></Select></div>
        <div><Label htmlFor="q-price">{type === 'seasonal' ? 'Season total ($)' : 'Price ($)'}{!priceTyped && price && price === hint(type) ? <span className="font-normal text-muted"> suggested from your rate card</span> : null}</Label><Input id="q-price" type="number" step="0.01" min="0.01" max="100000" value={price} data-testid="q-price" onChange={(e) => { setPrice(e.target.value); setPriceTyped(true); }} /></div>
        <div><Label htmlFor="q-trigger">Trigger depth (in)</Label><Input id="q-trigger" type="number" step="0.5" min="0" max="48" value={trigger} data-testid="q-trigger" onChange={(e) => setTrigger(e.target.value)} /></div>
        {zero ? <p className="text-xs text-warn-ink" data-testid="q-zero-warning">0 inches means any measurable snow starts service{type === 'seasonal' ? '.' : ', so every dusting is billable.'}</p> : null}
        {/* This season or next: a typed season could land on a winter long gone or decades out (issue 126). */}
        <div><Label htmlFor="q-season">Season</Label><Select id="q-season" data-testid="q-season" value={season} onChange={(e) => setSeason(e.target.value)}>{[...new Set([defaultSeason, ...quotableSeasons()])].sort().map((x) => <option key={x} value={x}>{x}</option>)}</Select></div>
        <fieldset className="space-y-2 rounded-md border border-line-faint p-3" data-testid="q-services">
          <legend className="px-1 text-sm font-semibold">Services the driver can log here</legend>
          <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={plow} data-testid="q-plow" onChange={(e) => setPlow(e.target.checked)} /> Plow (priced above)</label>
          <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={salt} data-testid="q-salt" onChange={(e) => setSalt(e.target.checked)} /> Salt</label>
          {salt ? (
            <div className="ml-6 grid grid-cols-2 gap-2">
              <div><Label htmlFor="q-salt-price">Price ($)</Label><Input id="q-salt-price" type="number" step="0.01" min="0.01" value={saltPrice} data-testid="q-salt-price" onChange={(e) => setSaltPrice(e.target.value)} /></div>
              <div><Label htmlFor="q-salt-unit">Per</Label><Select id="q-salt-unit" value={saltUnit} data-testid="q-salt-unit" onChange={(e) => setSaltUnit(e.target.value as typeof saltUnit)}><option value="bag50lb">50 lb bag</option><option value="ton">ton</option><option value="application">application</option><option value="lb">lb</option></Select></div>
            </div>
          ) : null}
          <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={walks} data-testid="q-walks" onChange={(e) => setWalks(e.target.checked)} /> Walks</label>
          {walks ? <div className="ml-6"><Label htmlFor="q-walks-price">Price per visit ($)</Label><Input id="q-walks-price" type="number" step="0.01" min="0.01" value={walksPrice} data-testid="q-walks-price" onChange={(e) => setWalksPrice(e.target.value)} /></div> : null}
          <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={haul} data-testid="q-haul" onChange={(e) => setHaul(e.target.checked)} /> Haul snow away</label>
          {haul ? <div className="ml-6"><Label htmlFor="q-haul-rate">Hourly rate ($)</Label><Input id="q-haul-rate" type="number" step="0.01" min="0.01" value={haulRate} data-testid="q-haul-rate" onChange={(e) => setHaulRate(e.target.value)} /></div> : null}
        </fieldset>
        {replaces ? <p className="rounded-md bg-warn-tint p-2 text-xs text-warn-ink" data-testid="q-replaces">This lot already has a signed contract for {season.trim()}. If the customer accepts this quote, it replaces that one. Seasonal installments already billed count toward the new price, and the rest of it is split over the installments left.</p> : null}
      </div>
      {(price !== '' || !plow) && problem ? <p className="mt-2 text-sm text-danger" data-testid="q-problem">{problem}</p> : null}
      <Button className="mt-3 w-full" disabled={busy || Boolean(problem) || !season.trim()} data-testid="q-send" onClick={() => void make(true)}>Send quote</Button>
      {/* For a quote handed over in person or sent from the office's own phone: nothing is emailed or texted (issue 92). */}
      <Button variant="outline" className="mt-2 w-full" disabled={busy || Boolean(problem) || !season.trim()} data-testid="q-link-only" onClick={() => void make(false)}>Get link only, don&apos;t send</Button>
      {error ? <p className="mt-2 text-sm text-danger" role="alert">{error}</p> : null}
      {url ? <div className="mt-2"><Label>{sent ? 'Quote link. Share it if the customer has no email on file.' : 'Quote link. Nothing was sent, so share it with the customer.'}</Label><Input readOnly value={url} data-testid="q-url" onFocus={(e) => e.currentTarget.select()} /><div className="mt-2 flex flex-wrap items-center gap-2"><CopyLink url={url} testId="q-copy" />{share ? <TextIt share={share} testId="q-text-it" /> : null}</div>{lots > 1 ? <p className="mt-1 text-xs text-muted" data-testid="q-lots">The same link as this customer&apos;s other waiting quote{lots > 2 ? 's' : ''}: it covers all {lots} properties, and one signature accepts them all.</p> : null}</div> : null}
    </Card>
  );
}

export interface ContractRow { id: string; status: string; season: string; services: any[]; salt_pricing: any; accepted_name: string | null; accepted_at: string | null; created_at: string | null; installments_billed: number; quote_url?: string | null; quote_share?: Share | null; decline_reason?: string | null; prior?: PriorBilled | null; in_force?: boolean }

const TONE: Record<string, 'green' | 'amber' | 'gray' | 'blue' | 'red'> = { accepted: 'green', sent: 'blue', draft: 'amber', void: 'gray', declined: 'red' };

/** What each contract says, and what the office can still do with it: resend a quote, or void it. */
export function ContractList({ contracts, canEdit, pdf }: { contracts: ContractRow[]; canEdit: boolean; pdf: string | null }) {
  const router = useRouter();
  const [ask, dialog] = useConfirm();
  const [links, setLinks] = useState<Record<string, { url: string; share?: Share }>>({});
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
            <div className="flex flex-wrap items-center gap-2"><Badge tone={TONE[k.status] ?? 'gray'}>{k.status === 'sent' ? 'quote sent' : k.status}</Badge><span className="font-medium">{k.season}</span>{k.in_force ? <Badge tone="blue" data-testid="in-force">prices storms this winter</Badge> : null}</div>
            <ul className="mt-1 text-ink-2">{k.services.map((s, i) => <li key={i}>{scopeLine(s, k.salt_pricing, k.prior)}</li>)}</ul>
            {k.status === 'declined' ? <div className="text-ink-2" data-testid="declined-note">Declined by the customer{k.decline_reason ? `: "${k.decline_reason}"` : '.'} Send a new quote to try again.</div> : null}
            {k.accepted_name ? <div className="text-muted">Signed by {k.accepted_name}{k.installments_billed ? `. ${k.installments_billed} installment${k.installments_billed === 1 ? '' : 's'} billed.` : '.'}</div> : null}
            {links[k.id] ? <><Input readOnly value={links[k.id]!.url} className="mt-1" data-testid="resent-url" aria-label="New quote link" onFocus={(e) => e.target.select()} /><div className="mt-1 flex flex-wrap items-center gap-2"><CopyLink url={links[k.id]!.url} testId="contract-copy" />{links[k.id]!.share ? <TextIt share={links[k.id]!.share!} testId="contract-text-it" /> : null}</div></>
              : k.quote_url ? <><Input readOnly value={k.quote_url} className="mt-1" data-testid="quote-link" aria-label="Quote link" onFocus={(e) => e.target.select()} /><div className="mt-1 flex flex-wrap items-center gap-2"><CopyLink url={k.quote_url} testId="contract-copy" />{k.quote_share ? <TextIt share={k.quote_share} testId="contract-text-it" /> : null}</div></> : null}
            {canEdit && k.status !== 'void' ? (
              <div className="mt-1 flex flex-wrap gap-2">
                {k.status === 'draft' || k.status === 'sent' ? <Button size="sm" variant="outline" disabled={busy} data-testid="contract-resend" onClick={() => void run(async () => {
                  const out = await api<{ url: string; share?: Share }>(`/api/contracts/${k.id}/resend`, { method: 'POST' });
                  setLinks((all) => ({ ...all, [k.id]: out }));
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
      {pdf ? <ButtonA size="sm" className="mt-2" href={pdf} data-testid="contract-pdf">Signed contract PDF</ButtonA> : null}
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

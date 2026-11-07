'use client';

import { Button, Card, Input, Label, Select } from '@flake/ui';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { api, dollarsToCents } from '@/lib/client';

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

/** Renewals and price changes. The newest accepted contract is the one that prices visits. */
export function NewQuote({ siteId, defaultSeason, saltCents }: { siteId: string; defaultSeason: string; saltCents: number }) {
  const [type, setType] = useState<PricingType>('per_push');
  const [price, setPrice] = useState('');
  const [trigger, setTrigger] = useState(2);
  const [season, setSeason] = useState(defaultSeason);
  const [salt, setSalt] = useState(false);
  const [url, setUrl] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  return (
    <Card>
      <h2 className="font-semibold">Send a new quote</h2>
      <div className="mt-2 space-y-2">
        <div><Label htmlFor="q-type">Pricing</Label><Select id="q-type" value={type} data-testid="q-type" onChange={(e) => setType(e.target.value as PricingType)}><option value="per_push">Per push</option><option value="per_inch_tier">Per inch tiers (price is the first tier)</option><option value="per_event">Per event</option><option value="seasonal">Seasonal (5 installments)</option><option value="hourly">Hourly</option></Select></div>
        <div><Label htmlFor="q-price">Price ($)</Label><Input id="q-price" type="number" step="0.01" min="0" value={price} data-testid="q-price" onChange={(e) => setPrice(e.target.value)} /></div>
        <div><Label htmlFor="q-trigger">Trigger depth (in)</Label><Input id="q-trigger" type="number" step="0.5" value={trigger} onChange={(e) => setTrigger(Number(e.target.value))} /></div>
        <div><Label htmlFor="q-season">Season</Label><Input id="q-season" value={season} onChange={(e) => setSeason(e.target.value)} /></div>
        <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={salt} onChange={(e) => setSalt(e.target.checked)} /> Include salt per 50 lb bag</label>
      </div>
      <Button className="mt-3 w-full" disabled={!price} data-testid="q-send" onClick={async () => {
        setError(null);
        try {
          const services = [{ service: 'plow', trigger_in: trigger, pricing: pricing(type, dollarsToCents(price)) }, ...(salt ? [{ service: 'salt', trigger_in: null }] : [])];
          const out = await api('/api/quotes', { body: { site_id: siteId, season, services, salt_pricing: salt ? { unit: 'bag50lb', amount_cents: saltCents } : null, send: true } });
          setUrl(out.url);
        } catch (e) {
          setError((e as Error).message);
        }
      }}>Send quote</Button>
      {error ? <p className="mt-2 text-sm text-red-700" role="alert">{error}</p> : null}
      {url ? <div className="mt-2"><Label>Quote link. Share it if the customer has no email on file.</Label><Input readOnly value={url} data-testid="q-url" /></div> : null}
    </Card>
  );
}

export function RetireSite({ siteId, customerId, active }: { siteId: string; customerId: string; active: boolean }) {
  const router = useRouter();
  const [confirming, setConfirming] = useState(false);
  const [retireError, setRetireError] = useState<string | null>(null);
  if (!active) return <p className="text-sm text-slate-600" data-testid="site-retired">This site is retired. Its records stay on file, and it won&apos;t join new storms.</p>;
  if (!confirming) return <Button variant="ghost" data-testid="retire" onClick={() => setConfirming(true)}>Retire this site</Button>;
  return (
    <div className="flex flex-wrap items-center gap-2 text-sm">
      <span>It leaves new storms. Its records stay on file.</span>
      <Button variant="danger" size="sm" data-testid="retire-confirm" onClick={async () => { setRetireError(null); try { await api(`/api/sites/${siteId}`, { method: 'DELETE' }); router.push(`/customers/${customerId}`); router.refresh(); } catch (e) { setRetireError((e as Error).message); } }}>Retire</Button>
      <Button variant="ghost" size="sm" onClick={() => setConfirming(false)}>Cancel</Button>
      {retireError ? <p className="mt-2 text-sm text-red-700" role="alert">{retireError}</p> : null}
    </div>
  );
}

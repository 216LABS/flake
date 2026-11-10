'use client';

import { currentSeason } from '@flake/core/time';
import { NEGATIVE_AMOUNT } from '@flake/contracts';
import { Button, Card, Input, Label, Select, Textarea } from '@flake/ui';
import { useState } from 'react';

const SERVICES = ['plow', 'salt', 'walks', 'haul'] as const;

export function ContractBuilder() {
  const [f, setF] = useState({ company: '', client: '', site: '', season_start: `November 1, ${currentSeason().slice(0, 4)}`, season_end: `April 15, ${Number(currentSeason().slice(0, 4)) + 1}`, trigger_in: 2, pricing_type: 'per_push', price_text: '', salt_text: '', insurance_text: 'Contractor carries general liability insurance and will provide a certificate on request.', payment_terms: 'Net 30', email: '' });
  const [services, setServices] = useState<string[]>(['plow']);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const set = (k: keyof typeof f, v: string | number) => setF({ ...f, [k]: v });
  const missing = [!f.company.trim() && 'your company', !f.client.trim() && 'the client', !f.site.trim() && 'the site address', !f.price_text.trim() && 'a price', !services.length && 'at least one service'].filter(Boolean) as string[];
  const problem = NEGATIVE_AMOUNT.test(f.price_text) ? "The price can't be negative." : NEGATIVE_AMOUNT.test(f.salt_text) ? "The salt price can't be negative." : !(f.trigger_in >= 0 && f.trigger_in <= 48) ? 'The trigger depth must be 0 to 48 inches.' : null;
  const ready = !missing.length && !problem;
  const submit = async () => {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch('/api/tools/contract', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ...f, services, email: f.email || null }) });
      if (!res.ok) throw new Error(((await res.json().catch(() => null)) as { error?: string } | null)?.error ?? 'Could not build the PDF');
      const url = URL.createObjectURL(await res.blob());
      const a = document.createElement('a');
      a.href = url;
      a.download = 'snow-removal-contract.pdf';
      a.click();
      URL.revokeObjectURL(url);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  return (
    <Card className="mt-6">
      <div className="grid gap-3 sm:grid-cols-2">
        <div><Label htmlFor="company">Your company</Label><Input id="company" data-testid="t-company" value={f.company} onChange={(e) => set('company', e.target.value)} /></div>
        <div><Label htmlFor="client">Client</Label><Input id="client" data-testid="t-client" value={f.client} onChange={(e) => set('client', e.target.value)} /></div>
        <div className="sm:col-span-2"><Label htmlFor="site">Site address</Label><Input id="site" data-testid="t-site" value={f.site} onChange={(e) => set('site', e.target.value)} /></div>
        <div><Label htmlFor="start">Season start</Label><Input id="start" value={f.season_start} onChange={(e) => set('season_start', e.target.value)} /></div>
        <div><Label htmlFor="end">Season end</Label><Input id="end" value={f.season_end} onChange={(e) => set('season_end', e.target.value)} /></div>
        <fieldset className="sm:col-span-2"><legend className="mb-1 text-sm font-medium text-slate-700">Services</legend>
          <div className="flex flex-wrap gap-4 text-sm">{SERVICES.map((s) => <label key={s} className="flex items-center gap-1 capitalize"><input type="checkbox" checked={services.includes(s)} onChange={(e) => setServices(e.target.checked ? [...services, s] : services.filter((x) => x !== s))} /> {s}</label>)}</div>
        </fieldset>
        <div><Label htmlFor="trigger">Trigger depth (inches)</Label><Input id="trigger" type="number" step="0.5" min={0} max={48} value={f.trigger_in} onChange={(e) => set('trigger_in', Number(e.target.value))} />{f.trigger_in === 0 ? <p className="mt-1 text-xs text-amber-900" data-testid="t-zero">0 means zero tolerance: service starts with any measurable snow.</p> : null}</div>
        <div><Label htmlFor="ptype">Pricing type</Label><Select id="ptype" value={f.pricing_type} onChange={(e) => set('pricing_type', e.target.value)}><option value="per_push">Per push</option><option value="per_inch_tier">Per inch tiers</option><option value="per_event">Per event</option><option value="seasonal">Seasonal</option><option value="hourly">Hourly</option></Select></div>
        <div className="sm:col-span-2"><Label htmlFor="price">Price</Label><Input id="price" data-testid="t-price" placeholder="$65 per push" value={f.price_text} onChange={(e) => set('price_text', e.target.value)} /></div>
        <div className="sm:col-span-2"><Label htmlFor="salt">Salt (optional)</Label><Input id="salt" placeholder="$18 per 50 lb bag" value={f.salt_text} onChange={(e) => set('salt_text', e.target.value)} /></div>
        <div className="sm:col-span-2"><Label htmlFor="ins">Liability and insurance</Label><Textarea id="ins" rows={2} value={f.insurance_text} onChange={(e) => set('insurance_text', e.target.value)} /></div>
        <div><Label htmlFor="terms">Payment terms</Label><Input id="terms" value={f.payment_terms} onChange={(e) => set('payment_terms', e.target.value)} /></div>
        <div><Label htmlFor="em">Email (optional)</Label><Input id="em" type="email" data-testid="t-email" value={f.email} onChange={(e) => set('email', e.target.value)} /></div>
      </div>
      {error ? <p className="mt-2 text-sm text-red-700" role="alert">{error}</p> : null}
      {problem ? <p className="mt-2 text-sm text-red-700" data-testid="t-problem">{problem}</p> : null}
      {missing.length ? <p className="mt-2 text-sm text-slate-600" data-testid="t-missing">To download, add {missing.length > 1 ? `${missing.slice(0, -1).join(', ')} and ${missing.at(-1)}` : missing[0]}.</p> : null}
      <Button variant="accent" className="mt-4" disabled={!ready || busy} onClick={() => void submit()} data-testid="t-download">Download PDF</Button>
      <p className="mt-3 text-xs text-slate-500">Not legal advice. Want this contract to run itself? Flake tracks every visit against it, free.</p>
    </Card>
  );
}

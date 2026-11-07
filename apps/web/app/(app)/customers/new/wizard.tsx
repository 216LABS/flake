'use client';

import { suggestPrice, type RateCard } from '@flake/core/quote';
import { Badge, Button, Card, Input, Label, PageHeader, Select } from '@flake/ui';
import { useRouter } from 'next/navigation';
import { useEffect, useMemo, useRef, useState } from 'react';
import type { MultiPolygon, Polygon } from 'geojson';
import { api, dollarsToCents, money } from '@/lib/client';
import { uploadPinPhoto } from '@/lib/shrink-image';
import { MapView, type MapMode, type TileLayers } from '@/components/map-view';

const STEPS = ['Customer', 'Property', 'Pricing', 'Pins', 'Route', 'Quote'];
const PIN_KINDS = ['stake', 'pile', 'ada', 'entrance', 'hazard', 'other'];
type PricingType = 'per_push' | 'per_inch_tier' | 'per_event' | 'seasonal' | 'hourly';

export function Wizard({ layers, rateCard, routes, existing }: { layers: TileLayers; rateCard: RateCard; routes: { id: string; name: string; site_ids: string[] }[]; existing?: { id: string; name: string; kind: string; email: string } }) {
  const router = useRouter();
  const firstStep = existing ? 1 : 0;
  const [step, setStep] = useState(firstStep);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [c, setC] = useState({ name: existing?.name ?? '', kind: existing?.kind ?? 'commercial', contact_name: '', phone_e164: '', email: existing?.email ?? '', billing_mode: 'card_on_file' });
  const [address, setAddress] = useState('');
  const [hit, setHit] = useState<{ label: string; lat: number; lon: number } | null>(null);
  const [estimate, setEstimate] = useState<{ sqft: number | null; method: string; attribution: string[]; parcel_id?: string; county?: string } | null>(null);
  const [polygon, setPolygon] = useState<Polygon | MultiPolygon | null>(null);
  const [sqft, setSqft] = useState<number | null>(null);
  const [mapMode, setMapMode] = useState<MapMode>('view');
  const [walkLf, setWalkLf] = useState(0);
  const [label, setLabel] = useState('');
  const [openBy, setOpenBy] = useState('');
  const [notes, setNotes] = useState('');
  const [pricingType, setPricingType] = useState<PricingType>('per_push');
  const [trigger, setTrigger] = useState(2);
  const [withSalt, setWithSalt] = useState(false);
  const [price, setPrice] = useState('');
  const [season, setSeason] = useState('2026-27');
  const [pins, setPins] = useState<{ kind: string; lat: number; lon: number; note: string; file?: File }[]>([]);
  const [suggestions, setSuggestions] = useState<{ label: string; lat: number; lon: number }[]>([]);
  const [photoNote, setPhotoNote] = useState<string | null>(null);
  const [pinKind, setPinKind] = useState('stake');
  const [routeId, setRouteId] = useState('');
  const [position, setPosition] = useState('');
  const [quoteUrl, setQuoteUrl] = useState<string | null>(null);
  const [emailed, setEmailed] = useState(false);
  const saved = useRef<{ customerId?: string; siteId?: string; pins: number; routed: boolean }>({ customerId: existing?.id, pins: 0, routed: false });

  const suggestion = useMemo(() => suggestPrice({ sqft: sqft ?? 0, walks_lf: walkLf }, rateCard), [sqft, walkLf, rateCard]);
  const suggested = pricingType === 'per_event' ? suggestion.per_event_cents : pricingType === 'seasonal' ? suggestion.seasonal_cents : pricingType === 'hourly' ? 12000 : suggestion.per_push_cents;
  useEffect(() => {
    setPrice((suggested / 100).toFixed(2));
  }, [suggested]);

  // Type-ahead, after a pause in typing. Stale answers are dropped, and a miss just leaves the Find button.
  const picked = useRef<string | null>(null);
  useEffect(() => {
    const q = address.trim();
    if (q.length < 3 || q === picked.current) {
      setSuggestions([]);
      return;
    }
    let stale = false;
    const timer = setTimeout(async () => {
      const out = await api<{ hits: { label: string; lat: number; lon: number }[] }>('/api/sites/suggest', { body: { q } }).catch(() => ({ hits: [] }));
      if (!stale) setSuggestions(out.hits);
    }, 300);
    return () => {
      stale = true;
      clearTimeout(timer);
    };
  }, [address]);

  const choose = (s: { label: string; lat: number; lon: number }) => {
    picked.current = s.label;
    setAddress(s.label);
    setSuggestions([]);
    void measure(s, s.label);
  };

  const find = async () => {
    setError(null);
    setSuggestions([]);
    picked.current = address.trim();
    setBusy(true);
    try {
      const { hits } = await api<{ hits: { label: string; lat: number; lon: number }[] }>('/api/sites/geocode', { body: { q: address } });
      if (!hits[0]) throw new Error('We could not find that address. Check the street and city.');
      await measure(hits[0], address);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const measure = async (place: { label: string; lat: number; lon: number }, text: string) => {
    setError(null);
    setBusy(true);
    try {
      setHit(place);
      if (!label) setLabel(text.split(',')[0] ?? text);
      const landUse = c.kind === 'residential' ? 'residential' : 'commercial';
      const m = await api('/api/sites/measure', { body: { lat: place.lat, lon: place.lon, land_use: landUse } });
      setEstimate({ sqft: m.estimateSqft, method: m.method, attribution: m.attribution, parcel_id: m.parcel?.id, county: m.parcel?.county });
      setPolygon(m.suggestedPolygon);
      setSqft(m.estimateSqft);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const pricingBody = () => {
    const cents = dollarsToCents(price);
    switch (pricingType) {
      case 'per_push': return { type: 'per_push', amount_cents: cents };
      case 'per_event': return { type: 'per_event', amount_cents: cents };
      case 'hourly': return { type: 'hourly', rate_cents: cents };
      case 'seasonal': return { type: 'seasonal', total_cents: cents, installments: 5 };
      case 'per_inch_tier': return { type: 'per_inch_tier', tiers: suggestion.tiers };
    }
  };

  const finish = async () => {
    setBusy(true);
    setError(null);
    try {
      // Each step remembers it finished, so pressing Send again after an error picks up where it stopped.
      saved.current.customerId ??= (await api('/api/customers', { body: c })).id;
      saved.current.siteId ??= (await api('/api/sites', {
        body: {
          customer_id: saved.current.customerId, label: label || address, address: hit!.label.replace(' (mock geocode)', ''), lat: hit!.lat, lon: hit!.lon,
          parcel_id: estimate?.parcel_id ?? null, parcel_county: estimate?.county ?? null, area_estimate_sqft: estimate?.sqft ?? null, area_confirmed_sqft: sqft, polygons: polygon,
          walk_lf: walkLf || null, notes, service_window: openBy ? { open_by: openBy } : null,
        },
      })).id;
      const siteId = saved.current.siteId!;
      for (const { file, ...p } of pins.slice(saved.current.pins)) {
        const pin = await api('/api/pins', { body: { site_id: siteId, ...p } });
        saved.current.pins++;
        // A photo that won't upload shouldn't stop the quote. It can be added from the site page.
        if (file) await uploadPinPhoto(pin.id, file).catch(() => setPhotoNote('A pin photo did not upload. You can add it from the site page.'));
      }
      if (routeId && !saved.current.routed) {
        const r = routes.find((x) => x.id === routeId)!;
        const at = position ? Math.max(0, Number(position) - 1) : r.site_ids.length;
        const ids = [...r.site_ids];
        ids.splice(at, 0, siteId);
        await api(`/api/routes/${routeId}`, { method: 'PATCH', body: { site_ids: ids } });
        saved.current.routed = true;
      }
      const services = [
        { service: 'plow', trigger_in: trigger, pricing: pricingBody() },
        ...(withSalt ? [{ service: 'salt', trigger_in: null }] : []),
      ];
      const out = await api('/api/quotes', { body: { site_id: siteId, season, services, salt_pricing: withSalt ? { unit: 'bag50lb', amount_cents: suggestion.salt_bag_cents } : null, send: true } });
      setEmailed(Boolean(out.emailed && c.email));
      setQuoteUrl(out.url);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  if (quoteUrl) {
    return (
      <Card className="mx-auto max-w-xl" data-testid="quote-sent">
        <h1 className="text-xl font-semibold">{emailed ? 'Quote sent' : 'Quote ready'}</h1>
        <p className="mt-1 text-sm text-slate-600" data-testid="quote-note">{emailed ? 'We emailed the customer a link. You can also share it directly.' : 'Nothing was emailed, so share this link with the customer.'}</p>
        {photoNote ? <p className="mt-1 text-sm text-amber-800">{photoNote}</p> : null}
        <Input readOnly className="mt-3" value={quoteUrl} data-testid="quote-url" />
        <div className="mt-4 flex gap-2">
          <Button variant="accent" onClick={() => router.push('/customers')}>Done</Button>
        </div>
      </Card>
    );
  }

  const canNext = [Boolean(c.name), Boolean(hit), Boolean(price), true, true][step] ?? true;
  return (
    <>
      <PageHeader title={existing ? `Add a site for ${existing.name}` : 'New customer'} subtitle={`Step ${step + 1} of ${STEPS.length}: ${STEPS[step]}`} />
      <Card className="max-w-3xl">
        {step === 0 ? (
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="sm:col-span-2"><Label htmlFor="name">Name</Label><Input id="name" data-testid="c-name" value={c.name} onChange={(e) => setC({ ...c, name: e.target.value })} /></div>
            <div><Label htmlFor="kind">Kind</Label>
              <Select id="kind" value={c.kind} onChange={(e) => setC({ ...c, kind: e.target.value })}><option value="commercial">Commercial</option><option value="residential">Residential</option><option value="hoa">HOA</option></Select>
            </div>
            <div><Label htmlFor="billing">Billing</Label>
              <Select id="billing" value={c.billing_mode} onChange={(e) => setC({ ...c, billing_mode: e.target.value })}><option value="card_on_file">Card on file</option><option value="ach_on_file">Bank (ACH) on file</option><option value="invoice_net30">Net-30 invoice</option><option value="manual">Manual</option></Select>
            </div>
            <div><Label htmlFor="contact">Contact</Label><Input id="contact" value={c.contact_name} onChange={(e) => setC({ ...c, contact_name: e.target.value })} /></div>
            <div><Label htmlFor="email">Email</Label><Input id="email" type="email" data-testid="c-email" value={c.email} onChange={(e) => setC({ ...c, email: e.target.value })} /></div>
            <div><Label htmlFor="phone">Mobile (+1...)</Label><Input id="phone" placeholder="+12165550123" value={c.phone_e164} onChange={(e) => setC({ ...c, phone_e164: e.target.value })} /></div>
          </div>
        ) : null}
        {step === 1 ? (
          <div>
            <Label htmlFor="address">Address</Label>
            <div className="flex gap-2"><Input id="address" data-testid="address" value={address} placeholder="14701 Detroit Ave, Lakewood, OH" onChange={(e) => setAddress(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && void find()} autoComplete="off" /><Button disabled={busy || address.trim().length < 3} data-testid="find" onClick={() => void find()}>Find</Button></div>
            {suggestions.length ? (
              <ul className="mt-1 rounded-md border border-slate-200 bg-white shadow-xs" aria-label="Address suggestions">
                {suggestions.map((s) => <li key={s.label}><button type="button" className="block min-h-11 w-full px-3 py-2 text-left text-sm hover:bg-slate-50" data-testid="address-suggestion" onClick={() => choose(s)}>{s.label}</button></li>)}
                <li className="px-3 py-1 text-xs text-slate-500">Suggestions © OpenStreetMap contributors</li>
              </ul>
            ) : null}
            {hit ? (
              <div className="mt-3">
                <div className="flex flex-wrap items-center gap-2 text-sm">
                  <Badge tone="amber" data-testid="estimate-label">Estimate, drag to adjust</Badge>
                  <span data-testid="sqft">{sqft === null ? 'Area unavailable. Draw it or type it.' : `${sqft.toLocaleString()} sq ft`}</span>
                  {estimate?.method === 'osm_parking' ? <span className="text-slate-500">from mapped parking</span> : null}
                  {estimate?.method === 'parcel_ratio' ? <span className="text-slate-500">from parcel size</span> : null}
                </div>
                <div className="mt-2 flex flex-wrap gap-2">
                  <Button size="sm" variant={mapMode === 'edit' ? 'accent' : 'outline'} onClick={() => setMapMode(mapMode === 'edit' ? 'view' : 'edit')}>Draw / edit area</Button>
                  <Button size="sm" variant="outline" onClick={() => { setPolygon(null); setSqft(null); setMapMode('edit'); }}>Clear</Button>
                  <Button size="sm" variant={mapMode === 'walk' ? 'accent' : 'outline'} onClick={() => setMapMode(mapMode === 'walk' ? 'view' : 'walk')}>Measure walks</Button>
                </div>
                <div className="mt-2"><MapView layers={layers} base="satellite" center={{ lat: hit.lat, lon: hit.lon }} zoom={18} polygon={polygon} mode={mapMode} onPolygon={(p, a) => { setPolygon(p); setSqft(a); }} onWalk={setWalkLf} /></div>
                <div className="mt-3 grid gap-3 sm:grid-cols-3">
                  <div><Label htmlFor="area">Area (sq ft)</Label><Input id="area" type="number" value={sqft ?? ''} onChange={(e) => setSqft(e.target.value ? Number(e.target.value) : null)} /></div>
                  <div><Label htmlFor="walks">Walks (ft)</Label><Input id="walks" type="number" value={walkLf || ''} onChange={(e) => setWalkLf(Number(e.target.value))} /></div>
                  <div><Label htmlFor="openby">Open by</Label><Input id="openby" type="time" value={openBy} onChange={(e) => setOpenBy(e.target.value)} /></div>
                  <div className="sm:col-span-3"><Label htmlFor="label">Site label</Label><Input id="label" value={label} onChange={(e) => setLabel(e.target.value)} /></div>
                  <div className="sm:col-span-3"><Label htmlFor="notes">Notes for the driver</Label><Input id="notes" value={notes} onChange={(e) => setNotes(e.target.value)} /></div>
                </div>
                {estimate?.attribution.length ? <p className="mt-2 text-xs text-slate-500">Data: {estimate.attribution.join('; ')}</p> : null}
              </div>
            ) : null}
          </div>
        ) : null}
        {step === 2 ? (
          <div className="grid gap-3 sm:grid-cols-2">
            <div><Label htmlFor="ptype">Pricing</Label>
              <Select id="ptype" data-testid="pricing-type" value={pricingType} onChange={(e) => setPricingType(e.target.value as PricingType)}>
                <option value="per_push">Per push</option><option value="per_inch_tier">Per inch tiers</option><option value="per_event">Per event</option><option value="seasonal">Seasonal (5 installments)</option><option value="hourly">Hourly</option>
              </Select>
            </div>
            {pricingType === 'per_inch_tier' ? (
              <div><Label>Tiers from your rate card</Label>
                <ul className="text-sm">{suggestion.tiers.map((t) => <li key={String(t.up_to_in)}>{t.up_to_in ? `Up to ${t.up_to_in}"` : 'Over that'}: {money(t.amount_cents)}</li>)}</ul>
              </div>
            ) : (
              <div><Label htmlFor="price">Price ($). Suggested from your rate card, editable.</Label><Input id="price" data-testid="price" type="number" step="0.01" value={price} onChange={(e) => setPrice(e.target.value)} /></div>
            )}
            <div><Label htmlFor="trigger">Trigger depth (in)</Label><Input id="trigger" type="number" step="0.5" value={trigger} onChange={(e) => setTrigger(Number(e.target.value))} /></div>
            <div><Label htmlFor="season">Season</Label><Input id="season" value={season} onChange={(e) => setSeason(e.target.value)} /></div>
            <label className="flex items-center gap-2 text-sm sm:col-span-2"><input type="checkbox" checked={withSalt} onChange={(e) => setWithSalt(e.target.checked)} /> Salt, {money(suggestion.salt_bag_cents)} per 50 lb bag</label>
          </div>
        ) : null}
        {step === 3 ? (
          <div>
            <p className="mb-2 text-sm text-slate-600">Optional. Pick a type, then tap the map to drop a pin drivers will see.</p>
            <div className="mb-2 flex flex-wrap gap-2">
              {PIN_KINDS.map((k) => <Button key={k} size="sm" variant={pinKind === k ? 'accent' : 'outline'} onClick={() => setPinKind(k)}>{k}</Button>)}
              <Button size="sm" variant="outline" data-testid="add-pin" onClick={() => hit && setPins([...pins, { kind: pinKind, lat: hit.lat, lon: hit.lon, note: '' }])}>Add at center</Button>
            </div>
            {hit ? <MapView layers={layers} base="satellite" center={{ lat: hit.lat, lon: hit.lon }} zoom={18} polygon={polygon} mode="pin" pins={pins.map((p, i) => ({ id: String(i), lat: p.lat, lon: p.lon, label: p.kind }))} onPin={(lat, lon) => setPins((list) => [...list, { kind: pinKind, lat, lon, note: '' }])} /> : null}
            <ul className="mt-2 space-y-1 text-sm">
              {pins.map((p, i) => (
                <li key={i} className="flex items-center gap-2"><Badge>{p.kind}</Badge><Input aria-label="Pin note" placeholder="Note" value={p.note} onChange={(e) => setPins(pins.map((x, j) => (j === i ? { ...x, note: e.target.value } : x)))} /><label className="cursor-pointer whitespace-nowrap text-sky-800 underline">{p.file ? 'Photo added' : 'Add photo'}<input type="file" accept="image/*" className="sr-only" data-testid="wizard-pin-photo" onChange={(e) => { const file = e.target.files?.[0]; if (file) setPins((list) => list.map((x, j) => (j === i ? { ...x, file } : x))); }} /></label><Button size="sm" variant="ghost" onClick={() => setPins(pins.filter((_, j) => j !== i))}>Remove</Button></li>
              ))}
            </ul>
          </div>
        ) : null}
        {step === 4 ? (
          <div className="grid gap-3 sm:grid-cols-2">
            <div><Label htmlFor="route">Add to route</Label>
              <Select id="route" data-testid="route-select" value={routeId} onChange={(e) => setRouteId(e.target.value)}><option value="">Not yet</option>{routes.map((r) => <option key={r.id} value={r.id}>{r.name} ({r.site_ids.length} stops)</option>)}</Select>
            </div>
            <div><Label htmlFor="pos">Position (blank for last)</Label><Input id="pos" type="number" min={1} value={position} onChange={(e) => setPosition(e.target.value)} /></div>
          </div>
        ) : null}
        {step === 5 ? (
          <div className="text-sm">
            <p><b>{c.name}</b>, {label || address}</p>
            <p>{sqft ? `${sqft.toLocaleString()} sq ft` : 'Area not set'}{walkLf ? `, ${walkLf} ft of walks` : ''}</p>
            <p>{pricingType.replace(/_/g, ' ')}{pricingType !== 'per_inch_tier' ? `: $${price}` : ''}, {trigger}&quot; trigger{withSalt ? ', plus salt' : ''}</p>
            <p className="mt-2 text-slate-600">Sending goes to {c.email || 'no email yet, so you will get a link to share'}. The customer sees the scope, price and terms, signs, and can put a card or bank account on file.</p>
          </div>
        ) : null}
        {error ? <p className="mt-3 text-sm text-red-700" role="alert">{error}</p> : null}
        <div className="mt-6 flex justify-between">
          <Button variant="ghost" disabled={step === firstStep} onClick={() => setStep(step - 1)}>Back</Button>
          {step < STEPS.length - 1 ? <Button variant="accent" disabled={!canNext} data-testid="next" onClick={() => setStep(step + 1)}>Next</Button> : <Button variant="accent" disabled={busy} data-testid="send-quote" onClick={() => void finish()}>Send quote</Button>}
        </div>
      </Card>
    </>
  );
}

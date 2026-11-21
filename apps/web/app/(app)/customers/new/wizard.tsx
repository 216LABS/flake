'use client';

import { quotingSeason } from '@flake/core/time';
import { quotableSeasons } from '@flake/contracts';
import { suggestPrice, type RateCard } from '@flake/core/quote';
import { Badge, Button, buttonVariants, Card, cn, Input, Label, PageHeader, Segmented, Select, Progress } from '@flake/ui';
import { proseLink } from '@/components/links';
import { CopyLink, TextIt } from '@/components/text-it';
import type { Share } from '@/lib/share';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { useEffect, useMemo, useRef, useState } from 'react';
import type { MultiPolygon, Polygon } from 'geojson';
import { api, dollarsToCents, money } from '@/lib/client';
import { pricingLabel } from '@/lib/labels';
import { uploadPinPhoto } from '@/lib/shrink-image';
import { MapView, type MapMode, type TileLayers } from '@/components/map-view';
import { customerProblem, toE164 } from '../[id]/customer-editor';
import { quoteProblem } from '../../sites/[id]/site-actions';
import { sameStreet, streetFits, tidyAddress } from '@flake/core/address';


const STEPS = ['Customer', 'Property', 'Pricing', 'Pins', 'Route', 'Quote'];
const PIN_KINDS = ['stake', 'pile', 'ada', 'entrance', 'hazard', 'other'];
const PIN_WORD: Record<string, string> = { stake: 'Stake', pile: 'Snow pile', ada: 'Accessible parking', entrance: 'Entrance', hazard: 'Hazard', other: 'Other' };
type PricingType = 'per_push' | 'per_inch_tier' | 'per_event' | 'seasonal' | 'hourly';

/** The same lot: the house number and the street, however the suffix is written. */
const sameLot = (a: string, b: string) => {
  const num = (s: string) => /^\s*(\d+[a-z]?)\b/i.exec(s)?.[1]?.toLowerCase();
  return Boolean(num(a)) && num(a) === num(b) && sameStreet(a, b);
};

export function Wizard({ layers, rateCard, routes, existing, others = [], knownLots = [], paymentsReady = false }: { paymentsReady?: boolean; others?: { id: string; name: string }[]; knownLots?: { customer_id: string; customer: string; label: string; address: string }[]; layers: TileLayers; rateCard: RateCard; routes: { id: string; name: string; site_ids: string[] }[]; existing?: { id: string; name: string; kind: string; email: string } }) {
  const router = useRouter();
  const firstStep = existing ? 1 : 0;
  // Each step is a history entry (?step=2), so the browser's Back, or a swipe back on a phone, goes to the step before
  // instead of leaving the wizard and losing what was typed (issue 144). A step not reached yet can't be opened by URL.
  const params = useSearchParams();
  const [reached, setReached] = useState(firstStep);
  const wanted = Number(params.get('step'));
  const step = Number.isInteger(wanted) && wanted >= firstStep ? Math.min(wanted, reached) : firstStep;
  const setStep = (n: number) => {
    setReached((r) => Math.max(r, n));
    const q = new URLSearchParams(window.location.search);
    q.set('step', String(n));
    window.history.pushState(null, '', `?${q.toString()}`);
  };
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [c, setC] = useState({ name: existing?.name ?? '', kind: existing?.kind ?? 'commercial', contact_name: '', phone_e164: '', email: existing?.email ?? '', billing_mode: paymentsReady ? 'card_on_file' : 'invoice_net30' });
  const twin = existing || !c.name.trim() ? null : others.find((o) => o.name.trim().toLowerCase() === c.name.trim().toLowerCase()) ?? null;
  const [address, setAddress] = useState('');
  const [hit, setHit] = useState<{ label: string; lat: number; lon: number } | null>(null);
  // What the office typed for the place they picked: the saved address keeps their street when the match differs (issue 210).
  const [hitText, setHitText] = useState('');
  const lotTwin = hit ? knownLots.find((l) => sameLot(l.address, hit.label.replace(' (mock geocode)', ''))) ?? null : null;
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
  // A price the office typed stays put when the lot size changes; picking another pricing type suggests again (issue 19).
  const [priceTyped, setPriceTyped] = useState(false);
  const [choices, setChoices] = useState<{ label: string; lat: number; lon: number }[]>([]);
  const [season, setSeason] = useState(() => quotingSeason());
  const [pins, setPins] = useState<{ kind: string; lat: number; lon: number; note: string; file?: File }[]>([]);
  const [suggestions, setSuggestions] = useState<{ label: string; lat: number; lon: number }[]>([]);
  const [photoNote, setPhotoNote] = useState<string | null>(null);
  const [pinKind, setPinKind] = useState('stake');
  // A company with no routes yet makes its first one right here, so the lot isn't left on none (first-run walk).
  const [routeId, setRouteId] = useState(routes.length ? '' : 'new');
  const [newRoute, setNewRoute] = useState('Route 1');
  const [position, setPosition] = useState('');
  const [quoteUrl, setQuoteUrl] = useState<string | null>(null);
  const [emailed, setEmailed] = useState(false);
  const [share, setShare] = useState<Share | null>(null);
  const [sendingOff, setSendingOff] = useState(false);
  const [lots, setLots] = useState(1);
  // A new step takes keyboard focus (issue 158), so the next Tab is inside it, not back at the skip link and the nav.
  const stepCard = useRef<HTMLDivElement>(null);
  const shownStep = useRef(step);
  useEffect(() => {
    if (shownStep.current === step) return;
    shownStep.current = step;
    const first = stepCard.current?.querySelector<HTMLElement>('input:not([type=hidden]):not([disabled]), select, textarea');
    (first ?? stepCard.current)?.focus();
  }, [step]);
  // Closing the tab or leaving the site mid-wizard asks first, while anything typed isn't saved yet.
  const dirty = !quoteUrl && Boolean((existing ? '' : c.name.trim()) || address.trim());
  useEffect(() => {
    if (!dirty) return;
    const warn = (e: BeforeUnloadEvent) => e.preventDefault();
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [dirty]);
  const saved = useRef<{ customerId?: string; siteId?: string; pins: number; routed: boolean }>({ customerId: existing?.id, pins: 0, routed: false });

  const suggestion = useMemo(() => suggestPrice({ sqft: sqft ?? 0, walks_lf: walkLf }, rateCard), [sqft, walkLf, rateCard]);
  const suggested = pricingType === 'per_event' ? suggestion.per_event_cents : pricingType === 'seasonal' ? suggestion.seasonal_cents : pricingType === 'hourly' ? 12000 : suggestion.per_push_cents;
  useEffect(() => {
    if (!priceTyped) setPrice((suggested / 100).toFixed(2));
  }, [suggested, priceTyped]);

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
      // Suggestions on the street that was typed come first (issue 210).
      if (!stale) setSuggestions([...out.hits.filter((h) => streetFits(q, h.label)), ...out.hits.filter((h) => !streetFits(q, h.label))]);
    }, 300);
    return () => {
      stale = true;
      clearTimeout(timer);
    };
  }, [address]);

  const choose = (s: { label: string; lat: number; lon: number }) => {
    setSuggestions([]);
    // A different street from the one typed gets the same check as Find (issue 210).
    if (!streetFits(address, s.label)) {
      picked.current = address.trim();
      setChoices([s]);
      return;
    }
    const typed = address;
    picked.current = s.label;
    setAddress(s.label);
    void measure(s, typed);
  };

  const find = async () => {
    setError(null);
    setSuggestions([]);
    picked.current = address.trim();
    setBusy(true);
    try {
      const found = (await api<{ hits: { label: string; lat: number; lon: number }[] }>('/api/sites/geocode', { body: { q: address } })).hits;
      if (!found[0]) throw new Error('We could not find that address. Check the street and city.');
      const hits = [...found.filter((h) => streetFits(address, h.label)), ...found.filter((h) => !streetFits(address, h.label))];
      // The lookup can land on a nearby street with the same name. Drivers go to what's saved, so the office picks.
      if (hits.length === 1 && sameStreet(address, hits[0]!.label)) await measure(hits[0]!, address);
      else setChoices(hits.slice(0, 5));
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const measure = async (place: { label: string; lat: number; lon: number }, text: string) => {
    setError(null);
    setChoices([]);
    setBusy(true);
    try {
      setHit(place);
      setHitText(text);
      if (!label) setLabel(tidyAddress(text, place.label.replace(' (mock geocode)', '')).split(',')[0]!);
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

  const finish = async (send = true) => {
    setBusy(true);
    setError(null);
    try {
      // Each step remembers it finished, so pressing Send again after an error picks up where it stopped.
      saved.current.customerId ??= (await api('/api/customers', { body: { ...c, name: c.name.trim(), phone_e164: toE164(c.phone_e164) } })).id;
      saved.current.siteId ??= (await api('/api/sites', {
        body: {
          customer_id: saved.current.customerId, label: label || address, address: tidyAddress(hitText, hit!.label.replace(' (mock geocode)', '')), lat: hit!.lat, lon: hit!.lon,
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
      if (routeId === 'new' && newRoute.trim() && !saved.current.routed) {
        // A new route holding just this lot.
        await api('/api/routes', { body: { name: newRoute.trim(), site_ids: [siteId] } });
        saved.current.routed = true;
      } else if (routeId && routeId !== 'new' && !saved.current.routed) {
        // Just this stop, so someone editing the same route at the same time keeps their change.
        await api(`/api/routes/${routeId}/stops`, { body: { site_id: siteId, ...(position ? { position: Math.max(1, Number(position)) } : {}) } });
        saved.current.routed = true;
      }
      const services = [
        { service: 'plow', trigger_in: trigger, pricing: pricingBody() },
        ...(withSalt ? [{ service: 'salt', trigger_in: null }] : []),
      ];
      const out = await api('/api/quotes', { body: { site_id: siteId, season, services, salt_pricing: withSalt ? { unit: 'bag50lb', amount_cents: suggestion.salt_bag_cents } : null, send } });
      setEmailed(send && Boolean(out.emailed && c.email));
      setSendingOff(send && Boolean(out.sending_off));
      setLots(out.lots ?? 1);
      setShare(out.share ?? null);
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
        <h1 className="text-3xl font-semibold tracking-tight">Quote ready</h1>
        <p className="mt-1 text-sm text-muted" data-testid="quote-note">{emailed ? 'We are emailing the customer this link. You can also share it directly.' : sendingOff ? 'Flake is not sending email or texts for your company yet, so nothing went out. Share this link with the customer.' : 'Nothing was emailed, so share this link with the customer.'}</p>
        {photoNote ? <p className="mt-1 text-sm text-warn-ink">{photoNote}</p> : null}
        {lots > 1 ? <p className="mt-1 text-sm" data-testid="quote-lots">This is the same link as their other quote{lots > 2 ? 's' : ''} waiting for a signature. It now covers all {lots} properties, and one signature accepts them all.</p> : null}
        <Input readOnly className="mt-3" value={quoteUrl} data-testid="quote-url" onFocus={(e) => e.currentTarget.select()} />
        <div className="mt-2 flex flex-wrap items-center gap-2"><CopyLink url={quoteUrl} testId="quote-copy" />{share && !emailed ? <TextIt share={share} testId="quote-text-it" /> : null}</div>
        <div className="mt-4 flex gap-2">
          <Button variant="accent" onClick={() => router.push('/customers')}>Done</Button>
        </div>
      </Card>
    );
  }

  const customerIssue = customerProblem(c);
  const priceIssue = pricingType === 'per_inch_tier' ? null : quoteProblem(price, trigger);
  const canNext = [!customerIssue, Boolean(hit), !priceIssue, true, true][step] ?? true;
  return (
    <>
      <PageHeader title={existing ? `Add a site for ${existing.name}` : 'New customer'} subtitle={`Step ${step + 1} of ${STEPS.length}: ${STEPS[step]}`} />
      <Progress className="mb-4 max-w-3xl" value={step + 1} max={STEPS.length} label="Steps finished" />
      <Card className="max-w-3xl" ref={stepCard} tabIndex={-1} aria-label={`Step ${step + 1}: ${STEPS[step]}`} data-testid="wizard-step">
        {step === 0 ? (
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="sm:col-span-2"><Label htmlFor="name">Name</Label><Input id="name" data-testid="c-name" value={c.name} onChange={(e) => setC({ ...c, name: e.target.value })} /></div>
            {twin ? <p className="text-sm text-warn-ink sm:col-span-2" data-testid="customer-twin">You already have a customer named {twin.name}. <Link className={proseLink} href={`/customers/new?customer=${twin.id}`}>Add this lot to them</Link>, or keep going to make a second customer.</p> : null}
            <Segmented label="Kind" name="kind" testId="kind" value={c.kind as 'commercial' | 'residential' | 'hoa'} options={[['commercial', 'Commercial'], ['residential', 'Residential'], ['hoa', 'HOA']] as const} onChange={(kind) => setC({ ...c, kind })} />
            <div><Label htmlFor="billing">Billing</Label>
              <Select id="billing" value={c.billing_mode} onChange={(e) => setC({ ...c, billing_mode: e.target.value })}><option value="card_on_file">Card on file</option><option value="ach_on_file">Bank (ACH) on file</option><option value="invoice_net30">Net-30 invoice</option><option value="manual">Manual</option></Select>
            </div>
            <div><Label htmlFor="contact">Contact name</Label><Input id="contact" value={c.contact_name} onChange={(e) => setC({ ...c, contact_name: e.target.value })} /></div>
            <div><Label htmlFor="email">Email</Label><Input id="email" type="email" data-testid="c-email" value={c.email} onChange={(e) => setC({ ...c, email: e.target.value })} /></div>
            <div><Label htmlFor="phone">Mobile</Label><Input id="phone" type="tel" autoComplete="off" placeholder="216-555-0123" value={c.phone_e164} onChange={(e) => setC({ ...c, phone_e164: e.target.value })} /></div>
            {customerIssue && (c.name || c.email || c.phone_e164) ? <p className="text-sm text-danger sm:col-span-2" data-testid="customer-problem">{customerIssue}</p> : null}
          </div>
        ) : null}
        {step === 1 ? (
          <div>
            <Label htmlFor="address">Address</Label>
            <div className="flex gap-2"><Input id="address" data-testid="address" value={address} placeholder="14701 Detroit Ave, Lakewood, OH" onChange={(e) => { setAddress(e.target.value); setChoices([]); }} onKeyDown={(e) => e.key === 'Enter' && void find()} autoComplete="off" /><Button disabled={busy || address.trim().length < 3} data-testid="find" onClick={() => void find()}>Find</Button></div>
            {suggestions.length ? (
              <ul className="mt-1 rounded-md border border-line-faint bg-surface shadow-xs" aria-label="Address suggestions">
                {suggestions.map((s) => <li key={s.label}><button type="button" className="block min-h-11 w-full px-3 py-2 text-left text-sm hover:bg-tint" data-testid="address-suggestion" onClick={() => choose(s)}>{s.label}</button></li>)}
                <li className="px-3 py-1 text-xs text-faint">Suggestions © OpenStreetMap contributors</li>
              </ul>
            ) : null}
            {choices.length ? (
              <div className="mt-2 rounded-md border border-warn-line bg-warn-tint p-3 text-sm" data-testid="address-choices">
                <p className="font-medium text-warn-ink">{choices.length === 1 ? 'We found a different street than you typed. Is this the place?' : 'We found more than one match. Which is the place?'}</p>
                <ul className="mt-2 space-y-1">
                  {choices.map((s) => <li key={s.label}><button type="button" className="block min-h-11 w-full rounded-sm bg-surface px-3 py-2 text-left hover:bg-tint" data-testid="address-choice" onClick={() => void measure(s, address)}>{s.label}</button></li>)}
                </ul>
                <p className="mt-2 text-xs text-muted">None of these? Fix the street name or add the city and ZIP, then Find again.</p>
              </div>
            ) : null}
            {hit ? (
              <div className="mt-3">
                {lotTwin && lotTwin.customer_id !== existing?.id ? <p className="mb-2 rounded-md bg-warn-tint p-2 text-sm text-warn-ink" data-testid="lot-twin">You already have {lotTwin.customer}&apos;s {lotTwin.label} at {lotTwin.address}. <Link className={proseLink} href={`/customers/${lotTwin.customer_id}`}>Open it instead</Link>, or keep going if this is a different lot.</p> : null}
                <p className="mb-2 text-sm" data-testid="address-saved">Address on file: <b>{tidyAddress(hitText, hit.label.replace(' (mock geocode)', ''))}</b>{streetFits(hitText, hit.label) ? null : <span className="ml-1 text-warn-ink" data-testid="address-differs">(the map found {hit.label.split(',')[0]}, so check the point on the map)</span>}</p>
                <div className="flex flex-wrap items-center gap-2 text-sm">
                  <Badge tone="amber" data-testid="estimate-label">Estimate, drag to adjust</Badge>
                  <span data-testid="sqft">{sqft === null ? 'Area unavailable. Draw it or type it.' : `${sqft.toLocaleString()} sq ft`}</span>
                  {estimate?.method === 'osm_parking' ? <span className="text-faint">from mapped parking</span> : null}
                  {estimate?.method === 'parcel_ratio' ? <span className="text-faint">from parcel size</span> : null}
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
                {estimate?.attribution.length ? <p className="mt-2 text-xs text-faint">Data: {estimate.attribution.join('; ')}</p> : null}
              </div>
            ) : null}
          </div>
        ) : null}
        {step === 2 ? (
          <div className="grid gap-3 sm:grid-cols-2">
            <div><Label htmlFor="ptype">Pricing</Label>
              <Select id="ptype" data-testid="pricing-type" value={pricingType} onChange={(e) => { setPricingType(e.target.value as PricingType); setPriceTyped(false); }}>
                <option value="per_push">Per push</option><option value="per_inch_tier">Per inch tiers</option><option value="per_event">Per event</option><option value="seasonal">Seasonal (5 installments)</option><option value="hourly">Hourly</option>
              </Select>
            </div>
            {pricingType === 'per_inch_tier' ? (
              <div><Label>Tiers from your rate card</Label>
                <ul className="text-sm">{suggestion.tiers.map((t) => <li key={String(t.up_to_in)}>{t.up_to_in ? `Up to ${t.up_to_in}"` : 'Over that'}: {money(t.amount_cents)}</li>)}</ul>
              </div>
            ) : (
              <div><Label htmlFor="price">{pricingType === 'seasonal' ? 'Season total ($), billed in 5 monthly installments.' : 'Price ($).'} Suggested from your rate card, editable.</Label><Input id="price" data-testid="price" type="number" step="0.01" min="0.01" max="100000" value={price} onChange={(e) => { setPriceTyped(true); setPrice(e.target.value); }} /></div>
            )}
            <div>
              <Label htmlFor="trigger">Trigger depth (in)</Label>
              <Input id="trigger" type="number" min={0} max={48} step="0.5" value={trigger} onChange={(e) => setTrigger(Math.min(48, Math.max(0, Number(e.target.value))))} aria-describedby="trigger-hint" />
              <p id="trigger-hint" className={trigger === 0 ? 'mt-1 text-xs text-warn-ink' : 'mt-1 text-xs text-muted'} data-testid="trigger-hint">{trigger === 0 ? `Zero tolerance: any measurable snow starts service${pricingType === 'seasonal' ? '' : ', so every dusting is billable'}.` : 'Set 0 for zero tolerance, any measurable snow.'}</p>
            </div>
            <div><Label htmlFor="season">Season</Label><Select id="season" value={season} onChange={(e) => setSeason(e.target.value)}>{[...new Set([season, ...quotableSeasons()])].sort().map((x) => <option key={x} value={x}>{x}</option>)}</Select></div>
            <label className="flex items-center gap-2 text-sm sm:col-span-2"><input type="checkbox" checked={withSalt} onChange={(e) => setWithSalt(e.target.checked)} /> Salt, {money(suggestion.salt_bag_cents)} per 50 lb bag</label>
            {priceIssue ? <p className="text-sm text-danger sm:col-span-2" data-testid="price-problem">{priceIssue}</p> : null}
          </div>
        ) : null}
        {step === 3 ? (
          <div>
            <p className="mb-2 text-sm text-muted">Optional. Pick a type, then tap the map to drop a pin drivers will see.</p>
            <div className="mb-2 flex flex-wrap gap-2">
              {PIN_KINDS.map((k) => <Button key={k} size="sm" variant={pinKind === k ? 'accent' : 'outline'} onClick={() => setPinKind(k)}>{PIN_WORD[k] ?? k}</Button>)}
              <Button size="sm" variant="outline" data-testid="add-pin" onClick={() => hit && setPins([...pins, { kind: pinKind, lat: hit.lat, lon: hit.lon, note: '' }])}>Add at center</Button>
            </div>
            {hit ? <MapView layers={layers} base="satellite" center={{ lat: hit.lat, lon: hit.lon }} zoom={18} polygon={polygon} mode="pin" pins={pins.map((p, i) => ({ id: String(i), lat: p.lat, lon: p.lon, label: p.kind }))} onPin={(lat, lon) => setPins((list) => [...list, { kind: pinKind, lat, lon, note: '' }])} /> : null}
            <ul className="mt-2 space-y-1 text-sm">
              {pins.map((p, i) => (
                <li key={i} className="flex items-center gap-2"><Badge>{p.kind}</Badge><Input aria-label="Pin note" placeholder="Note" value={p.note} onChange={(e) => setPins(pins.map((x, j) => (j === i ? { ...x, note: e.target.value } : x)))} /><label className={cn(buttonVariants({ variant: 'outline', size: 'sm' }), 'cursor-pointer focus-within:outline-2 focus-within:outline-offset-2 focus-within:outline-ink')}>{p.file ? 'Photo added' : 'Add photo'}<input type="file" accept="image/*" className="sr-only" data-testid="wizard-pin-photo" onChange={(e) => { const file = e.target.files?.[0]; if (file) setPins((list) => list.map((x, j) => (j === i ? { ...x, file } : x))); }} /></label><Button size="sm" variant="ghost" onClick={() => setPins(pins.filter((_, j) => j !== i))}>Remove</Button></li>
              ))}
            </ul>
          </div>
        ) : null}
        {step === 4 ? (
          <div className="grid gap-3 sm:grid-cols-2">
            <div><Label htmlFor="route">Add to route</Label>
              <Select id="route" data-testid="route-select" value={routeId} onChange={(e) => setRouteId(e.target.value)}><option value="">Not yet</option>{routes.map((r) => <option key={r.id} value={r.id}>{r.name} ({r.site_ids.length} stops)</option>)}<option value="new">New route...</option></Select>
            </div>
            {routeId === 'new' ? (
              <div><Label htmlFor="new-route-name">Route name</Label><Input id="new-route-name" maxLength={120} value={newRoute} onChange={(e) => setNewRoute(e.target.value)} data-testid="wizard-new-route" /></div>
            ) : routeId ? (
              <div><Label htmlFor="pos">Position (blank for last)</Label><Input id="pos" type="number" min={1} value={position} onChange={(e) => setPosition(e.target.value)} /></div>
            ) : null}
            <p className="text-xs text-muted sm:col-span-2">A storm sends each route to one truck. A lot on no route is left out of storms until you add it on the Routes page.</p>
          </div>
        ) : null}
        {step === 5 ? (
          <div className="text-sm">
            <p><b>{c.name}</b>, {label || address}</p>
            <p>{sqft ? `${sqft.toLocaleString()} sq ft` : 'Area not set'}{walkLf ? `, ${walkLf} ft of walks` : ''}</p>
            <p>{pricingLabel(pricingType)}{pricingType !== 'per_inch_tier' ? `: $${price}` : ''}, {trigger === 0 ? 'zero tolerance' : <>{trigger}&quot; trigger</>}{withSalt ? ', plus salt' : ''}</p>
            <p className="mt-2 text-muted">Sending goes to {c.email || 'no email yet, so you will get a link to share'}. The customer sees the scope, price and terms, and signs.{paymentsReady ? ' They can put a card or bank account on file.' : ' Payments are not connected yet, so they pay the way you set under How customers pay you.'}</p>
          </div>
        ) : null}
        {error ? <p className="mt-3 text-sm text-danger" role="alert">{error}</p> : null}
        <div className="mt-6 flex justify-between">
          {step > firstStep ? <Button variant="ghost" onClick={() => setStep(step - 1)}>Back</Button> : <span />}
          {step < STEPS.length - 1 ? <Button variant="accent" disabled={!canNext} data-testid="next" onClick={() => setStep(step + 1)}>Next</Button> : (
            <div className="flex flex-wrap justify-end gap-2">
              {/* Nothing is emailed or texted: for a quote handed over in person (issue 92). */}
              <Button variant="outline" disabled={busy} data-testid="link-only-quote" onClick={() => void finish(false)}>Get link only</Button>
              <Button variant="accent" disabled={busy} data-testid="send-quote" onClick={() => void finish()}>Send quote</Button>
            </div>
          )}
        </div>
      </Card>
    </>
  );
}

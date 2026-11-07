'use client';

import { Button, Card, Input, Label } from '@flake/ui';
import { Elements, PaymentElement, useElements, useStripe } from '@stripe/react-stripe-js';
import { loadStripe } from '@stripe/stripe-js';
import { useState } from 'react';
import { api, money } from '@/lib/client';

function priceText(p: any): string {
  if (!p) return 'priced per unit';
  switch (p.type) {
    case 'per_push': return `${money(p.amount_cents)} per push`;
    case 'per_event': return `${money(p.amount_cents)} per storm`;
    case 'hourly': return `${money(p.rate_cents)} per hour, rounded up to 15 minutes`;
    case 'seasonal': return `${money(p.total_cents)} for the season, in ${p.installments} installments`;
    case 'per_inch_tier': return p.tiers.map((t: any) => `${t.up_to_in ? `up to ${t.up_to_in}"` : 'above that'}: ${money(t.amount_cents)}`).join('; ');
    default: return '';
  }
}

export function QuotePage({ token, quote }: { token: string; quote: any }) {
  const [name, setName] = useState('');
  const [agree, setAgree] = useState(false);
  const [sms, setSms] = useState(false);
  const [emailOk, setEmailOk] = useState(true);
  const [phone, setPhone] = useState(quote.customer.phone ?? '');
  const [accepted, setAccepted] = useState(quote.contract.status === 'accepted');
  const [error, setError] = useState<string | null>(null);
  const [paid, setPaid] = useState(quote.has_payment_method);
  return (
    <main className="mx-auto max-w-2xl px-4 py-8">
      <p className="font-display text-lg font-semibold text-slate-900">{quote.company}</p>
      <h1 className="mt-1 text-4xl font-semibold leading-tight tracking-tight">Snow service for {quote.site.label}</h1>
      <p className="text-sm text-slate-600">{quote.site.address}{quote.site.area_sqft ? `. About ${Number(quote.site.area_sqft).toLocaleString()} sq ft.` : ''}</p>
      <Card className="mt-4">
        <h2 className="font-semibold">Scope and price, season {quote.contract.season}</h2>
        <ul className="mt-2 space-y-1 text-sm">
          {quote.contract.services.map((s: any, i: number) => (
            <li key={i} data-testid="scope-line"><b className="capitalize">{s.service}</b>: {s.service === 'salt' && quote.contract.salt_pricing ? `${money(quote.contract.salt_pricing.amount_cents)} per ${quote.contract.salt_pricing.unit === 'bag50lb' ? '50 lb bag' : quote.contract.salt_pricing.unit}` : priceText(s.pricing)}{s.trigger_in != null ? `. Starts at ${s.trigger_in}" of snow.` : ''}</li>
          ))}
        </ul>
        {quote.contract.terms_md ? <><h3 className="mt-3 text-sm font-semibold">Terms</h3><p className="mt-1 whitespace-pre-wrap text-sm text-slate-700">{quote.contract.terms_md}</p></> : null}
      </Card>
      {accepted ? (
        <Card className="mt-4 border-emerald-300 bg-emerald-50" data-testid="accepted"><p className="font-medium">Accepted{quote.contract.accepted_name ? ` by ${quote.contract.accepted_name}` : ''}. Thank you.</p></Card>
      ) : (
        <Card className="mt-4">
          <h2 className="font-semibold">Accept</h2>
          <Label className="mt-3" htmlFor="sig">Type your full name</Label>
          <Input id="sig" value={name} onChange={(e) => setName(e.target.value)} data-testid="sign-name" />
          <label className="mt-3 flex items-start gap-2 text-sm"><input type="checkbox" className="mt-1" checked={agree} onChange={(e) => setAgree(e.target.checked)} data-testid="agree" /> I agree to this scope, price and these terms, and my typed name is my signature.</label>
          <h3 className="mt-4 text-sm font-semibold">Service updates (optional)</h3>
          <label className="mt-2 flex items-start gap-2 text-sm"><input type="checkbox" className="mt-1" checked={sms} onChange={(e) => setSms(e.target.checked)} data-testid="consent-sms" /> {quote.consent_text}</label>
          {sms ? <div className="mt-2"><Label htmlFor="ph">Mobile number</Label><Input id="ph" value={phone} type="tel" placeholder="216-555-0123" onChange={(e) => setPhone(e.target.value)} /></div> : null}
          <label className="mt-2 flex items-start gap-2 text-sm"><input type="checkbox" className="mt-1" checked={emailOk} onChange={(e) => setEmailOk(e.target.checked)} data-testid="consent-email" /> Email me service updates.</label>
          {error ? <p className="mt-2 text-sm text-red-700" role="alert">{error}</p> : null}
          <Button variant="accent" className="mt-4 w-full" disabled={!agree || name.trim().length < 2} data-testid="accept" onClick={async () => {
            setError(null);
            try {
              await api(`/api/q/${token}/accept`, { body: { name, agree, consentSms: sms, consentEmail: emailOk, phone_e164: phone || null } });
              setAccepted(true);
            } catch (e) {
              setError((e as Error).message);
            }
          }}>Accept quote</Button>
        </Card>
      )}
      {accepted && quote.payments_ready && quote.customer.billing_mode !== 'manual' ? (
        paid ? <Card className="mt-4" data-testid="payment-saved"><p className="text-sm">Payment method saved. You&apos;re only charged after a storm, for the service you got.</p></Card> : <PaymentSetup token={token} onSaved={() => setPaid(true)} />
      ) : null}
      <p className="mt-8 text-center text-xs text-slate-600">Quotes and service records by Flake</p>
    </main>
  );
}

function PaymentSetup({ token, onSaved }: { token: string; onSaved: () => void }) {
  const [si, setSi] = useState<{ clientSecret: string; publishableKey: string | null; stripeAccount: string; mock: boolean } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const start = async () => {
    setError(null);
    try {
      setSi(await api(`/api/q/${token}/setup-intent`, { method: 'POST' }));
    } catch (e) {
      setError((e as Error).message);
    }
  };
  return (
    <Card className="mt-4">
      <h2 className="font-semibold">Card or bank account on file</h2>
      <p className="mt-1 text-sm text-slate-600">Bank account is often cheapest for the company. You&apos;re charged only after each storm.</p>
      {!si ? <Button className="mt-3" onClick={() => void start()} data-testid="add-payment">Add payment method</Button> : si.mock ? <MockElement token={token} onSaved={onSaved} /> : (
        <Elements stripe={loadStripe(si.publishableKey!, { stripeAccount: si.stripeAccount })} options={{ clientSecret: si.clientSecret }}><LiveElement onSaved={onSaved} /></Elements>
      )}
      {error ? <p className="mt-2 text-sm text-red-700" role="alert">{error}</p> : null}
    </Card>
  );
}

function MockElement({ token, onSaved }: { token: string; onSaved: () => void }) {
  const [card, setCard] = useState('4242424242424242');
  return (
    <div className="mt-3 rounded-md border border-amber-300 bg-amber-50 p-3">
      <p className="text-xs text-amber-900">Mock payment form. No real card is used. A number ending 0002 will decline later.</p>
      <Label className="mt-2" htmlFor="card">Test card number</Label>
      <Input id="card" value={card} onChange={(e) => setCard(e.target.value)} data-testid="mock-card" />
      <div className="mt-2 flex gap-2">
        <Button onClick={async () => { await api(`/api/q/${token}/mock-confirm`, { body: { card } }); onSaved(); }} data-testid="mock-save">Save card</Button>
        <Button variant="outline" onClick={async () => { await api(`/api/q/${token}/mock-confirm`, { body: { bank: true } }); onSaved(); }}>Use test bank account</Button>
      </div>
    </div>
  );
}

function LiveElement({ onSaved }: { onSaved: () => void }) {
  const stripe = useStripe();
  const elements = useElements();
  const [error, setError] = useState<string | null>(null);
  return (
    <div className="mt-3">
      <PaymentElement />
      {error ? <p className="mt-2 text-sm text-red-700" role="alert">{error}</p> : null}
      <Button className="mt-3" disabled={!stripe} onClick={async () => {
        if (!stripe || !elements) return;
        const { error: err } = await stripe.confirmSetup({ elements, confirmParams: { return_url: location.href }, redirect: 'if_required' });
        if (err) setError(err.message ?? 'That did not go through.');
        else onSaved();
      }}>Save</Button>
    </div>
  );
}

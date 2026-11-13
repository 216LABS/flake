'use client';

import { DEFAULT_RATE_CARD } from '@flake/core/quote';
import { Badge, Button, Card, Input, Label } from '@flake/ui';
import Link from 'next/link';
import { useState } from 'react';
import { api, money } from '@/lib/client';
import { rateCardProblem } from '@/lib/limits';

export function Calculator() {
  const [sqft, setSqft] = useState('');
  const [address, setAddress] = useState('');
  const [walks, setWalks] = useState('0');
  const [rate, setRate] = useState(String(DEFAULT_RATE_CARD.per_sqft_cents_per_push));
  const [min, setMin] = useState(String(DEFAULT_RATE_CARD.min_push_cents / 100));
  const [walkRate, setWalkRate] = useState(String(DEFAULT_RATE_CARD.walks_per_lf_cents));
  const [pushes, setPushes] = useState(String(DEFAULT_RATE_CARD.season_pushes));
  const [email, setEmail] = useState('');
  const [out, setOut] = useState<any>(null);
  const [error, setError] = useState<string | null>(null);
  // Checked before asking the server, in words, instead of a validator's message (issue 27).
  const sq = Number(sqft);
  const problem = sqft && !(sq > 0) ? 'Lot size must be more than 0 sq ft.' : sqft && sq > 50_000_000 ? 'Lot size must be 50,000,000 sq ft or less.' : Number(walks) < 0 ? "Walks can't be negative." : rateCardProblem({ rate, min, walk: walkRate, salt: '0', pushes });
  const run = async () => {
    if (problem) return setError(problem);
    setError(null);
    setOut(null);
    try {
      setOut(await api('/api/tools/price', { body: {
        sqft: sqft ? Number(sqft) : undefined, address: !sqft && address ? address : undefined, walks_lf: Number(walks), per_sqft_cents_per_push: Number(rate), min_push_cents: Math.round(Number(min) * 100), walks_per_lf_cents: Number(walkRate), season_pushes: Number(pushes), email: email || null,
      } }));
    } catch (e) {
      setError((e as Error).message);
    }
  };
  return (
    <Card className="mt-6">
      <div className="grid gap-3 sm:grid-cols-2">
        <div><Label htmlFor="sqft">Lot size (sq ft)</Label><Input id="sqft" type="number" min={1} data-testid="calc-sqft" value={sqft} onChange={(e) => setSqft(e.target.value)} /></div>
        <div><Label htmlFor="addr">Or measure by address</Label><Input id="addr" data-testid="calc-address" value={address} onChange={(e) => setAddress(e.target.value)} placeholder="14701 Detroit Ave, Lakewood, OH" /></div>
        <div><Label htmlFor="walks">Walks (feet)</Label><Input id="walks" type="number" min={0} value={walks} onChange={(e) => setWalks(e.target.value)} /></div>
        <div><Label htmlFor="em">Email (optional)</Label><Input id="em" type="email" value={email} onChange={(e) => setEmail(e.target.value)} /></div>
      </div>
      <fieldset className="mt-4 rounded-md border border-warn-line bg-warn-tint p-3">
        <legend className="px-1"><Badge tone="amber">Your assumptions, not market data</Badge></legend>
        <div className="grid gap-3 sm:grid-cols-2">
          <div><Label htmlFor="rate">Cents per sq ft, per push</Label><Input id="rate" type="number" step="0.01" min={0} max={100} value={rate} onChange={(e) => setRate(e.target.value)} /></div>
          <div><Label htmlFor="min">Minimum push ($)</Label><Input id="min" type="number" min={0} value={min} onChange={(e) => setMin(e.target.value)} /></div>
          <div><Label htmlFor="wr">Cents per foot of walk</Label><Input id="wr" type="number" min={0} max={1000} value={walkRate} onChange={(e) => setWalkRate(e.target.value)} /></div>
          <div><Label htmlFor="pushes">Pushes per season</Label><Input id="pushes" type="number" min={1} max={100} step={1} value={pushes} onChange={(e) => setPushes(e.target.value)} /></div>
        </div>
      </fieldset>
      <Button variant="accent" className="mt-4" disabled={(!sqft && !address) || Boolean(problem)} onClick={() => void run()} data-testid="calc-run">Estimate</Button>
      {problem && (sqft || address) ? <p className="mt-2 text-sm text-danger" data-testid="calc-problem">{problem}</p> : null}
      {error && error !== problem ? <p className="mt-2 text-sm text-danger" role="alert">{error}</p> : null}
      {out ? (
        <div className="mt-4 rounded-md bg-tint p-4" data-testid="calc-result">
          <p className="text-sm text-muted">{Number(out.sqft).toLocaleString()} sq ft{out.measured ? ', an estimate from public map data for the address you entered. Confirm it on site.' : ''}</p>
          <dl className="mt-2 grid gap-2 text-sm sm:grid-cols-3">
            <div><dt className="text-muted">Per push</dt><dd className="text-xl font-semibold" data-testid="calc-push">{money(out.estimate.per_push_cents)}</dd></div>
            <div><dt className="text-muted">Per event</dt><dd className="text-xl font-semibold">{money(out.estimate.per_event_cents)}</dd></div>
            <div><dt className="text-muted">Seasonal</dt><dd className="text-xl font-semibold">{money(out.estimate.seasonal_cents)}</dd></div>
          </dl>
          <p className="mt-3 text-sm">Turn this into a signed quote: <Link className="text-link underline" href="/login">run it in Flake free</Link>.</p>
        </div>
      ) : null}
    </Card>
  );
}

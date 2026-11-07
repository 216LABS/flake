'use client';

import { Button, Card } from '@flake/ui';
import { useState } from 'react';
import { api } from '@/lib/client';

export function MockStripe({ account, pro }: { account?: string; pro: boolean }) {
  const [error, setError] = useState<string | null>(null);
  return (
    <Card className="max-w-md">
      <h1 className="text-lg font-semibold">{pro ? 'Mock Pro checkout' : 'Mock Stripe onboarding'}</h1>
      <p className="mt-1 text-sm text-slate-600">No real Stripe account or card is involved.</p>
      {error ? <p className="mt-2 text-sm text-red-700" role="alert">{error}</p> : null}
      <Button className="mt-4" variant="accent" data-testid="mock-finish" onClick={async () => {
        try {
          await api('/api/dev/stripe-onboard', { body: pro ? { pro: true } : { account } });
          window.location.href = `/settings?tab=${pro ? 'plan' : 'payments'}`;
        } catch (e) {
          setError((e as Error).message);
        }
      }}>{pro ? 'Subscribe' : 'Finish onboarding'}</Button>
    </Card>
  );
}

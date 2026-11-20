'use client';

import { Button } from '@flake/ui';
import { useEffect, useState } from 'react';

/** How billing works here, in one paragraph, until the person hides it (issue 195). Hidden on this device only. */
export function BillingExplainer({ stripeReady, sending }: { stripeReady: boolean; sending: boolean }) {
  const [hidden, setHidden] = useState(true);
  useEffect(() => {
    try {
      setHidden(localStorage.getItem('flake.billingExplainer') === 'hidden');
    } catch {
      setHidden(false);
    }
  }, []);
  if (hidden) return null;
  return (
    <div className="mb-4 flex flex-wrap items-start gap-3 rounded-md border border-line-faint bg-surface p-3 text-sm" data-testid="billing-explainer">
      <p className="min-w-0 flex-1">
        <b>How billing works.</b> After a storm closes, Flake drafts a bill per customer from what drivers logged. Fix or waive anything flagged, then Approve.
        {stripeReady ? ' Customers with a card or bank account on file are charged then; the rest get a pay link or an invoice.' : ' Stripe isn\'t connected yet, so nothing is charged: send each bill, or copy the customer\'s link.'}
        {sending ? '' : ' Flake isn\'t sending email or texts for your company yet, so copy each customer\'s link and send it yourself.'}
        {' '}Customers see every line and how to pay on their records page. Press Mark paid when a check or cash comes in.
      </p>
      <Button size="sm" variant="ghost" data-testid="billing-explainer-hide" onClick={() => {
        setHidden(true);
        try {
          localStorage.setItem('flake.billingExplainer', 'hidden');
        } catch {
          // Private mode: it shows again next time.
        }
      }}>Hide</Button>
    </div>
  );
}

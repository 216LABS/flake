import type { Metadata } from 'next';

export const metadata: Metadata = { title: 'Terms of Service', description: 'The terms for using Flake by 216LABS.', alternates: { canonical: '/legal/terms' } };

export default function Terms() {
  return (
    <article className="mx-auto max-w-3xl space-y-4 px-4 py-12 text-ink-2">
      <h1 className="text-3xl font-bold text-ink">Terms of Service</h1>
      <p className="text-sm text-muted">Last updated November 10, 2026. Effective when you create an account. 216LABS LLC operates Flake.</p>
      <h2 className="text-xl font-semibold">What Flake is</h2>
      <p>Flake is software that helps snow removal companies dispatch storms, record visits, and bill customers. You remain responsible for your service, your contracts and your decisions about when to send trucks. Flake never dispatches by itself.</p>
      <h2 className="text-xl font-semibold">Weather data</h2>
      <p>Forecasts come from the National Weather Service and observed totals from NOHRSC, as retrieved at the time shown. They may be wrong, late or revised. If data is missing, Flake says it is unavailable rather than guess. Check conditions yourself before you rely on them.</p>
      <h2 className="text-xl font-semibold">Payments</h2>
      <p>Payments run through your own Stripe account, under Stripe&apos;s terms. You pay Stripe&apos;s fees, and Stripe handles disputes and losses. Flake charges an application fee on each payment, shown in billing review. The current plans and fees are on the pricing page.</p>
      <h2 className="text-xl font-semibold">Records</h2>
      <p>Visit records are append-only and are kept for 7 years by default, because claims can arrive months or years later. You can export your data at any time. Proof packets and contract templates are not legal advice.</p>
      <h2 className="text-xl font-semibold">Text messages</h2>
      <p>You agree to text only people who have opted in through Flake. See the SMS terms.</p>
      <h2 className="text-xl font-semibold">No warranty</h2>
      <p>Flake is provided as is. To the extent the law allows, 216LABS LLC&apos;s liability is limited to the fees you paid to Flake in the previous 12 months.</p>
    </article>
  );
}

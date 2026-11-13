import type { Metadata } from 'next';

export const metadata: Metadata = { title: 'Privacy Policy', description: 'What Flake collects, why, and how SMS data is handled.', alternates: { canonical: '/legal/privacy' } };

export default function Privacy() {
  return (
    <article className="mx-auto max-w-3xl space-y-4 px-4 py-12 text-ink-2">
      <h1 className="text-3xl font-bold text-ink">Privacy Policy</h1>
      <p className="text-sm text-muted">Last updated November 10, 2026.</p>
      <h2 className="text-xl font-semibold">What we collect</h2>
      <p>Account details for plow company staff; customer and site details that plow companies enter; visit records including times, photos, salt and location; messages sent through Flake; and payment references from Stripe. Card and bank numbers go directly to Stripe, and Flake never stores them.</p>
      <h2 className="text-xl font-semibold">Driver location</h2>
      <p>Location is captured only while the route page is open and only during an active storm. There is no background tracking.</p>
      <h2 className="text-xl font-semibold">SMS</h2>
      <p>No mobile information will be shared with third parties or affiliates for marketing or promotional purposes. Mobile numbers are used only to send the service messages you opted in to, through our messaging provider. Reply STOP to opt out, HELP for help.</p>
      <h2 className="text-xl font-semibold">Who processes data</h2>
      <p>Supabase (database and storage), Vercel (hosting), Stripe (payments), Twilio (text messages), Resend (email) and Sentry (error reports). We send each only what its job needs.</p>
      <h2 className="text-xl font-semibold">Retention</h2>
      <p>Visits, photos and weather snapshots are kept 7 years by default. Companies can export their data. Records under an open dispute are not deleted.</p>
      <h2 className="text-xl font-semibold">Contact</h2>
      <p>sam@216labs.dev</p>
    </article>
  );
}

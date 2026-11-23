import type { Metadata } from 'next';
import Link from 'next/link';

export const metadata: Metadata = { title: 'Security at Flake', description: 'How Flake keeps a plow company\'s records separate and safe: hosting, encryption, access, and what happens at 3 AM.', alternates: { canonical: '/security' } };

/**
 * The security overview (issue 231). Only what is built and running; anything not done yet is left off, and the
 * questionnaire answer bank in the repo (docs/SECURITY_QUESTIONNAIRE.md) says plainly what isn't.
 */
export default function Security() {
  return (
    <section className="mx-auto max-w-3xl space-y-6 px-4 py-12 text-ink-2">
      <h1 className="text-3xl font-bold text-ink">Security at Flake</h1>
      <p>Flake holds your customers, your prices, your crew and the visit records you rely on in a dispute. Here is how that is looked after, in plain words.</p>

      <div>
        <h2 className="text-xl font-semibold text-ink">Where it runs</h2>
        <p className="mt-1">The app runs on Vercel. The database and stored files (visit photos, PDFs) are on Supabase, a managed PostgreSQL host. Both are large, independently audited providers; we don&apos;t run our own servers.</p>
      </div>
      <div>
        <h2 className="text-xl font-semibold text-ink">Encryption</h2>
        <p className="mt-1">Every connection uses HTTPS. Data is encrypted at rest by the database host. The secret part of each driver route link and customer quote link is stored only as a one-way hash, with an encrypted copy for showing it again to your office.</p>
      </div>
      <div>
        <h2 className="text-xl font-semibold text-ink">Your company&apos;s data stays yours</h2>
        <p className="mt-1">Every company&apos;s records are kept apart in the database itself, by row-level security rules checked on every read and write, not only by the app. Automated tests check that one company can&apos;t read another&apos;s data.</p>
      </div>
      <div>
        <h2 className="text-xl font-semibold text-ink">Who can see what</h2>
        <p className="mt-1">Office sign-in is your work Microsoft or Google account, or a one-time code to your email. A password is optional, for people with neither. Each person on your team gets a role: owner, dispatcher, view-only, branch manager, billing or field lead. Drivers get a link to their own route for one storm, with no access to prices or other customers. Customers see only their own records page.</p>
      </div>
      <div>
        <h2 className="text-xl font-semibold text-ink">Records you can rely on</h2>
        <p className="mt-1">Visits are append-only: a correction is recorded next to the original, with who made it and why, never written over it. Proof packets carry a fingerprint (SHA-256) of their contents, and the weather data behind them is archived with its source address.</p>
      </div>
      <div>
        <h2 className="text-xl font-semibold text-ink">Watching it</h2>
        <p className="mt-1">An outside check tests Flake every 15 minutes and raises an alert when it fails; you can see the record on the <Link className="font-medium text-link underline underline-offset-2" href="/status">status page</Link>. App errors are reported to our error monitoring service (Sentry) so we see them quickly.</p>
      </div>
      <div>
        <h2 className="text-xl font-semibold text-ink">Who we share data with</h2>
        <p className="mt-1">Only the services that run Flake: Vercel (hosting), Supabase (database and files), Twilio (texts, when your texting is set up), Stripe (card and bank payments, when you connect it), Sentry (error reports), and Intuit (only if you connect QuickBooks). Addresses are looked up with map services (the US Census geocoder, Mapbox and OpenStreetMap services). Weather comes from NOAA and the National Weather Service. We don&apos;t sell data.</p>
      </div>
      <div>
        <h2 className="text-xl font-semibold text-ink">Leaving</h2>
        <p className="mt-1">You can download all your data at any time from Settings, as spreadsheets and a zip. See <Link className="font-medium text-link underline underline-offset-2" href="/legal/data-retention">data retention and export</Link>.</p>
      </div>
      <div>
        <h2 className="text-xl font-semibold text-ink">Help, and storm nights</h2>
        <p className="mt-1">Report a problem from the button in the app, or email sam@216labs.dev. Flake is a small team: we answer as fast as we can, and storm nights come first, but we don&apos;t promise a response time. Drivers&apos; phones keep working without signal and send their work when Flake answers, so a short outage doesn&apos;t lose a visit.</p>
      </div>
      <div>
        <h2 className="text-xl font-semibold text-ink">Found a security problem?</h2>
        <p className="mt-1">Email sam@216labs.dev with the details. Please don&apos;t test against other companies&apos; data.</p>
      </div>
      <p className="text-sm text-muted">Filling in a vendor security questionnaire? Ask us and we&apos;ll send our answers.</p>
    </section>
  );
}

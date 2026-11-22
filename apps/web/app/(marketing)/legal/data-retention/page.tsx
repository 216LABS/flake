import type { Metadata } from 'next';
import Link from 'next/link';

export const metadata: Metadata = { title: 'Data retention and export', description: 'What Flake keeps, for how long, and how your data leaves with you.', alternates: { canonical: '/legal/data-retention' } };

/** Data retention and export (issue 231), in plain words and in line with the privacy policy. */
export default function DataRetention() {
  return (
    <section className="mx-auto max-w-3xl space-y-5 px-4 py-12 text-ink-2">
      <h1 className="text-3xl font-bold text-ink">Data retention and export</h1>
      <div>
        <h2 className="text-xl font-semibold text-ink">What we keep, and for how long</h2>
        <p className="mt-1">Visits, photos and weather records are kept 7 years by default, because slip-and-fall claims can arrive months or years after a storm. Bills, payments and signed contracts are kept the same way, as business records. Records under an open dispute or claim are not deleted.</p>
      </div>
      <div>
        <h2 className="text-xl font-semibold text-ink">Your data leaves with you</h2>
        <p className="mt-1">An owner can download everything at any time from Settings, Data export: one spreadsheet per kind of record, or all of them in a zip. Photos and PDFs stay available through their links. No contract, no lock-in, and no fee to export.</p>
      </div>
      <div>
        <h2 className="text-xl font-semibold text-ink">If you stop using Flake</h2>
        <p className="mt-1">Export first. Your records stay for the 7-year default so they are there if a claim comes in. If you want them deleted sooner, email us and we&apos;ll work it out with you. Anything we must keep by law, or that is part of an open dispute, stays.</p>
      </div>
      <div>
        <h2 className="text-xl font-semibold text-ink">Texts and contacts</h2>
        <p className="mt-1">Phone numbers and text consent are kept so we can honor a STOP. We never sell them. See the <Link className="font-medium text-link underline underline-offset-2" href="/legal/privacy">privacy policy</Link> and <Link className="font-medium text-link underline underline-offset-2" href="/legal/sms-terms">SMS terms</Link>.</p>
      </div>
      <p className="text-sm text-muted">Questions: sam@216labs.dev</p>
    </section>
  );
}

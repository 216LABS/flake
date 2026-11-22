import { headers } from 'next/headers';
import { notFound } from 'next/navigation';
import { HttpError } from '@/lib/http';
import { openShare } from '@/lib/share-links';

export const metadata = { title: 'Shared document', robots: 'noindex' };
export const dynamic = 'force-dynamic';

/**
 * What an agent, adjuster or attorney opens (issue 236): one document, read-only, with who shared it and when the
 * link stops working. Never the company's records or other packets.
 */
export default async function Shared({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const h = await headers();
  const s = await openShare(token, { ip: h.get('x-forwarded-for')?.split(',')[0]?.trim() ?? null, ua: h.get('user-agent') }).catch((e) => {
    if (e instanceof HttpError && e.status === 404) return null;
    throw e;
  });
  if (!s) notFound();
  const until = new Date(s.link.expires_at).toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' });
  const what = s.packet ? `Proof packet for ${s.packet.site}, ${new Date(s.packet.from_ts).toLocaleDateString('en-US')} to ${new Date(s.packet.to_ts).toLocaleDateString('en-US')}` : `Snow service documentation, ${s.link.params.from} to ${s.link.params.to}`;
  return (
    <main className="mx-auto max-w-xl px-4 py-16">
      <p className="text-sm text-muted">Shared by {s.company}</p>
      <h1 className="mt-1 text-2xl font-semibold text-ink" data-testid="shared-what">{what}</h1>
      {s.link.label ? <p className="mt-2 text-ink-2">{s.link.label}</p> : null}
      <a className="mt-6 inline-flex min-h-11 items-center rounded-md bg-ink px-5 font-semibold text-surface" href={`/api/shared/${token}`} data-testid="shared-download">Download the PDF</a>
      {s.packet ? <p className="mt-4 text-sm text-muted">Fingerprint of this packet (SHA-256): <span className="break-all font-mono">{s.packet.manifest_sha256}</span></p> : null}
      <p className="mt-6 text-sm text-muted">This link works until {until}. {s.company} can turn it off sooner, and sees when it&apos;s opened.</p>
    </main>
  );
}

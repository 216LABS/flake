import { notFound } from 'next/navigation';
import { HttpError } from '@/lib/http';
import { getQuote } from '@/lib/quotes';
import { QuotePage } from './quote-page';

export const metadata = { title: 'Your quote', robots: 'noindex' };
export const dynamic = 'force-dynamic';

export default async function Page({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  let replaced: string | null = null;
  let withdrawn: string | null = null;
  const quote = await getQuote(token).catch((e) => {
    if (e instanceof HttpError && e.code === 'quote_replaced') replaced = e.message;
    else if (e instanceof HttpError && e.code === 'quote_withdrawn') withdrawn = e.message;
    else if (!(e instanceof HttpError && e.status === 404)) throw e;
    return null;
  });
  if (replaced) {
    return (
      <main className="mx-auto max-w-md px-4 py-16 text-center">
        <h1 className="text-2xl font-semibold text-ink">This quote was replaced</h1>
        <p className="mt-2 text-muted" data-testid="quote-replaced">{replaced}</p>
      </main>
    );
  }
  if (withdrawn) {
    return (
      <main className="mx-auto max-w-md px-4 py-16 text-center">
        <h1 className="text-2xl font-semibold text-ink">This quote was withdrawn</h1>
        <p className="mt-2 text-muted" data-testid="quote-withdrawn">{withdrawn}</p>
      </main>
    );
  }
  if (!quote) notFound();
  return <QuotePage token={token} quote={JSON.parse(JSON.stringify(quote))} />;
}

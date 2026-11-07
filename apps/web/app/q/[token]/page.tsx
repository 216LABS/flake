import { notFound } from 'next/navigation';
import { HttpError } from '@/lib/http';
import { getQuote } from '@/lib/quotes';
import { QuotePage } from './quote-page';

export const metadata = { title: 'Your quote', robots: 'noindex' };
export const dynamic = 'force-dynamic';

export default async function Page({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const quote = await getQuote(token).catch((e) => {
    if (e instanceof HttpError && e.status === 404) return null;
    throw e;
  });
  if (!quote) notFound();
  return <QuotePage token={token} quote={JSON.parse(JSON.stringify(quote))} />;
}

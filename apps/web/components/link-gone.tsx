/** One answer for every public link that doesn't work: a driver route, a customer's records page, a quote. */
export function LinkGone({ who }: { who: 'driver' | 'customer' }) {
  return (
    <main className="mx-auto flex min-h-dvh max-w-md flex-col justify-center px-6 py-16 text-center" data-testid="link-gone">
      <h1 className="font-display text-3xl font-semibold text-slate-900">This link is no longer active</h1>
      <p className="mt-3 text-lg text-slate-700">{who === 'driver' ? 'Ask your dispatcher for a new link.' : 'Ask the company that sent it for a new one.'}</p>
    </main>
  );
}

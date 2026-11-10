import Link from 'next/link';

/** Seen by customers and drivers too, so it doesn't send anyone to the office dashboard. */
export default function NotFound() {
  return (
    <main className="mx-auto max-w-md px-4 py-16 text-center">
      <h1 className="text-2xl font-semibold text-slate-900">We couldn&apos;t find that page</h1>
      <p className="mt-2 text-slate-600">The link may be old or mistyped. If someone sent it to you, ask them for a new one.</p>
      <div className="mt-4 flex justify-center gap-4 text-sm">
        <Link className="text-sky-800 underline" href="/">Flake home</Link>
        <Link className="text-slate-600 underline" href="/login" data-testid="office-sign-in">Office sign in</Link>
      </div>
    </main>
  );
}

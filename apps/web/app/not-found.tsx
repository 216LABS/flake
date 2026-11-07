import Link from 'next/link';

export default function NotFound() {
  return (
    <main className="mx-auto max-w-md px-4 py-16 text-center">
      <h1 className="text-2xl font-semibold text-slate-900">We couldn&apos;t find that page</h1>
      <p className="mt-2 text-slate-600">The link may be old or mistyped.</p>
      <Link className="mt-4 inline-block text-sky-800 underline" href="/dashboard">Go to your dashboard</Link>
    </main>
  );
}

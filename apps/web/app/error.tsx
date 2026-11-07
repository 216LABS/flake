'use client';

export default function ErrorPage({ reset }: { reset: () => void }) {
  return (
    <main className="mx-auto max-w-md px-4 py-16 text-center">
      <h1 className="text-2xl font-semibold text-slate-900">Something went wrong on this page</h1>
      <p className="mt-2 text-slate-600">Your records are safe. Try again, and if it keeps happening, let us know.</p>
      <button type="button" className="mt-4 rounded-md bg-slate-900 px-4 py-2 text-sm font-medium text-white" onClick={reset}>Try again</button>
    </main>
  );
}

import { buttonVariants, Card } from '@flake/ui';
import Link from 'next/link';

const STEPS = [
  { title: 'The forecast hits your trigger', body: 'Flake watches National Weather Service data for every site and tells you when a contract\'s trigger depth is coming. You tap once to start the storm. It never dispatches by itself.' },
  { title: 'Drivers tap a text link', body: 'No app to install and no login. Next stop, big buttons, photos and salt. It keeps working with no signal and sends everything when the signal comes back.' },
  { title: 'Customers get proof, you get paid', body: 'Done texts go out with a photo. When the storm closes, visits become priced invoices. You review only what looks wrong, then approve.' },
];

export default function Home() {
  return (
    <>
      <section className="mx-auto max-w-6xl px-4 py-16">
        <h1 className="max-w-3xl text-4xl font-bold tracking-tight text-slate-900 sm:text-5xl">Your drivers tap a text link, your customers get proof, and you get paid the night of the storm.</h1>
        <p className="mt-4 max-w-2xl text-lg text-slate-700">Snow plow operations software for companies with 1 to 25 trucks: weather alerts that tell you when to roll, a no-install driver check-in, automatic proof of service and one-click billing.</p>
        <div className="mt-6 flex flex-wrap gap-3">
          <Link href="/login" className={buttonVariants({ variant: 'accent', size: 'lg' })}>Start free</Link>
          <Link href="/pricing" className={buttonVariants({ variant: 'outline', size: 'lg' })}>See pricing</Link>
        </div>
        <p className="mt-4 text-sm text-slate-600">Free for early testers through April 30, 2027. Flake earns a small fee on payments you process through it.</p>
      </section>
      <section className="bg-slate-50 py-14">
        <div className="mx-auto max-w-6xl px-4">
          <h2 className="text-2xl font-semibold text-slate-900">How it works</h2>
          <ol className="mt-6 grid gap-4 md:grid-cols-3">
            {STEPS.map((s, i) => (
              <li key={s.title}><Card className="h-full"><div className="text-sm font-semibold text-sky-800">Step {i + 1}</div><h3 className="mt-1 font-semibold">{s.title}</h3><p className="mt-2 text-sm text-slate-700">{s.body}</p></Card></li>
            ))}
          </ol>
        </div>
      </section>
      <section className="mx-auto grid max-w-6xl gap-8 px-4 py-14 md:grid-cols-2">
        <div>
          <h2 className="text-2xl font-semibold text-slate-900">Built for the claim that arrives two years later</h2>
          <p className="mt-3 text-slate-700">Every visit keeps its time, GPS, photos and salt. Every forecast you relied on is archived with a hash. Records can&apos;t be edited after the fact; corrections are added beside them. One click produces a proof packet for any site and date range.</p>
        </div>
        <div>
          <h2 className="text-2xl font-semibold text-slate-900">In early testing</h2>
          <p className="mt-3 text-slate-700">Flake is new. We&apos;re running it with a small number of operators around Cleveland this winter, and we won&apos;t quote customers we don&apos;t have. If you want to try it on one route, sign up, or use the free tools first.</p>
          <div className="mt-4 flex flex-wrap gap-3 text-sm">
            <Link className="text-sky-800 underline" href="/tools/snow-removal-contract">Snow removal contract builder</Link>
            <Link className="text-sky-800 underline" href="/tools/snow-removal-pricing-calculator">Snow removal pricing calculator</Link>
          </div>
        </div>
      </section>
    </>
  );
}

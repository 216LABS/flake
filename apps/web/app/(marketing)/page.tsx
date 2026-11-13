import { buttonVariants, Progress } from '@flake/ui';
import Link from 'next/link';

const STEPS = [
  { title: 'The forecast hits your trigger', body: 'Flake watches National Weather Service data for every site and tells you when a contract\'s trigger depth is coming. You tap once to start the storm. It never dispatches by itself.' },
  { title: 'Drivers tap a text link', body: 'No app to install and no login. Next stop, big buttons, photos and salt. It keeps working with no signal and sends everything when the signal comes back.' },
  { title: 'Customers get proof, you get paid', body: 'Done texts go out with a photo. When the storm closes, visits become priced invoices. You review only what looks wrong, then approve.' },
];

/** The driver's real screen, drawn with sample stops. */
function PhoneSample() {
  return (
    <div aria-hidden="true" className="w-64 shrink-0 rounded-2xl border-4 border-slate-700 bg-slate-950 p-3 text-white">
      <div className="flex items-center justify-between text-xs"><span className="font-display font-bold">Tuesday lake effect</span><span className="rounded-full bg-emerald-400 px-2 py-0.5 font-bold text-black">Synced</span></div>
      <div className="mt-2 text-xs text-slate-300">4 of 9 done</div>
      <div className="mt-2 rounded-popup bg-slate-800 p-3">
        <div className="font-display text-xs font-bold uppercase tracking-wider text-beacon">Next stop</div>
        <div className="font-display mt-1 text-2xl font-bold leading-tight">Madison Ave Retail Lot</div>
        <div className="mt-1 text-xs text-slate-300">Keep clear of the loading dock.</div>
        <div className="font-display mt-3 rounded-md bg-slate-700 py-2 text-center text-sm font-bold">Navigate</div>
        <div className="font-display mt-2 rounded-md bg-beacon py-3 text-center text-xl font-bold text-black">Arrive</div>
        <div className="font-display mt-2 rounded-md border border-orange-400 py-2 text-center text-sm font-bold text-orange-300">Problem</div>
      </div>
    </div>
  );
}

function RecordSample() {
  return (
    <figure className="rounded-md border border-line bg-surface p-5 text-sm">
      <figcaption className="font-display text-xs font-semibold uppercase tracking-wider text-muted">Sample service record</figcaption>
      <p className="font-display mt-2 text-xl font-semibold">Madison Ave Retail Lot</p>
      <dl className="tabular mt-3 grid grid-cols-[auto_1fr] gap-x-4 gap-y-1">
        <dt className="text-muted">Arrived</dt><dd>Dec 13, 3:30 AM</dd>
        <dt className="text-muted">Departed</dt><dd>Dec 13, 3:52 AM</dd>
        <dt className="text-muted">Depth reported</dt><dd>3&quot;</dd>
        <dt className="text-muted">GPS at arrival</dt><dd>41.4819, -81.7982</dd>
        <dt className="text-muted">Photos</dt><dd>Before and after</dd>
        <dt className="text-muted">Weather on file</dt><dd>NWS forecast, archived with a hash</dd>
      </dl>
    </figure>
  );
}

export default function Home() {
  return (
    <>
      <section className="bg-slate-950 text-white">
        <div className="mx-auto flex max-w-6xl flex-col gap-10 px-4 py-12 md:flex-row md:items-center md:justify-between md:py-16">
          <div className="max-w-2xl">
            <p className="font-display text-lg font-semibold text-beacon">Plowed, proved and paid.</p>
            <h1 className="font-display mt-2 text-4xl font-bold leading-[1.02] tracking-tight md:text-6xl">Your drivers tap a text link, your customers get proof, and you get paid the night of the storm.</h1>
            <p className="mt-5 text-lg text-slate-300">Snow plow operations software for companies with 1 to 25 trucks: weather alerts that tell you when to roll, a no-install driver check-in, automatic proof of service and one-click billing.</p>
            <div className="mt-6 flex flex-wrap gap-3">
              <Link href="/login" className={buttonVariants({ variant: 'accent', size: 'lg' })}>Start free</Link>
              <Link href="/pricing" className={buttonVariants({ variant: 'outline', size: 'lg' })}>See pricing</Link>
            </div>
            <p className="mt-4 text-sm text-slate-300">Free for early testers through April 30, 2027. Flake earns a small fee on payments you process through it.</p>
          </div>
          <PhoneSample />
        </div>
        <div className="chevrons" />
      </section>
      <section className="mx-auto max-w-6xl px-4 py-14">
        <h2 className="font-display text-3xl font-semibold tracking-tight">How it works</h2>
        <ol className="mt-6 grid gap-8 md:grid-cols-3">
          {STEPS.map((s, i) => (
            <li key={s.title}>
              <div className="font-display tabular text-5xl font-bold text-faint" aria-hidden="true">{i + 1}</div>
              <Progress className="mt-2" value={i + 1} max={3} label={`Step ${i + 1} of 3`} />
              <h3 className="font-display mt-3 text-xl font-semibold leading-tight">{s.title}</h3>
              <p className="mt-2 text-sm text-muted">{s.body}</p>
            </li>
          ))}
        </ol>
      </section>
      <section className="border-y border-line-faint bg-surface">
        <div className="mx-auto grid max-w-6xl items-center gap-8 px-4 py-14 md:grid-cols-2">
          <div>
            <h2 className="font-display text-3xl font-semibold tracking-tight">Built for the claim that arrives two years later</h2>
            <p className="mt-3 text-muted">Every visit keeps its time, GPS, photos and salt. Every forecast you relied on is archived with a hash. Records can&apos;t be edited after the fact; corrections are added beside them. One click produces a proof packet for any site and date range.</p>
          </div>
          <RecordSample />
        </div>
      </section>
      <section className="mx-auto max-w-6xl px-4 py-14">
        <h2 className="font-display text-3xl font-semibold tracking-tight">In early testing</h2>
        <p className="mt-3 max-w-2xl text-muted">Flake is new. We&apos;re running it with a small number of operators around Cleveland this winter, and we won&apos;t quote customers we don&apos;t have. If you want to try it on one route, sign up, or use the free tools first.</p>
        <div className="mt-4 flex flex-wrap gap-4 text-sm font-medium">
          <Link className="text-link underline underline-offset-2" href="/tools/snow-removal-contract">Snow removal contract builder</Link>
          <Link className="text-link underline underline-offset-2" href="/tools/snow-removal-pricing-calculator">Snow removal pricing calculator</Link>
        </div>
      </section>
    </>
  );
}

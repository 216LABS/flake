import { Card, Eyebrow, PageHeader } from '@flake/ui';
import Link from 'next/link';
import { requirePage } from '@/lib/auth';

export const metadata = { title: 'Storm-night guide' };

const BEFORE: [string, string, string][] = [
  ['Customers and lots', 'Each lot has an address and a signed quote, or it plows but doesn\'t bill.', '/customers'],
  ['Routes', 'Every lot is on a route, in the order you drive it. Suggest order sorts by drive time.', '/routes'],
  ['Crew', 'Each driver has a phone or email so they get their route link.', '/settings?tab=crew'],
  ['How you get paid', 'Write how customers pay you (checks to, mail to). Manual billing needs no card setup.', '/settings?tab=payments'],
  ['Alerts', 'Turn on alerts on your phone so a snow trigger or a driver problem reaches you at night.', '/settings?tab=alerts'],
];

const NIGHT: [string, string][] = [
  ['Start the storm', 'Dashboard or Storms, Start a storm, pick the routes. Check each route has its driver.'],
  ['Send routes to the crew', 'On the storm board. Each driver who said yes to texts gets a link by text; show the QR code, or send it from your phone, to anyone who didn\'t.'],
  ['Watch the board', 'Lots turn blue on the way, amber on site, green when done. A red lot is past its deadline; a problem shows at the top.'],
  ['Change things live', 'Drag a lot to another truck, add a lot a customer called about, or start a second pass. Drivers see it within seconds.'],
  ['Close the storm', 'When every lot is done or skipped. Flake takes you to billing.'],
];

const AFTER: [string, string][] = [
  ['Review the bills', 'Anything flagged (no photo, no depth, odd times) says why. Fix it or waive it, then approve.'],
  ['Send the bills', 'Manual billing: Send bill emails each customer their bill with a link to their records. Mark paid when the check comes.'],
  ['Proof if anyone asks', 'Proof makes a PDF for any lot and dates: visits, photos, GPS and the weather. Insurers and lawyers accept it as a record.'],
];

/** For a pilot company: what to set up before the first storm, what to tap on the night, and what to do after. */
export default async function Help() {
  await requirePage();
  return (
    <>
      <PageHeader title="Storm-night guide" subtitle="Before the first snow, on the night, and the morning after." />
      <div className="grid max-w-4xl gap-4">
        <Card>
          <Eyebrow className="mb-2">Before the first storm</Eyebrow>
          <ol className="list-decimal space-y-2 pl-5 text-sm">
            {BEFORE.map(([t, body, href]) => <li key={t}><Link className="font-semibold text-link underline" href={href}>{t}</Link>: {body}</li>)}
          </ol>
          <p className="mt-3 text-sm text-ink-2">Do one practice storm with a driver before real snow: start it, have them open the link, arrive, take photos, finish two lots, then close and look at the bills. Delete nothing; practice bills can be voided.</p>
        </Card>
        <Card>
          <Eyebrow className="mb-2">On the night</Eyebrow>
          <ol className="list-decimal space-y-2 pl-5 text-sm">{NIGHT.map(([t, body]) => <li key={t}><b>{t}</b>: {body}</li>)}</ol>
          <p className="mt-3 text-sm text-ink-2">Drivers don&apos;t need an app or a password. If a phone has no signal, the driver keeps going; the phone saves everything and sends it when signal comes back. They should keep the page open until it says Synced.</p>
        </Card>
        <Card>
          <Eyebrow className="mb-2">The morning after</Eyebrow>
          <ol className="list-decimal space-y-2 pl-5 text-sm">{AFTER.map(([t, body]) => <li key={t}><b>{t}</b>: {body}</li>)}</ol>
        </Card>
        <Card>
          <Eyebrow className="mb-2">If something goes wrong</Eyebrow>
          <p className="text-sm">Keep plowing your usual way, and tell us with the round bug button in the bottom-right corner of any page. It reaches the Flake team with the page you were on. During the pilot we watch every storm and fix problems the same night.</p>
        </Card>
      </div>
    </>
  );
}

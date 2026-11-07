import type { Metadata } from 'next';

export const metadata: Metadata = { title: 'SMS Terms', description: 'Terms for service text messages sent through Flake.', alternates: { canonical: '/legal/sms-terms' } };

export default function SmsTerms() {
  return (
    <article className="mx-auto max-w-3xl space-y-4 px-4 py-12 text-slate-800">
      <h1 className="text-3xl font-bold text-slate-900">SMS Terms</h1>
      <p>Plow companies use Flake to send service messages: route links and storm call-outs to crew, and on-the-way, completed and invoice notices to customers. Messages come from the company&apos;s own verified number, and there is no marketing.</p>
      <p>You get messages only if you checked the opt-in box on your invite or quote page. It is never required. Message frequency varies with the weather. Msg &amp; data rates may apply.</p>
      <p>Reply <b>STOP</b> to opt out, <b>START</b> to opt back in, and <b>HELP</b> for help. Carriers are not liable for delayed or undelivered messages.</p>
      <p>No mobile information will be shared with third parties or affiliates for marketing or promotional purposes.</p>
    </article>
  );
}

import { eq, serviceDb, tenant } from '@flake/db';
import { CREW_CONSENT_TEXT, CUSTOMER_CONSENT_TEXT } from '@flake/core/messages';
import { Card } from '@flake/ui';
import Link from 'next/link';
import { notFound } from 'next/navigation';

export const dynamic = 'force-dynamic';

/** The public opt-in description and screenshot URL for toll-free verification. */
export default async function SmsOptIn({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const [t] = await serviceDb().select().from(tenant).where(eq(tenant.slug, slug));
  if (!t) notFound();
  const name = t.business_legal_name ?? t.name;
  return (
    <main className="mx-auto max-w-xl px-4 py-12">
      <h1 className="text-2xl font-semibold">{name}: text message opt-in</h1>
      <p className="mt-2 text-sm text-slate-700">We only text people who opt in. The boxes below start unchecked and are not required to do business with us.</p>
      <Card className="mt-4">
        <h2 className="font-semibold">Customers, on the quote page</h2>
        <label className="mt-2 flex items-start gap-2 text-sm"><input type="checkbox" disabled className="mt-1" /> {CUSTOMER_CONSENT_TEXT(name)}</label>
      </Card>
      <Card className="mt-4">
        <h2 className="font-semibold">Crew, on the invite page</h2>
        <label className="mt-2 flex items-start gap-2 text-sm"><input type="checkbox" disabled className="mt-1" /> {CREW_CONSENT_TEXT(name)}</label>
      </Card>
      <p className="mt-4 text-sm text-slate-700">Reply STOP to opt out at any time, or HELP for help. Message frequency varies with the weather. Msg &amp; data rates may apply. We never sell or share mobile information with third parties or affiliates for marketing.</p>
      <p className="mt-2 text-sm"><Link className="text-sky-800 underline" href="/legal/sms-terms">SMS terms</Link> and <Link className="text-sky-800 underline" href="/legal/privacy">privacy policy</Link></p>
    </main>
  );
}

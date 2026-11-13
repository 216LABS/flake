import { eq, serviceDb, tenant } from '@flake/db';
import { notFound } from 'next/navigation';
import Link from 'next/link';

export const dynamic = 'force-dynamic';

export default async function BusinessPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const [t] = await serviceDb().select().from(tenant).where(eq(tenant.slug, slug));
  if (!t) notFound();
  return (
    <main className="mx-auto max-w-xl px-4 py-12">
      <h1 className="text-2xl font-semibold">{t.business_legal_name ?? t.name}</h1>
      <p className="mt-2 text-ink-2">Snow removal services.</p>
      {t.contact_phone ? <p className="mt-2 text-sm">Phone: {t.contact_phone}</p> : null}
      {t.contact_email ? <p className="text-sm">Email: {t.contact_email}</p> : null}
      <p className="mt-4 text-sm"><Link className="text-link underline" href={`/b/${t.slug}/sms`}>Text message opt-in and terms</Link></p>
    </main>
  );
}

import { eq, serviceDb, tenant } from '@flake/db';
import { notFound } from 'next/navigation';
import Link from 'next/link';
import { phone } from '@/lib/client';

export const dynamic = 'force-dynamic';

export default async function BusinessPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const [t] = await serviceDb().select().from(tenant).where(eq(tenant.slug, slug));
  if (!t) notFound();
  return (
    <main className="mx-auto max-w-xl px-4 py-12">
      <h1 className="text-2xl font-semibold">{t.business_legal_name ?? t.name}</h1>
      <p className="mt-2 text-ink-2">Snow removal services.</p>
      {/* Tappable, and the number the way people write it (customer-and-driver pass, Nov 23). */}
      {t.contact_phone ? <p className="mt-2 text-sm">Phone: <a className="font-medium underline underline-offset-2" href={`tel:${t.contact_phone}`}>{phone(t.contact_phone)}</a></p> : null}
      {t.contact_email ? <p className="text-sm">Email: <a className="font-medium underline underline-offset-2" href={`mailto:${t.contact_email}`}>{t.contact_email}</a></p> : null}
      <p className="mt-4 text-sm"><Link className="text-link underline" href={`/b/${t.slug}/sms`}>Text message opt-in and terms</Link></p>
    </main>
  );
}

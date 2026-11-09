import { eq, crew_member, serviceDb, tenant } from '@flake/db';
import { CREW_CONSENT_TEXT } from '@flake/core/messages';
import { notFound } from 'next/navigation';
import { canTextFrom } from '@/lib/messaging';
import { hashToken } from '@/lib/tokens';
import { JoinForm } from './join-form';

export const metadata = { title: 'Join your crew', robots: 'noindex' };
export const dynamic = 'force-dynamic';

export default async function Join({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const db = serviceDb();
  const [row] = await db.select({ crew: crew_member, tenant }).from(crew_member).innerJoin(tenant, eq(tenant.id, crew_member.tenant_id)).where(eq(crew_member.invite_token_hash, hashToken(token)));
  if (!row) notFound();
  return <JoinForm token={token} company={row.tenant.name} name={row.crew.name} hasPhone={Boolean(row.crew.phone_e164)} consentText={CREW_CONSENT_TEXT(row.tenant.name)} email={row.crew.email ?? ''} canText={canTextFrom(row.tenant)} />;
}

import { crewJoin } from '@flake/contracts';
import { and, crew_member, eq, serviceDb, sms_consent } from '@flake/db';
import { clientIp, HttpError, parseJson, rateLimit, route } from '@/lib/http';
import { hashToken } from '@/lib/tokens';

/** The consent box starts unchecked. Saying no still joins the crew; links then come by email or QR. */
export const POST = route<{ params: Promise<{ token: string }> }>(async (req, { params }) => {
  rateLimit(`join:${clientIp(req)}`, 30, 60000);
  const { token } = await params;
  const { consent, email } = await parseJson(req, crewJoin);
  const db = serviceDb();
  const [c] = await db.select().from(crew_member).where(eq(crew_member.invite_token_hash, hashToken(token)));
  if (!c) throw new HttpError(404, 'This invite is no longer active');
  const now = new Date().toISOString();
  // A driver can add or fix their own email here, so route links reach them before texting is approved.
  await db.update(crew_member).set({ joined_at: now, ...(email ? { email: email.toLowerCase() } : {}) }).where(and(eq(crew_member.id, c.id), eq(crew_member.tenant_id, c.tenant_id)));
  if (consent && c.phone_e164) {
    await db.insert(sms_consent).values({ tenant_id: c.tenant_id, phone_e164: c.phone_e164, party: 'crew', opted_in_at: now, opted_in_source: 'crew_invite' })
      .onConflictDoUpdate({ target: [sms_consent.tenant_id, sms_consent.phone_e164], set: { opted_in_at: now, opted_in_source: 'crew_invite', opted_out_at: null } });
  }
  return { ok: true };
});

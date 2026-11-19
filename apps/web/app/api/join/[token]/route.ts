import { crewJoin } from '@flake/contracts';
import { and, crew_member, eq, isNull, serviceDb, sms_consent } from '@flake/db';
import { clientIp, HttpError, parseJson, rateLimit, route } from '@/lib/http';
import { hashToken, inviteExpired, INVITE_DAYS } from '@/lib/tokens';

/** The consent box starts unchecked. Saying no still joins the crew; route links then come from the board's QR code. */
export const POST = route<{ params: Promise<{ token: string }> }>(async (req, { params }) => {
  await rateLimit(`join:${clientIp(req)}`, 30, 60000);
  const { token } = await params;
  const { consent, phone } = await parseJson(req, crewJoin);
  const db = serviceDb();
  const [c] = await db.select().from(crew_member).where(eq(crew_member.invite_token_hash, hashToken(token)));
  if (!c || !c.active) throw new HttpError(404, 'This invite is no longer active');
  const es = c.language === 'es';
  const already = es ? 'Ya te uniste. Para cambiar tu número, pídele a la oficina un enlace nuevo.' : 'You already joined. To change your number, ask the office for a new link.';
  if (inviteExpired(token)) throw new HttpError(410, es ? `Esta invitación tiene más de ${INVITE_DAYS} días. Pídele a la oficina un enlace nuevo.` : `This invite is more than ${INVITE_DAYS} days old. Ask the office for a new link.`, 'invite_expired');
  // A join link gets forwarded in group chats. Once the driver has joined, it can't change where their route links go
  // (issue 133): the office edits the number in Settings, or sends a new link.
  if (c.joined_at) throw new HttpError(409, already, 'already_joined');
  const now = new Date().toISOString();
  // The driver can add or fix their own mobile here. The join is claimed in the same update, so two posts at once can't
  // both set it.
  const took = await db.update(crew_member).set({ joined_at: now, ...(phone ? { phone_e164: phone } : {}) })
    .where(and(eq(crew_member.id, c.id), eq(crew_member.tenant_id, c.tenant_id), isNull(crew_member.joined_at))).returning({ id: crew_member.id });
  if (!took.length) throw new HttpError(409, already, 'already_joined');
  const mobile = phone || c.phone_e164;
  if (consent && mobile) {
    await db.insert(sms_consent).values({ tenant_id: c.tenant_id, phone_e164: mobile, party: 'crew', opted_in_at: now, opted_in_source: 'crew_invite' })
      .onConflictDoUpdate({ target: [sms_consent.tenant_id, sms_consent.phone_e164], set: { opted_in_at: now, opted_in_source: 'crew_invite', opted_out_at: null } });
  }
  return { ok: true };
});

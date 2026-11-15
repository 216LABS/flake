import { crewCreate } from '@flake/contracts';
import { CREW_SUBJECT } from '@flake/core/messages';
import { crew_member, eq, serviceDb, tenant } from '@flake/db';
import { NextResponse } from 'next/server';
import { requireApi, asUser } from '@/lib/auth';
import { baseUrl } from '@/lib/env';
import { parseJson, route } from '@/lib/http';
import { queueNotify, shortLink } from '@/lib/messaging';
import { hashToken, newInviteToken } from '@/lib/tokens';

export const GET = route(async () => {
  const ctx = await requireApi('viewer');
  return { items: await asUser(ctx, (tx) => tx.select().from(crew_member)) };
});

/** Creates the crew member and sends a /join link. SMS needs consent, so a new invite goes by email. */
export const POST = route(async (req) => {
  const ctx = await requireApi('dispatcher');
  const body = await parseJson(req, crewCreate);
  const token = newInviteToken();
  const row = await asUser(ctx, async (tx) => {
    const [c] = await tx.insert(crew_member).values({ ...body, tenant_id: ctx.tenantId, invite_token_hash: hashToken(token) }).returning();
    return c!;
  });
  const [t] = await serviceDb().select().from(tenant).where(eq(tenant.id, ctx.tenantId));
  const link = await shortLink(ctx.tenantId, `/join/${token}`);
  await queueNotify(t!.id, { email: row.email }, { template: 'crew_invite', vars: { link }, subject: CREW_SUBJECT[row.language === 'es' ? 'es' : 'en'].crew_invite(t!.name), lang: row.language === 'es' ? 'es' : 'en', key: `crew_invite:${row.id}`, related: { crew_id: row.id } });
  return NextResponse.json({ ...row, invite_url: `${baseUrl()}/join/${token}` }, { status: 201 });
});

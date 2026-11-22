import { crewCreate } from '@flake/contracts';
import { crew_member } from '@flake/db';
import { NextResponse } from 'next/server';
import { requireApi, asUser } from '@/lib/auth';
import { baseUrl } from '@/lib/env';
import { parseJson, route } from '@/lib/http';

import { hashToken, newInviteToken } from '@/lib/tokens';

export const GET = route(async () => {
  const ctx = await requireApi('viewer');
  return { items: await asUser(ctx, (tx) => tx.select().from(crew_member)) };
});

/** Creates the crew member and returns their /join link for the office to send from its own phone (D16: no email). */
export const POST = route(async (req) => {
  const ctx = await requireApi('dispatcher');
  const body = await parseJson(req, crewCreate);
  const token = newInviteToken();
  const row = await asUser(ctx, async (tx) => {
    const [c] = await tx.insert(crew_member).values({ ...body, tenant_id: ctx.tenantId, invite_token_hash: hashToken(token), branch_id: ctx.branchIds?.[0] ?? null }).returning();
    return c!;
  });
  return NextResponse.json({ ...row, invite_url: `${baseUrl()}/join/${token}` }, { status: 201 });
});

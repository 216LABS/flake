import { teamAdd } from '@flake/contracts';
import { NextResponse } from 'next/server';
import { requireApi } from '@/lib/auth';
import { parseJson, route } from '@/lib/http';
import { addMember } from '@/lib/team';

export const POST = route(async (req) => {
  const ctx = await requireApi('owner');
  const { email, role } = await parseJson(req, teamAdd);
  return NextResponse.json(await addMember(ctx.tenantId, email, role), { status: 201 });
});

import { subCompanyInput } from '@flake/contracts';
import { NextResponse } from 'next/server';
import { asUser, requireApi } from '@/lib/auth';
import { parseJson, route } from '@/lib/http';
import { createSubCompany, listSubCompanies } from '@/lib/subs';

/** Sub companies and their drivers (issue 226). */
export const GET = route(async () => {
  const ctx = await requireApi('dispatcher');
  return { subs: await asUser(ctx, (tx) => listSubCompanies(tx)) };
});

export const POST = route(async (req) => {
  const ctx = await requireApi('dispatcher');
  const b = await parseJson(req, subCompanyInput);
  return NextResponse.json(await asUser(ctx, (tx) => createSubCompany(tx, ctx.tenantId, b)), { status: 201 });
});

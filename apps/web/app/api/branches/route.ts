import { branchInput } from '@flake/contracts';
import { NextResponse } from 'next/server';
import { asUser, requireApi } from '@/lib/auth';
import { parseJson, route } from '@/lib/http';
import { createBranch, listBranches } from '@/lib/branches';

/** Branches (issue 227). Everyone in the office can see the list; only an owner adds one. */
export const GET = route(async () => {
  const ctx = await requireApi('viewer');
  return { branches: await asUser(ctx, (tx) => listBranches(tx)) };
});

export const POST = route(async (req) => {
  const ctx = await requireApi('owner');
  const b = await parseJson(req, branchInput);
  return NextResponse.json(await asUser(ctx, (tx) => createBranch(tx, ctx.tenantId, b)), { status: 201 });
});

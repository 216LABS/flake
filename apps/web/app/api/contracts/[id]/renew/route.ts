import { NextResponse } from 'next/server';
import { asUser, requireApi } from '@/lib/auth';
import { renewContract } from '@/lib/bids';
import { HttpError, isUuid, route } from '@/lib/http';

/** A draft for next season from this accepted contract (issue 166). The office reviews and sends it as a quote. */
export const POST = route<{ params: Promise<{ id: string }> }>(async (_req, { params }) => {
  const id = (await params).id;
  if (!isUuid(id)) throw new HttpError(404, 'Not found');
  const ctx = await requireApi('dispatcher');
  const row = await asUser(ctx, (tx) => renewContract(tx, ctx.tenantId, id));
  return NextResponse.json(row, { status: 201 });
});

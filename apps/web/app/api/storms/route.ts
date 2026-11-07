import { stormCreate } from '@flake/contracts';
import { desc, storm } from '@flake/db';
import { NextResponse } from 'next/server';
import { asUser, requireApi } from '@/lib/auth';
import { parseJson, route } from '@/lib/http';
import { createStorm } from '@/lib/storms';

export const GET = route(async () => {
  const ctx = await requireApi('viewer');
  return { items: await asUser(ctx, (tx) => tx.select().from(storm).orderBy(desc(storm.started_at))) };
});

export const POST = route(async (req) => {
  const ctx = await requireApi('dispatcher');
  const out = await createStorm(ctx, await parseJson(req, stormCreate));
  return NextResponse.json({ id: out.storm.id, runs: out.runs.length }, { status: 201 });
});

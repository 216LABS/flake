import { runStopPatch } from '@flake/contracts';
import { requireApi } from '@/lib/auth';
import { parseJson, route } from '@/lib/http';
import { patchRunStop } from '@/lib/storms';
import { stopDetail } from '@/lib/stop-detail';

export const PATCH = route<{ params: Promise<{ id: string }> }>(async (req, { params }) => {
  const ctx = await requireApi('dispatcher');
  return patchRunStop(ctx, (await params).id, await parseJson(req, runStopPatch));
});

/** The stop's visits, photos and problem notes, for the board's detail sheet (issue 41). Viewers can read it too. */
export const GET = route<{ params: Promise<{ id: string }> }>(async (_req, { params }) => {
  const ctx = await requireApi('viewer');
  return stopDetail(ctx.userId, (await params).id);
});

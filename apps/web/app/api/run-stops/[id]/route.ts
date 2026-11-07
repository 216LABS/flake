import { runStopPatch } from '@flake/contracts';
import { requireApi } from '@/lib/auth';
import { parseJson, route } from '@/lib/http';
import { patchRunStop } from '@/lib/storms';

export const PATCH = route<{ params: Promise<{ id: string }> }>(async (req, { params }) => {
  const ctx = await requireApi('dispatcher');
  return patchRunStop(ctx, (await params).id, await parseJson(req, runStopPatch));
});

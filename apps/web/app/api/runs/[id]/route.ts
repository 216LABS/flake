import { runPatch } from '@flake/contracts';
import { requireApi } from '@/lib/auth';
import { parseJson, route } from '@/lib/http';
import { assignRunDriver } from '@/lib/storms';

export const PATCH = route<{ params: Promise<{ id: string }> }>(async (req, { params }) => {
  const ctx = await requireApi('dispatcher');
  const { crew_id } = await parseJson(req, runPatch);
  const run = await assignRunDriver(ctx, (await params).id, crew_id);
  return { id: run.id, crew_id: run.crew_id };
});

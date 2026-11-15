import { runPatch } from '@flake/contracts';
import { requireApi } from '@/lib/auth';
import { parseJson, route } from '@/lib/http';
import { assignRunDriver, assignRunTruck } from '@/lib/storms';

export const PATCH = route<{ params: Promise<{ id: string }> }>(async (req, { params }) => {
  const ctx = await requireApi('dispatcher');
  const body = await parseJson(req, runPatch);
  const id = (await params).id;
  if (body.truck_id !== undefined) await assignRunTruck(ctx, id, body.truck_id);
  const run = body.crew_id ? await assignRunDriver(ctx, id, body.crew_id) : null;
  return { id, crew_id: run?.crew_id, truck_id: body.truck_id };
});

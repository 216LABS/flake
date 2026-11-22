import { z } from 'zod';
import { and, crew_member, eq, inArray, serviceDb, storm } from '@flake/db';
import { requireApi } from '@/lib/auth';
import { HttpError, isUuid, parseJson, route } from '@/lib/http';
import { setStandby } from '@/lib/noshow';

const body = z.object({ crew_ids: z.array(z.uuid()).max(100) });

/** Who's on standby for this storm (issue 234): drivers a run can be offered to when someone doesn't show. */
export const PUT = route<{ params: Promise<{ id: string }> }>(async (req, { params }) => {
  const ctx = await requireApi('dispatcher');
  const { id } = await params;
  if (!isUuid(id)) throw new HttpError(404, 'Not found');
  const { crew_ids } = await parseJson(req, body);
  const db = serviceDb();
  const [s] = await db.select({ status: storm.status }).from(storm).where(and(eq(storm.id, id), eq(storm.tenant_id, ctx.tenantId)));
  if (!s) throw new HttpError(404, 'Storm not found');
  const mine = crew_ids.length ? await db.select({ id: crew_member.id }).from(crew_member).where(and(eq(crew_member.tenant_id, ctx.tenantId), eq(crew_member.active, true), inArray(crew_member.id, crew_ids))) : [];
  await setStandby(ctx.tenantId, id, mine.map((c) => c.id));
  return { crew_ids: mine.map((c) => c.id) };
});

import { z } from 'zod';
import { eq, job, serviceDb, sql } from '@flake/db';
import { requireApi } from '@/lib/auth';
import { parseJson, route } from '@/lib/http';

/** Retry a dead-lettered job that belongs to this tenant. */
export const POST = route(async (req) => {
  const ctx = await requireApi('owner');
  const { id } = await parseJson(req, z.object({ id: z.number().int() }));
  await serviceDb().update(job).set({ dead_at: null, attempts: 0, run_at: new Date().toISOString(), last_error: null }).where(sql`${eq(job.id, id)} and ${job.payload}->>'tenantId' = ${ctx.tenantId}`);
  return { ok: true };
});

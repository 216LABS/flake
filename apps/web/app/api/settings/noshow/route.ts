import { z } from 'zod';
import { requireApi } from '@/lib/auth';
import { parseJson, route } from '@/lib/http';
import { noShowMinutes, setNoShowMinutes } from '@/lib/noshow';

const body = z.object({ minutes: z.number().int().min(5).max(240) });

/** How long before a run's first open-by time an unanswered driver raises an office alert (issue 234). */
export const GET = route(async () => {
  const ctx = await requireApi('viewer');
  return { minutes: await noShowMinutes(ctx.tenantId) };
});

export const PUT = route(async (req) => {
  const ctx = await requireApi('owner');
  const { minutes } = await parseJson(req, body);
  await setNoShowMinutes(ctx.tenantId, minutes);
  return { minutes };
});

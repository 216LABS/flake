import { z } from 'zod';
import { requireApi } from '@/lib/auth';
import { parseJson, route } from '@/lib/http';
import { setFatigueLimits } from '@/lib/fatigue';

const body = z.object({ warn_hours: z.number().min(4).max(36), min_rest_hours: z.number().min(2).max(24) });

/** When a long shift or a short rest raises an office alert (issue 235). */
export const PUT = route(async (req) => {
  const ctx = await requireApi('owner');
  const limits = await parseJson(req, body);
  await setFatigueLimits(ctx.tenantId, limits);
  return limits;
});

import { z } from 'zod';
import { requireApi } from '@/lib/auth';
import { parseJson, route } from '@/lib/http';
import { setSetting } from '@/lib/providers';
import { saltEventsKey } from '@/lib/salt-plan';

const body = z.object({ events: z.number().int().min(1).max(100) });

/** Salt runs in a typical season here, for the pre-season estimate (issue 197). */
export const PUT = route(async (req) => {
  const ctx = await requireApi('owner');
  const { events } = await parseJson(req, body);
  await setSetting(saltEventsKey(ctx.tenantId), { events });
  return { ok: true };
});

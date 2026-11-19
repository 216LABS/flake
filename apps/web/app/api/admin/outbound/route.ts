import { z } from 'zod';
import { requireApi } from '@/lib/auth';
import { HttpError, parseJson, route } from '@/lib/http';
import { isOutboundAdmin, listOutbound, setOutbound } from '@/lib/outbound';

/** 216LABS only (issue 171). A company's own owner gets a 404, as if this didn't exist. */
async function admin() {
  const ctx = await requireApi('viewer');
  if (!isOutboundAdmin(ctx.email)) throw new HttpError(404, 'Not found');
  return ctx;
}

export const GET = route(async () => {
  await admin();
  return { companies: await listOutbound() };
});

const body = z.object({ tenant_id: z.uuid(), enabled: z.boolean() });

/** Turns sending on or off for one company. The write names that one tenant id and nothing else. */
export const PATCH = route(async (req) => {
  const ctx = await admin();
  const b = await parseJson(req, body);
  return setOutbound(ctx.email, b.tenant_id, b.enabled);
});

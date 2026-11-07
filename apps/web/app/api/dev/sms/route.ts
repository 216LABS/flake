import { z } from 'zod';
import { eq, serviceDb, tenant } from '@flake/db';
import { requireApi } from '@/lib/auth';
import { isProd } from '@/lib/env';
import { HttpError, parseJson, route } from '@/lib/http';
import { handleInboundSms } from '@/lib/sms-admin';

/** /dev/inbox: simulate an inbound STOP, HELP, YES or NO. */
export const POST = route(async (req) => {
  if (isProd()) throw new HttpError(404, 'Not found');
  const ctx = await requireApi('dispatcher');
  const { from, body } = await parseJson(req, z.object({ from: z.string(), body: z.string() }));
  const [t] = await serviceDb().select().from(tenant).where(eq(tenant.id, ctx.tenantId));
  if (!t?.sms_sender) throw new HttpError(409, 'This tenant has no SMS sender yet');
  return handleInboundSms(t.sms_sender, from, body);
});

import { z } from 'zod';
import { requireApi } from '@/lib/auth';
import { saveFeedback } from '@/lib/feedback';
import { parseJson, rateLimit, route } from '@/lib/http';
import { plainText } from '@/lib/messaging';

const body = z.object({ message: z.string().trim().min(3, 'Say a little more.').max(2000), path: z.string().max(300).default('') });

/** "Send feedback" from any office screen. Anyone in a company can send it, viewers too. */
export const POST = route(async (req) => {
  const ctx = await requireApi('viewer');
  await rateLimit(`feedback:${ctx.userId}`, 5, 10 * 60_000);
  const { message, path } = await parseJson(req, body);
  const saved = await saveFeedback({ tenant_id: ctx.tenantId, company: ctx.tenant.name, email: ctx.email ?? null, role: ctx.role, path: path.startsWith('/') ? path : '/', message: plainText(message, 2000) });
  return { ok: true, id: saved.id };
});

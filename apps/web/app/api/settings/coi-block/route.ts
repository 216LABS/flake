import { eq, tenant } from '@flake/db';
import { z } from 'zod';
import { asUser, requireApi } from '@/lib/auth';
import { parseJson, route } from '@/lib/http';

/** "Block subs with an expired or missing certificate from storm runs" (issue 226). Off warns, as before. */
export const PUT = route(async (req) => {
  const ctx = await requireApi('owner');
  const { on } = await parseJson(req, z.object({ on: z.boolean() }));
  await asUser(ctx, (tx) => tx.update(tenant).set({ block_lapsed_coi: on }).where(eq(tenant.id, ctx.tenantId)));
  return { on };
});

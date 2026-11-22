import { subAssign } from '@flake/contracts';
import { asUser, requireApi } from '@/lib/auth';
import { parseJson, route } from '@/lib/http';
import { assignSites } from '@/lib/subs';

/** Gives a block of lots to a sub company, or takes them back. Start storm puts them on that sub's own run. */
export const POST = route(async (req) => {
  const ctx = await requireApi('dispatcher');
  const b = await parseJson(req, subAssign);
  return asUser(ctx, (tx) => assignSites(tx, b.site_ids, b.sub_company_id));
});

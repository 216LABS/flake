import { subDriver } from '@flake/contracts';
import { asUser, requireApi } from '@/lib/auth';
import { parseJson, route } from '@/lib/http';
import { setDriverCompany } from '@/lib/subs';

/** Which sub company a driver works for. */
export const POST = route(async (req) => {
  const ctx = await requireApi('dispatcher');
  const b = await parseJson(req, subDriver);
  return asUser(ctx, (tx) => setDriverCompany(tx, b.crew_id, b.sub_company_id));
});

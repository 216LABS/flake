import { billingApprove } from '@flake/contracts';
import { requireApi } from '@/lib/auth';
import { approveDrafts } from '@/lib/billing';
import { parseJson, route } from '@/lib/http';

export const POST = route(async (req) => {
  const ctx = await requireApi('dispatcher');
  const { draftIds } = await parseJson(req, billingApprove);
  return approveDrafts(ctx, draftIds);
});

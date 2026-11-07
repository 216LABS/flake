import { billingRetry } from '@flake/contracts';
import { requireApi } from '@/lib/auth';
import { retryDraft } from '@/lib/billing';
import { parseJson, route } from '@/lib/http';

export const POST = route(async (req) => {
  const ctx = await requireApi('dispatcher');
  const { draftId } = await parseJson(req, billingRetry);
  return retryDraft(ctx, draftId);
});

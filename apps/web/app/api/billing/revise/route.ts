import { billingRevise } from '@flake/contracts';
import { requireApi } from '@/lib/auth';
import { reviseDraft } from '@/lib/billing';
import { parseJson, route } from '@/lib/http';

/** Takes an approved or failed invoice back to review, or voids it. */
export const POST = route(async (req) => {
  const ctx = await requireApi('dispatcher');
  const { draftId, to } = await parseJson(req, billingRevise);
  return reviseDraft(ctx, draftId, to);
});

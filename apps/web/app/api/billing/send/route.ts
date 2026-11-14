import { billingSend } from '@flake/contracts';
import { requireApi } from '@/lib/auth';
import { sendBill } from '@/lib/billing';
import { parseJson, route } from '@/lib/http';

/** Emails (or texts) a bill the company collects itself to the customer. */
export const POST = route(async (req) => {
  const ctx = await requireApi('dispatcher');
  const { draftId } = await parseJson(req, billingSend);
  return sendBill(ctx, draftId);
});

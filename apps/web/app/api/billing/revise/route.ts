import { billingRevise } from '@flake/contracts';
import { requireApi } from '@/lib/auth';
import { generateDrafts, reviseDraft } from '@/lib/billing';
import { parseJson, route } from '@/lib/http';

/** Takes an approved, failed or voided invoice back to review, or voids it. An unvoided bill is remade from the visits. */
export const POST = route(async (req) => {
  const ctx = await requireApi('dispatcher');
  const { draftId, to } = await parseJson(req, billingRevise);
  const r = await reviseDraft(ctx, draftId, to);
  if (r.unvoid) await generateDrafts(ctx, r.stormId);
  return { ok: r.ok, status: r.status };
});

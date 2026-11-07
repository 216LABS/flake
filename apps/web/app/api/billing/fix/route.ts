import { flagFix } from '@flake/contracts';
import { requireApi } from '@/lib/auth';
import { applyFlagFix } from '@/lib/billing';
import { parseJson, route } from '@/lib/http';

export const POST = route(async (req) => {
  const ctx = await requireApi('dispatcher');
  return { drafts: await applyFlagFix(ctx, await parseJson(req, flagFix)) };
});

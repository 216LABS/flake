import { branchAssign } from '@flake/contracts';
import { asUser, requireApi } from '@/lib/auth';
import { parseJson, route } from '@/lib/http';
import { assignBranch } from '@/lib/branches';

/**
 * Moves lots, routes, crew or salt yards into a branch. A branch manager can only move things between their own
 * branches: the database refuses the rest.
 */
export const POST = route(async (req) => {
  const ctx = await requireApi('dispatcher');
  const b = await parseJson(req, branchAssign);
  return asUser(ctx, (tx) => assignBranch(tx, b.kind, b.ids, b.branch_id));
});

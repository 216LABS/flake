import { branchPatch } from '@flake/contracts';
import { asUser, requireApi } from '@/lib/auth';
import { HttpError, isUuid, parseJson, route } from '@/lib/http';
import { updateBranch } from '@/lib/branches';

/** Rename a branch, move its yard, or archive an empty one. */
export const PATCH = route<{ params: Promise<{ id: string }> }>(async (req, { params }) => {
  const ctx = await requireApi('owner');
  const { id } = await params;
  if (!isUuid(id)) throw new HttpError(404, 'Branch not found');
  const b = await parseJson(req, branchPatch);
  return asUser(ctx, (tx) => updateBranch(tx, id, b));
});

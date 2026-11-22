import { subCompanyPatch } from '@flake/contracts';
import { asUser, requireApi } from '@/lib/auth';
import { HttpError, isUuid, parseJson, route } from '@/lib/http';
import { updateSubCompany } from '@/lib/subs';

type P = { params: Promise<{ id: string }> };

/** Rename, change the contact, or archive (its lots go back to your routes and its portal link stops). */
export const PATCH = route<P>(async (req, { params }) => {
  const ctx = await requireApi('dispatcher');
  const { id } = await params;
  if (!isUuid(id)) throw new HttpError(404, 'Sub company not found');
  const b = await parseJson(req, subCompanyPatch);
  return asUser(ctx, (tx) => updateSubCompany(tx, id, b));
});

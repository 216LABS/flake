import { requireApi } from '@/lib/auth';
import { HttpError, route } from '@/lib/http';
import { logoUrl, removeLogo, saveLogo } from '@/lib/logo';

/** The owner uploads the company's logo (issue 173): PNG or JPEG, up to 1 MB. */
export const POST = route(async (req) => {
  const ctx = await requireApi('owner');
  const file = (await req.formData()).get('file');
  if (!(file instanceof Blob)) throw new HttpError(422, 'Choose a logo file.', 'no_file');
  const path = await saveLogo(ctx.tenantId, new Uint8Array(await file.arrayBuffer()));
  return { logo_url: logoUrl({ id: ctx.tenantId, logo_path: path }) };
});

export const DELETE = route(async () => {
  const ctx = await requireApi('owner');
  await removeLogo(ctx.tenantId);
  return { ok: true };
});

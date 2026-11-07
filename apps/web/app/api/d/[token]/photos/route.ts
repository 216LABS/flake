import { driverPhotoMeta } from '@flake/contracts';
import { resolveToken, savePhoto } from '@/lib/driver';
import { clientIp, HttpError, rateLimit, route } from '@/lib/http';

const MAX_BYTES = 30 * 1024 * 1024;

export const POST = route<{ params: Promise<{ token: string }> }>(async (req, { params }) => {
  const { token } = await params;
  rateLimit(`d:${clientIp(req) ?? token.slice(0, 12)}`, 600, 60000);
  const rs = await resolveToken(token);
  const form = await req.formData();
  const file = form.get('file');
  if (!(file instanceof Blob)) throw new HttpError(422, 'file is required');
  if (file.size > MAX_BYTES) throw new HttpError(413, 'File too large');
  const type = file.type || 'image/jpeg';
  if (!/^(image|audio|video\/webm)/.test(type)) throw new HttpError(415, 'Unsupported file type');
  const parsed = driverPhotoMeta.safeParse(Object.fromEntries(['client_uuid', 'visit_client_uuid', 'phase', 'taken_at', 'problem_client_uuid'].flatMap((k) => (form.get(k) ? [[k, form.get(k)]] : []))));
  if (!parsed.success) throw new HttpError(422, 'Invalid photo metadata');
  return savePhoto(rs, { ...parsed.data, bytes: new Uint8Array(await file.arrayBuffer()), contentType: type });
});

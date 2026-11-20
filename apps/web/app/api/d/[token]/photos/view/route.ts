import { MAX_VIEW_BYTES, resolveToken, saveViewCopy } from '@/lib/driver';
import { driverRateLimit, HttpError, isUuid, route } from '@/lib/http';

/** The phone's JPEG copy of a HEIC photo it already sent, so the office and the proof PDF can show it. */
export const POST = route<{ params: Promise<{ token: string }> }>(async (req, { params }) => {
  const { token } = await params;
  driverRateLimit(req, token);
  const rs = await resolveToken(token, { forUpload: true });
  const form = await req.formData();
  const id = form.get('client_uuid');
  const file = form.get('file');
  if (typeof id !== 'string' || !isUuid(id)) throw new HttpError(422, 'client_uuid is required');
  if (!(file instanceof Blob)) throw new HttpError(422, 'file is required');
  if (file.size > MAX_VIEW_BYTES) throw new HttpError(413, 'File too large');
  return saveViewCopy(rs, id, new Uint8Array(await file.arrayBuffer()));
});

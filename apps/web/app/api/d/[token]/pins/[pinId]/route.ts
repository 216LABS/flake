import { isUuid, rateLimit, clientIp, route, HttpError } from '@/lib/http';
import { pinPhotoForRun, resolveToken } from '@/lib/driver';

export const GET = route<{ params: Promise<{ token: string; pinId: string }> }>(async (req, { params }) => {
  const { token, pinId } = await params;
  rateLimit(`d:${clientIp(req) ?? token.slice(0, 12)}`, 600, 60000);
  const rs = await resolveToken(token);
  const bytes = isUuid(pinId) ? await pinPhotoForRun(rs, pinId) : null;
  if (!bytes) throw new HttpError(404, 'Not found');
  return new Response(new Uint8Array(bytes), { headers: { 'Content-Type': 'image/jpeg', 'Cache-Control': 'private, max-age=3600', 'Referrer-Policy': 'no-referrer' } });
});

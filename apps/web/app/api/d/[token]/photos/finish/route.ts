import { driverPhotoUpload } from '@flake/contracts';
import { finishPhotoUpload, resolveToken } from '@/lib/driver';
import { clientIp, parseJson, rateLimit, route } from '@/lib/http';

export const POST = route<{ params: Promise<{ token: string }> }>(async (req, { params }) => {
  const { token } = await params;
  rateLimit(`d:${clientIp(req) ?? token.slice(0, 12)}`, 600, 60000);
  return finishPhotoUpload(await resolveToken(token), await parseJson(req, driverPhotoUpload));
});

import { driverPhotoUpload } from '@flake/contracts';
import { resolveToken, signPhotoUpload } from '@/lib/driver';
import {driverRateLimit, parseJson, route } from '@/lib/http';

export const POST = route<{ params: Promise<{ token: string }> }>(async (req, { params }) => {
  const { token } = await params;
  driverRateLimit(req, token);
  return signPhotoUpload(await resolveToken(token, { forUpload: true }), await parseJson(req, driverPhotoUpload));
});

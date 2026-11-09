import { driverPhotoUpload } from '@flake/contracts';
import { finishPhotoUpload, resolveToken } from '@/lib/driver';
import {driverRateLimit, parseJson, route } from '@/lib/http';

export const POST = route<{ params: Promise<{ token: string }> }>(async (req, { params }) => {
  const { token } = await params;
  driverRateLimit(req, token);
  return finishPhotoUpload(await resolveToken(token, { forUpload: true }), await parseJson(req, driverPhotoUpload));
});

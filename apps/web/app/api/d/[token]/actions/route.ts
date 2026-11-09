import { driverActionBatch } from '@flake/contracts';
import { processActions, resolveToken } from '@/lib/driver';
import {driverRateLimit, parseJson, route } from '@/lib/http';

export const POST = route<{ params: Promise<{ token: string }> }>(async (req, { params }) => {
  const { token } = await params;
  driverRateLimit(req, token);
  const rs = await resolveToken(token, { forUpload: true });
  const { actions } = await parseJson(req, driverActionBatch);
  return { acks: await processActions(rs, actions) };
});

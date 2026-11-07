import { driverActionBatch } from '@flake/contracts';
import { processActions, resolveToken } from '@/lib/driver';
import { clientIp, parseJson, rateLimit, route } from '@/lib/http';

export const POST = route<{ params: Promise<{ token: string }> }>(async (req, { params }) => {
  const { token } = await params;
  rateLimit(`d:${clientIp(req) ?? token.slice(0, 12)}`, 600, 60000);
  const rs = await resolveToken(token, { forUpload: true });
  const { actions } = await parseJson(req, driverActionBatch);
  return { acks: await processActions(rs, actions) };
});

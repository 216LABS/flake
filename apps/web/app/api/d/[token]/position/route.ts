import { driverPosition } from '@flake/contracts';
import { resolveToken, savePosition } from '@/lib/driver';
import {driverRateLimit, parseJson, route } from '@/lib/http';

/** Sent only while the route page is open in the foreground. There is no background tracking. */
export const POST = route<{ params: Promise<{ token: string }> }>(async (req, { params }) => {
  const { token } = await params;
  driverRateLimit(req, token, 120, 'dp');
  const rs = await resolveToken(token);
  await savePosition(rs, await parseJson(req, driverPosition));
  return { ok: true };
});

import { driverPosition } from '@flake/contracts';
import { resolveToken, savePosition } from '@/lib/driver';
import { clientIp, parseJson, rateLimit, route } from '@/lib/http';

/** Sent only while the route page is open in the foreground. There is no background tracking. */
export const POST = route<{ params: Promise<{ token: string }> }>(async (req, { params }) => {
  const { token } = await params;
  rateLimit(`dp:${clientIp(req) ?? token.slice(0, 12)}`, 120, 60000);
  const rs = await resolveToken(token);
  await savePosition(rs, await parseJson(req, driverPosition));
  return { ok: true };
});

import { loadRun, resolveToken } from '@/lib/driver';
import { clientIp, rateLimit, route } from '@/lib/http';

export const dynamic = 'force-dynamic';

export const GET = route<{ params: Promise<{ token: string }> }>(async (req, { params }) => {
  const { token } = await params;
  rateLimit(`d:${clientIp(req) ?? token.slice(0, 12)}`, 600, 60000);
  return loadRun(await resolveToken(token));
});

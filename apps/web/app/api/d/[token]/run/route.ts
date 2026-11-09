import { loadRun, resolveToken } from '@/lib/driver';
import {driverRateLimit, route } from '@/lib/http';

export const dynamic = 'force-dynamic';

export const GET = route<{ params: Promise<{ token: string }> }>(async (req, { params }) => {
  const { token } = await params;
  driverRateLimit(req, token);
  return loadRun(await resolveToken(token));
});

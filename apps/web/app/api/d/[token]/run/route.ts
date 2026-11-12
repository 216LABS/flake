import { loadRun, markLinkOpened, resolveToken } from '@/lib/driver';
import {driverRateLimit, route } from '@/lib/http';

export const dynamic = 'force-dynamic';

export const GET = route<{ params: Promise<{ token: string }> }>(async (req, { params }) => {
  const { token } = await params;
  driverRateLimit(req, token);
  const rs = await resolveToken(token);
  // Only the app asks for its run, so a link preview that fetches the page doesn't count as opened (issue 86).
  await markLinkOpened(rs.run.id);
  return loadRun(rs);
});

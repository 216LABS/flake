import { clientIp, rateLimit, route } from '@/lib/http';
import { getQuote } from '@/lib/quotes';

export const GET = route<{ params: Promise<{ token: string }> }>(async (req, { params }) => {
  rateLimit(`q:${clientIp(req)}`, 120, 60000);
  return getQuote((await params).token);
});

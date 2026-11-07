import { clientIp, rateLimit, route } from '@/lib/http';
import { createQuoteSetupIntent } from '@/lib/quotes';

export const POST = route<{ params: Promise<{ token: string }> }>(async (req, { params }) => {
  rateLimit(`q:${clientIp(req)}`, 30, 60000);
  return createQuoteSetupIntent((await params).token);
});

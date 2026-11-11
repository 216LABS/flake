import { quoteDecline } from '@flake/contracts';
import { clientIp, parseJson, rateLimit, route } from '@/lib/http';
import { declineQuote } from '@/lib/quotes';

export const POST = route<{ params: Promise<{ token: string }> }>(async (req, { params }) => {
  rateLimit(`q:${clientIp(req)}`, 60, 60000);
  return declineQuote((await params).token, await parseJson(req, quoteDecline));
});

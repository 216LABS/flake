import { requireApi } from '@/lib/auth';
import { route } from '@/lib/http';
import { resendQuote } from '@/lib/quotes';

export const POST = route<{ params: Promise<{ id: string }> }>(async (_req, { params }) => {
  const ctx = await requireApi('dispatcher');
  return resendQuote(ctx, (await params).id);
});

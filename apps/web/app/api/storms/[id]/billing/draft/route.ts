import { requireApi } from '@/lib/auth';
import { generateDrafts } from '@/lib/billing';
import { route } from '@/lib/http';

export const POST = route<{ params: Promise<{ id: string }> }>(async (_req, { params }) => {
  const ctx = await requireApi('dispatcher');
  return { drafts: await generateDrafts(ctx, (await params).id) };
});

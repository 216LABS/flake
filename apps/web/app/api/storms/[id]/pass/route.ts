import { requireApi } from '@/lib/auth';
import { route } from '@/lib/http';
import { addPass, publishStorm } from '@/lib/storms';

export const POST = route<{ params: Promise<{ id: string }> }>(async (_req, { params }) => {
  const ctx = await requireApi('dispatcher');
  const { id } = await params;
  const out = await addPass(ctx, id);
  await publishStorm(ctx, id);
  return { pass: out.pass, runs: out.runs.length };
});

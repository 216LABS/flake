import { z } from 'zod';
import { eq, trigger_alert } from '@flake/db';
import { asUser, requireApi } from '@/lib/auth';
import { HttpError, parseJson, route } from '@/lib/http';

export const PATCH = route<{ params: Promise<{ id: string }> }>(async (req, { params }) => {
  const ctx = await requireApi('dispatcher');
  const { status } = await parseJson(req, z.object({ status: z.enum(['dismissed']) }));
  const [row] = await asUser(ctx, async (tx) => tx.update(trigger_alert).set({ status }).where(eq(trigger_alert.id, (await params).id)).returning());
  if (!row) throw new HttpError(404, 'Not found');
  return row;
});

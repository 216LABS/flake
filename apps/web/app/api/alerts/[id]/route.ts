import { z } from 'zod';
import { and, eq, trigger_alert } from '@flake/db';
import { asUser, requireApi } from '@/lib/auth';
import { HttpError, isUuid, parseJson, route } from '@/lib/http';

/** Dismiss an open alert. One that already started a storm stays dispatched. */
export const PATCH = route<{ params: Promise<{ id: string }> }>(async (req, { params }) => {
  const id = (await params).id;
  if (!isUuid(id)) throw new HttpError(404, 'Not found');
  const ctx = await requireApi('dispatcher');
  const { status } = await parseJson(req, z.object({ status: z.enum(['dismissed']) }));
  return asUser(ctx, async (tx) => {
    const [row] = await tx.update(trigger_alert).set({ status }).where(and(eq(trigger_alert.id, id), eq(trigger_alert.status, 'open'))).returning();
    if (row) return row;
    const [existing] = await tx.select({ status: trigger_alert.status }).from(trigger_alert).where(eq(trigger_alert.id, id));
    if (!existing) throw new HttpError(404, 'Not found');
    if (existing.status === 'dismissed') return existing;
    throw new HttpError(409, 'This alert already started a storm.');
  });
});

import { eq, problem_report } from '@flake/db';
import { asUser, requireApi } from '@/lib/auth';
import { HttpError, route } from '@/lib/http';

/** Clears a driver's problem from the board. The report itself stays on record. */
export const PATCH = route<{ params: Promise<{ id: string }> }>(async (_req, { params }) => {
  const ctx = await requireApi('dispatcher');
  const { id } = await params;
  const [row] = await asUser(ctx, (tx) => tx.update(problem_report).set({ resolved_at: new Date().toISOString() }).where(eq(problem_report.id, id)).returning({ id: problem_report.id }));
  if (!row) throw new HttpError(404, 'Not found');
  return { ok: true };
});

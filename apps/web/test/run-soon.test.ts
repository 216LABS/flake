import { randomUUID } from 'node:crypto';
import { afterAll, describe, expect, it } from 'vitest';
import { closeDb, eq, job, serviceDb } from '@flake/db';
import { enqueue, runByKey } from '@/lib/jobs';

/** Issue 196: a proof packet runs the moment it's asked for, not at the next 2-minute drain. */
describe('running one waiting job by its key', () => {
  afterAll(async () => closeDb());

  it('runs that job once, marks it done, and leaves every other job alone', async () => {
    const key = `soon:${randomUUID()}`;
    const other = `soon-other:${randomUUID()}`;
    const ran: string[] = [];
    const handlers = { 'proof.render': async (p: Record<string, unknown>) => { ran.push(String(p.marker)); } };
    await enqueue('proof.render', { marker: 'mine' }, { dedupeKey: key });
    await enqueue('proof.render', { marker: 'theirs' }, { dedupeKey: other });
    expect(await runByKey(handlers, key)).toBe(true);
    expect(ran).toEqual(['mine']);
    const [mine] = await serviceDb().select().from(job).where(eq(job.dedupe_key, key));
    expect(mine!.done_at).not.toBeNull();
    // Already done: asking again runs nothing.
    expect(await runByKey(handlers, key)).toBeNull();
    const [theirs] = await serviceDb().select().from(job).where(eq(job.dedupe_key, other));
    expect(theirs!.done_at).toBeNull();
    await serviceDb().update(job).set({ done_at: new Date().toISOString() }).where(eq(job.dedupe_key, other));
  });

  it('a failure is retried later like any job, not lost', async () => {
    const key = `soon-fail:${randomUUID()}`;
    await enqueue('proof.render', { marker: 'x' }, { dedupeKey: key });
    expect(await runByKey({ 'proof.render': async () => { throw new Error('boom'); } }, key)).toBe(false);
    const [row] = await serviceDb().select().from(job).where(eq(job.dedupe_key, key));
    expect(row!.done_at).toBeNull();
    expect(row!.last_error).toBe('boom');
    expect(Date.parse(row!.run_at!)).toBeGreaterThan(Date.now());
    await serviceDb().update(job).set({ done_at: new Date().toISOString() }).where(eq(job.dedupe_key, key));
  });
});

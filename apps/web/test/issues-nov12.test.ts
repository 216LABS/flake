import { afterAll, describe, expect, it } from 'vitest';
import { and, closeDb, eq, message_log, run_stop, serviceDb, sql } from '@flake/db';
import { addStopToRun, patchRunStop, publishStorm } from '@/lib/storms';
import { createStorm, ctxOf, drain, makeWorld } from './helpers';

afterAll(async () => {
  await drain();
  await serviceDb().execute(sql`update job set done_at = now() where done_at is null and dead_at is null`);
  await closeDb();
});

const routeChanged = async (tenantId: string) => serviceDb().select().from(message_log).where(and(eq(message_log.tenant_id, tenantId), eq(message_log.template, 'route_changed')));

describe('issue 91: nothing reaches the crew before Send routes to crew', () => {
  it('moving or adding a stop on a route never sent stays quiet, and is announced once it was sent', async () => {
    const w = await makeWorld();
    const ctx = ctxOf(w);
    const out = await createStorm(ctx, { name: 'S', routeIds: [w.routeId, w.route2Id], crewAssignments: {} });
    const r1 = out.runs.find((r) => r.route_id === w.routeId)!;
    const r2 = out.runs.find((r) => r.route_id === w.route2Id)!;
    const stops = (await serviceDb().select().from(run_stop).where(eq(run_stop.storm_run_id, r1.id))).sort((a, b) => a.seq - b.seq);
    await patchRunStop(ctx, stops[1]!.id, { storm_run_id: r2.id });
    await drain();
    expect(await routeChanged(w.tenantId)).toHaveLength(0);

    await publishStorm(ctx, out.storm.id);
    await patchRunStop(ctx, stops[2]!.id, { storm_run_id: r2.id });
    await drain();
    expect((await routeChanged(w.tenantId)).length).toBeGreaterThan(0);
  });
  it('a lot added to a route never sent stays quiet too', async () => {
    const w = await makeWorld();
    const ctx = ctxOf(w);
    const out = await createStorm(ctx, { name: 'S', routeIds: [w.routeId], crewAssignments: {} });
    const inStorm = new Set((await serviceDb().select().from(run_stop).where(eq(run_stop.storm_run_id, out.runs[0]!.id))).map((s) => s.site_id));
    const extra = w.siteIds.find((id) => !inStorm.has(id));
    if (!extra) return;
    await addStopToRun(ctx, out.runs[0]!.id, extra);
    await drain();
    expect(await routeChanged(w.tenantId)).toHaveLength(0);
  });
});

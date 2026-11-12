import { afterAll, describe, expect, it } from 'vitest';
import { closeDb, eq, serviceDb, storm_run } from '@flake/db';
import { GET as runRoute } from '@/app/api/d/[token]/run/route';
import { assignRunDriver, revokeRunLink, stormLive } from '@/lib/storms';
import { decryptToken } from '@/lib/tokens';
import { createStorm, ctxOf, makeWorld, req } from './helpers';

afterAll(async () => {
  await closeDb();
});

const params = (token: string) => ({ params: Promise.resolve({ token }) });

describe('issue 86: the board knows when a driver opened their route', () => {
  it('records the first load of the app, keeps it, and starts over for a new link or a new driver', async () => {
    const w = await makeWorld();
    const ctx = ctxOf(w);
    const out = await createStorm(ctx, { name: 'S', routeIds: [w.routeId], crewAssignments: {} });
    const runId = out.runs[0]!.id;
    const board = async () => (await stormLive({ ...ctx, timezone: 'America/New_York', role: 'owner' }, out.storm.id)).runs.find((r) => r.id === runId)!.opened_at;
    const opened = async () => (await serviceDb().select().from(storm_run).where(eq(storm_run.id, runId)))[0]!.link_opened_at;
    expect(await board()).toBeNull();

    const token = decryptToken(out.runs[0]!.link_token_enc!);
    expect((await runRoute(req(`/api/d/${token}/run`), params(token))).status).toBe(200);
    const first = await opened();
    expect(first).toBeTruthy();
    expect(await board()).toBe(first);
    // Opening again later keeps the first time.
    await new Promise((r) => setTimeout(r, 20));
    await runRoute(req(`/api/d/${token}/run`), params(token));
    expect(await opened()).toBe(first);

    // The same driver picked again keeps it; a different driver hasn't opened it.
    const crewNow = (await serviceDb().select().from(storm_run).where(eq(storm_run.id, runId)))[0]!.crew_id!;
    await assignRunDriver(ctx, runId, crewNow);
    expect(await opened()).toBe(first);
    await assignRunDriver(ctx, runId, crewNow === w.crewId ? w.crew2Id : w.crewId);
    expect(await opened()).toBeNull();

    // A new link hasn't been opened either.
    await runRoute(req(`/api/d/${token}/run`), params(token));
    expect(await opened()).toBeTruthy();
    const fresh = await revokeRunLink(ctx, runId);
    expect(fresh.link_opened_at).toBeNull();
  });
});

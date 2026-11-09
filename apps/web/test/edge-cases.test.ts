import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { closeDb, customer, eq, invoice_draft, job, message_log, route, run_stop, serviceDb, sql } from '@flake/db';
import { randomUUID } from 'node:crypto';
import { processActions, resolveToken } from '@/lib/driver';
import { generateDrafts } from '@/lib/billing';
import { closeStorm, createStorm, publishStorm } from '@/lib/storms';
import { decryptToken } from '@/lib/tokens';
import { ctxOf, drain, makeWorld, stopActions, type World } from './helpers';

afterAll(() => closeDb());

describe('things that happen on real storm nights', () => {
  let w: World;
  beforeAll(async () => {
    w = await makeWorld();
  });

  async function run(routeIds: string[]) {
    const ctx = ctxOf(w);
    const out = await createStorm(ctx, { name: `Edge ${Date.now()}`, routeIds, crewAssignments: {} });
    await publishStorm(ctx, out.storm.id);
    return out;
  }

  it('a route with no stops yet is left out, and the rest of the storm still goes out', async () => {
    const empty = randomUUID();
    await serviceDb().insert(route).values({ id: empty, tenant_id: w.tenantId, name: 'Empty', default_crew_id: w.crewId });
    const out = await run([w.routeId, empty]);
    expect(out.runs.map((x) => x.route_id)).toEqual([w.routeId]);
    const [published] = await serviceDb().execute(sql`select published_at from storm_run where id = ${out.runs[0]!.id}`) as unknown as { published_at: string | null }[];
    expect(published!.published_at).toBeTruthy();
  });

  it("a phone clock that jumps back mid-visit can't quietly bill an hourly lot", async () => {
    const out = await run([w.routeId]);
    const r = out.runs[0]!;
    const rs = await resolveToken(decryptToken(r.link_token_enc!));
    const hourly = (await serviceDb().select().from(run_stop).where(eq(run_stop.storm_run_id, r.id))).find((s) => s.site_id === w.siteIds[4])!;
    const a = stopActions(hourly.id, new Date('2026-01-20T10:00:00Z'), { minutes: -45 });
    await processActions(rs, a.actions as never);
    await closeStorm(ctxOf(w), out.storm.id, true);
    const rows = await generateDrafts(ctxOf(w), out.storm.id);
    const flags = rows.flatMap((x) => x.draft.flags as { code: string }[]).map((f) => f.code);
    expect(flags).toContain('odd_duration');
  });

  it('a customer with no email or phone gets nothing, and nothing breaks', async () => {
    await serviceDb().update(customer).set({ email: null, phone_e164: null }).where(eq(customer.id, w.customerIds[1]!));
    const out = await run([w.routeId]);
    const r = out.runs[0]!;
    const rs = await resolveToken(decryptToken(r.link_token_enc!));
    const stop = (await serviceDb().select().from(run_stop).where(eq(run_stop.storm_run_id, r.id))).find((s) => s.site_id === w.siteIds[1])!;
    await processActions(rs, stopActions(stop.id, new Date()).actions as never);
    await drain();
    const dead = await serviceDb().select().from(job).where(sql`${job.dead_at} is not null and ${job.payload}->>'tenantId' = ${w.tenantId}`);
    expect(dead).toHaveLength(0);
    const sent = await serviceDb().select().from(message_log).where(sql`${message_log.tenant_id} = ${w.tenantId} and ${message_log.template} = 'done' and ${message_log.related}->>'site_id' = ${w.siteIds[1]!}`);
    expect(sent).toHaveLength(0);
    expect(await serviceDb().select().from(invoice_draft).where(eq(invoice_draft.storm_id, out.storm.id))).toHaveLength(0);
  });
});

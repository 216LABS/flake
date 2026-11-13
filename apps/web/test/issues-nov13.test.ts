import { afterAll, describe, expect, it } from 'vitest';
import { and, closeDb, customer, eq, message_log, run_stop, serviceDb } from '@flake/db';
import { processActions, resolveToken } from '@/lib/driver';
import { publishStorm } from '@/lib/storms';
import { decryptToken } from '@/lib/tokens';
import { ctxOf, createStorm, drain, makeWorld, stopActions } from './helpers';

afterAll(() => closeDb());

describe('issue 105: the per-visit service record email follows the customer\'s email choice', () => {
  it('goes to a commercial customer who kept emails on, and not to one who turned them off on the quote', async () => {
    const w = await makeWorld();
    // Customers 1 and 2 are commercial with an email address.
    await serviceDb().update(customer).set({ notify_email: false }).where(eq(customer.id, w.customerIds[1]!));
    await serviceDb().update(customer).set({ notify_email: true }).where(eq(customer.id, w.customerIds[2]!));
    const ctx = ctxOf(w);
    const out = await createStorm(ctx, { name: 'Records', routeIds: [w.routeId], crewAssignments: {}, siteIds: [w.siteIds[1]!, w.siteIds[2]!] });
    await publishStorm(ctx, out.storm.id);
    const run = out.runs[0]!;
    const rs = await resolveToken(decryptToken(run.link_token_enc!));
    const stops = await serviceDb().select().from(run_stop).where(eq(run_stop.storm_run_id, run.id));
    for (const [i, s] of stops.entries()) {
      const a = stopActions(s.id, new Date(Date.now() - 3600_000 + i * 1200_000), { depth: 3, gps: { lat: 41.48, lon: -81.8 }, minutes: 15 });
      await processActions(rs, a.actions as never);
    }
    await drain();
    const reports = await serviceDb().select().from(message_log).where(and(eq(message_log.tenant_id, w.tenantId), eq(message_log.template, 'completion_report')));
    const to = reports.map((r) => r.to_addr);
    const [off] = await serviceDb().select().from(customer).where(eq(customer.id, w.customerIds[1]!));
    const [on] = await serviceDb().select().from(customer).where(eq(customer.id, w.customerIds[2]!));
    expect(to).toContain(on!.email);
    expect(to).not.toContain(off!.email);
  });
});

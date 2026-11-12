import { afterAll, describe, expect, it } from 'vitest';
import { closeDb, customer, eq, route, site, withUser } from '@flake/db';
import { makeWorld } from './helpers';

afterAll(async () => {
  await closeDb();
});

describe('a viewer can look but not change anything, even past the API', () => {
  it('writes as a viewer change nothing', async () => {
    const w = await makeWorld();
    const tries = {
      customer: () => withUser(w.viewerId, (tx) => tx.update(customer).set({ name: 'Changed by viewer' }).where(eq(customer.id, w.customerIds[0]!)).returning()),
      site: () => withUser(w.viewerId, (tx) => tx.update(site).set({ label: 'Changed by viewer' }).where(eq(site.id, w.siteIds[0]!)).returning()),
      route: () => withUser(w.viewerId, (tx) => tx.update(route).set({ name: 'Changed by viewer' }).where(eq(route.id, w.routeId)).returning()),
    };
    for (const [name, fn] of Object.entries(tries)) {
      const out = await fn().catch(() => []);
      expect(out, name).toEqual([]);
    }
    // The same write as the owner goes through, so the check above isn't passing for some other reason.
    const owned = await withUser(w.userId, (tx) => tx.update(customer).set({ name: 'Changed by owner' }).where(eq(customer.id, w.customerIds[0]!)).returning());
    expect(owned).toHaveLength(1);
  });
});

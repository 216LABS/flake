import { expect, type APIRequestContext, type Page } from '@playwright/test';
import postgres from 'postgres';
import { randomUUID } from 'node:crypto';

export const sql = postgres(process.env.DATABASE_URL!, { prepare: false, max: 2, onnotice: () => {} });

export async function login(page: Page) {
  const res = await page.request.post('/api/dev/login', { data: { email: 'demo@flake.test' } });
  expect(res.ok()).toBe(true);
}

export async function routeByName(name: string) {
  const [r] = await sql`select r.id, r.default_crew_id from route r join tenant t on t.id = r.tenant_id where t.slug = 'lakeshore-demo' and r.name = ${name}`;
  return r as unknown as { id: string; default_crew_id: string };
}

export interface LiveRun { id: string; link: string; name: string; stops: { id: string; site_id: string; label: string; status: string }[] }

export async function startStorm(request: APIRequestContext, name: string, routes: string[]) {
  const ids = await Promise.all(routes.map(routeByName));
  const made = await request.post('/api/storms', { data: { name, routeIds: ids.map((r) => r.id) } });
  expect(made.status(), await made.text()).toBe(201);
  const { id } = await made.json();
  const pub = await request.post(`/api/storms/${id}/publish`);
  expect(pub.ok()).toBe(true);
  const live = await (await request.get(`/api/storms/${id}/live`)).json();
  return { id, runs: live.runs as LiveRun[] };
}

/** Finishes stops the way the phone does, so office tests have real visits to bill. */
export async function finishStops(request: APIRequestContext, run: LiveRun, stops = run.stops) {
  const token = new URL(run.link).pathname.split('/').pop()!;
  const base = Date.now() - 3600000;
  for (const [i, s] of stops.entries()) {
    const visit = randomUUID();
    const [site] = await sql`select lat, lon from site where id = ${s.site_id}`;
    const at = new Date(base + i * 4000000);
    const res = await request.post(`/api/d/${token}/actions`, {
      data: {
        actions: [
          { client_uuid: randomUUID(), at: at.toISOString(), kind: 'arrive', run_stop_id: s.id, visit_client_uuid: visit, gps: { lat: site!.lat, lon: site!.lon, acc: 5 } },
          { client_uuid: randomUUID(), at: new Date(at.getTime() + 1200000).toISOString(), kind: 'done', run_stop_id: s.id, visit_client_uuid: visit, services: ['plow'], depth_in: 3, salt: null, gps: null },
        ],
      },
    });
    expect(res.ok()).toBe(true);
  }
}

/** Waits for the service worker to control the page and for its assets to be cached. */
export async function waitOfflineReady(page: Page) {
  await page.waitForFunction(() => document.documentElement.dataset.offlineReady === 'true' && Boolean(navigator.serviceWorker.controller), undefined, { timeout: 30000 });
}

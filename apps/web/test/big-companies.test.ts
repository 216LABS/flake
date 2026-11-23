import { randomUUID } from 'node:crypto';
import { afterAll, describe, expect, it } from 'vitest';
import { and, branch, certificate, closeDb, crew_member, eq, invoice_draft, membership, route, run_stop, serviceDb, site, sql, storm, storm_run, sub_company, tenant, visit, withUser } from '@flake/db';
import { createStorm, ctxOf, drain, makeWorld, stopActions, type World } from './helpers';

afterAll(async () => {
  await drain();
  await serviceDb().execute(sql`update job set done_at = now() where done_at is null and dead_at is null`);
  await closeDb();
});

const tz = 'America/New_York';
const today = () => new Date().toLocaleDateString('en-CA', { timeZone: tz });
const yesterday = () => new Date(Date.now() - 86_400_000).toLocaleDateString('en-CA', { timeZone: tz });

/** Starts a storm on a route with one driver and finishes the first n stops through the phone's own batch. */
async function work(w: World, routeId: string, crewId: string, n: number) {
  const { processActions, resolveToken } = await import('@/lib/driver');
  const { decryptToken } = await import('@/lib/tokens');
  const out = await createStorm(ctxOf(w), { name: `Storm ${randomUUID().slice(0, 4)}`, routeIds: [routeId], crewAssignments: { [routeId]: crewId } });
  const run = out.runs.find((r) => r.route_id === routeId)!;
  const rs = await resolveToken(decryptToken(run.link_token_enc!));
  const stops = (await serviceDb().select().from(run_stop).where(eq(run_stop.storm_run_id, run.id))).sort((a, b) => a.seq - b.seq);
  for (let i = 0; i < n; i++) await processActions(rs, stopActions(stops[i]!.id, new Date(Date.now() - (120 - i * 10) * 60_000), { minutes: 5 }).actions);
  return out;
}

async function addUser(w: World, role: string, branchIds: string[] | null) {
  const id = randomUUID();
  await serviceDb().execute(sql`insert into auth.users (id, email, aud, role, instance_id) values (${id}, ${`${role}-${id}@flake.test`}, 'authenticated', 'authenticated', '00000000-0000-0000-0000-000000000000')`);
  await serviceDb().insert(membership).values({ tenant_id: w.tenantId, user_id: id, role: role as never, branch_ids: branchIds });
  return id;
}

describe('sub companies (issue 226)', () => {
  it('rolls two drivers up to one statement whose total is the sum of the driver lines, and the sub can agree or dispute', async () => {
    const { createSubCompany, setDriverCompany, subStatement, answerStatement, statementStatuses, resolveSubPortal, resetSubPortal } = await import('@/lib/subs');
    const { period } = await import('@/lib/reports');
    const w = await makeWorld({ plan: 'pro' });
    const db = serviceDb();
    await db.update(crew_member).set({ sub_rate_card: { per_visit_cents: 1000 } }).where(eq(crew_member.id, w.crew2Id));
    const [third] = await db.insert(crew_member).values({ tenant_id: w.tenantId, name: 'Crew Three', kind: 'sub', phone_e164: '+12165550193', sub_rate_card: { per_visit_cents: 2000 } }).returning();
    const sub = await withUser(w.userId, (tx) => createSubCompany(tx, w.tenantId, { name: 'Ridge Plowing' }));
    await withUser(w.userId, (tx) => setDriverCompany(tx, w.crew2Id, sub.id));
    await withUser(w.userId, (tx) => setDriverCompany(tx, third!.id, sub.id));
    await work(w, w.routeId, w.crew2Id, 2);
    await work(w, w.routeId, third!.id, 3);
    const p = period(yesterday(), today(), tz);
    const st = await withUser(w.userId, (tx) => subStatement(tx, w.tenantId, sub.id, p));
    expect(st.drivers.map((d) => [d.driver, d.visits, d.total_cents]).sort()).toEqual([['Crew Three', 3, 6000], ['Crew Two', 2, 2000]]);
    expect(st.total_cents).toBe(8000);
    expect(st.lines.reduce((n, l) => n + l.amount_cents, 0)).toBe(st.total_cents);
    // The portal sees the same statement on the server connection.
    const { url } = await withUser(w.userId, (tx) => resetSubPortal(tx, sub.id));
    const who = await resolveSubPortal(url.split('/sub/')[1]!);
    expect(who?.sub.id).toBe(sub.id);
    const fromPortal = await serviceDb().transaction((tx) => subStatement(tx, w.tenantId, sub.id, p, true));
    expect(fromPortal.total_cents).toBe(8000);
    await expect(answerStatement(who!.sub, p.from, p.to, { status: 'disputed', note: '' })).rejects.toThrow(/what looks wrong/);
    await answerStatement(who!.sub, p.from, p.to, { status: 'disputed', note: 'Two pushes at Site 1', disputed_line: 'Crew Two, storm' });
    await answerStatement(who!.sub, p.from, p.to, { status: 'acknowledged' });
    const [seen] = await withUser(w.userId, (tx) => statementStatuses(tx, p.from, p.to));
    expect([seen!.status, seen!.note]).toEqual(['acknowledged', null]);
    // A new link turns the old one off.
    await withUser(w.userId, (tx) => resetSubPortal(tx, sub.id));
    expect(await resolveSubPortal(url.split('/sub/')[1]!)).toBeNull();
  });

  it("shows the sub only its own drivers' visits and photos, and no customer names, contacts or prices", async () => {
    const { createSubCompany, setDriverCompany, portalVisits, subPhotoPath } = await import('@/lib/subs');
    const { period } = await import('@/lib/reports');
    const w = await makeWorld({ plan: 'pro' });
    const sub = await withUser(w.userId, (tx) => createSubCompany(tx, w.tenantId, { name: 'Ridge Plowing' }));
    await withUser(w.userId, (tx) => setDriverCompany(tx, w.crew2Id, sub.id));
    await work(w, w.routeId, w.crew2Id, 2);
    // An employee's visit is not the sub's.
    await work(w, w.routeId, w.crewId, 1);
    const p = period(yesterday(), today(), tz);
    const [row] = await serviceDb().select().from(sub_company).where(eq(sub_company.id, sub.id));
    const visits = await portalVisits(row!, p);
    expect(visits.map((v) => v.driver)).toEqual(['Crew Two', 'Crew Two']);
    const text = JSON.stringify(visits);
    for (const secret of ['Customer 0', 'Customer 1', '@flake.test', '+1216555100', 'amount_cents', 'price']) expect(text).not.toContain(secret);
    // A photo on an employee's visit can't be reached through the sub's portal.
    const [emp] = await serviceDb().select({ id: visit.id }).from(visit).where(eq(visit.crew_id, w.crewId));
    const photoId = randomUUID();
    await serviceDb().execute(sql`insert into visit_photo (id, tenant_id, visit_id, client_uuid, phase, storage_path, sha256) values (${photoId}, ${w.tenantId}, ${emp!.id}, gen_random_uuid(), 'after', 'x/y.jpg', 'abc')`);
    expect(await subPhotoPath(row!, photoId)).toBeNull();
    // Another company's sub can't see this company's visits even with a crafted lookup.
    const other = await makeWorld({ plan: 'pro' });
    const otherSub = await withUser(other.userId, (tx) => createSubCompany(tx, other.tenantId, { name: 'Elsewhere' }));
    const [o] = await serviceDb().select().from(sub_company).where(eq(sub_company.id, otherSub.id));
    expect(await portalVisits({ ...o!, id: sub.id }, p)).toEqual([]);
  });

  it("puts a sub company's lots on its own run at Start storm", async () => {
    const { createSubCompany, setDriverCompany, assignSites } = await import('@/lib/subs');
    const w = await makeWorld({ plan: 'pro' });
    const sub = await withUser(w.userId, (tx) => createSubCompany(tx, w.tenantId, { name: 'Ridge Plowing' }));
    await withUser(w.userId, (tx) => setDriverCompany(tx, w.crew2Id, sub.id));
    await withUser(w.userId, (tx) => assignSites(tx, [w.siteIds[0]!, w.siteIds[1]!], sub.id));
    const out = await createStorm(ctxOf(w), { name: 'Sub lots', routeIds: [w.routeId], crewAssignments: { [w.routeId]: w.crewId } });
    expect(out.runs).toHaveLength(2);
    const subRun = out.runs.find((r) => r.route_id === null)!;
    expect(subRun.crew_id).toBe(w.crew2Id);
    const stops = await serviceDb().select({ site_id: run_stop.site_id, run: run_stop.storm_run_id }).from(run_stop).innerJoin(storm_run, eq(storm_run.id, run_stop.storm_run_id)).where(eq(storm_run.storm_id, out.storm.id));
    expect(stops.filter((s) => s.run === subRun.id).map((s) => s.site_id).sort()).toEqual([w.siteIds[0], w.siteIds[1]].sort());
    expect(stops.filter((s) => s.run !== subRun.id)).toHaveLength(3);
    // The board names the sub's run for the sub.
    const { stormLive } = await import('@/lib/storms');
    const live = await stormLive({ ...ctxOf(w), timezone: tz, role: 'owner' }, out.storm.id);
    expect(live.runs.map((r) => r.name).sort()).toEqual(['Ridge Plowing', 'Route A']);
  });

  it('blocks a sub without current insurance from storm runs only when the company turns the block on', async () => {
    const { createSubCompany, setDriverCompany } = await import('@/lib/subs');
    const { assignRunDriver, patchRunStop } = await import('@/lib/storms');
    const w = await makeWorld({ plan: 'pro' });
    const db = serviceDb();
    // Off (the default): the sub goes out, as before.
    const ok = await createStorm(ctxOf(w), { name: 'Warn only', routeIds: [w.routeId], crewAssignments: { [w.routeId]: w.crew2Id } });
    expect(ok.runs[0]!.crew_id).toBe(w.crew2Id);
    await db.update(tenant).set({ block_lapsed_coi: true }).where(eq(tenant.id, w.tenantId));
    await expect(createStorm(ctxOf(w), { name: 'Blocked', routeIds: [w.routeId], crewAssignments: { [w.routeId]: w.crew2Id } })).rejects.toMatchObject({ status: 409, code: 'sub_coi_lapsed' });
    // An expired certificate still blocks; a current one filed under another driver of the same sub company covers it.
    await db.insert(certificate).values({ tenant_id: w.tenantId, crew_id: w.crew2Id, kind: 'general_liability', expires_on: '2025-01-01' });
    await expect(createStorm(ctxOf(w), { name: 'Expired', routeIds: [w.routeId], crewAssignments: { [w.routeId]: w.crew2Id } })).rejects.toThrow(/certificate ended/);
    const [mate] = await db.insert(crew_member).values({ tenant_id: w.tenantId, name: 'Crew Mate', kind: 'sub' }).returning();
    const sub = await withUser(w.userId, (tx) => createSubCompany(tx, w.tenantId, { name: 'Ridge Plowing' }));
    await withUser(w.userId, (tx) => setDriverCompany(tx, w.crew2Id, sub.id));
    await withUser(w.userId, (tx) => setDriverCompany(tx, mate!.id, sub.id));
    await db.insert(certificate).values({ tenant_id: w.tenantId, crew_id: mate!.id, kind: 'general_liability', expires_on: `${new Date().getFullYear() + 1}-12-31` });
    const covered = await createStorm(ctxOf(w), { name: 'Covered', routeIds: [w.routeId, w.route2Id], crewAssignments: { [w.routeId]: w.crewId, [w.route2Id]: w.crew2Id } });
    expect(covered.runs).toHaveLength(2);
    // Swapping in, or moving a lot to, a lapsed sub is refused.
    const [lapsed] = await db.insert(crew_member).values({ tenant_id: w.tenantId, name: 'No Cert', kind: 'sub' }).returning();
    const empRun = covered.runs.find((r) => r.crew_id === w.crewId)!;
    await expect(assignRunDriver(ctxOf(w), empRun.id, lapsed!.id)).rejects.toMatchObject({ code: 'sub_coi_lapsed' });
    const subRun = covered.runs.find((r) => r.crew_id === w.crew2Id)!;
    await db.update(storm_run).set({ crew_id: lapsed!.id }).where(eq(storm_run.id, subRun.id));
    const [stop] = await db.select().from(run_stop).where(eq(run_stop.storm_run_id, empRun.id)).limit(1);
    await expect(patchRunStop(ctxOf(w), stop!.id, { storm_run_id: subRun.id })).rejects.toMatchObject({ code: 'sub_coi_lapsed' });
  });

  it('scores each sub company for the season: visits, on time against open-by, full proof and late lots', async () => {
    const { createSubCompany, setDriverCompany, scorecards, scorecardCsv } = await import('@/lib/subs');
    const { period } = await import('@/lib/reports');
    const w = await makeWorld({ plan: 'pro' });
    const sub = await withUser(w.userId, (tx) => createSubCompany(tx, w.tenantId, { name: 'Ridge Plowing' }));
    await withUser(w.userId, (tx) => setDriverCompany(tx, w.crew2Id, sub.id));
    await work(w, w.routeId, w.crew2Id, 4);
    const rows = await withUser(w.userId, (tx) => scorecards(tx, period(yesterday(), today(), tz), tz));
    const r = rows.find((x) => x.sub_company_id === sub.id)!;
    expect([r.visits, r.full_proof, r.problems]).toEqual([4, 0, 0]);
    expect(r.with_deadline).toBe(1);
    expect(scorecardCsv(rows, { from: 'a', to: 'b' })).toContain('Ridge Plowing,4,1,');
  });
});

describe('branches and roles (issue 227)', () => {
  /** Two branches: the existing lots in Main, Site B and Route B moved to West. */
  async function twoBranches() {
    const { createBranch, assignBranch } = await import('@/lib/branches');
    const w = await makeWorld({ plan: 'pro' });
    const west = await withUser(w.userId, (tx) => createBranch(tx, w.tenantId, { name: 'West' }));
    const [main] = await serviceDb().select().from(branch).where(and(eq(branch.name, 'Main'), eq(branch.tenant_id, w.tenantId)));
    const siteB = w.siteIds[5]!;
    await withUser(w.userId, (tx) => assignBranch(tx, 'site', [siteB], west.id));
    await withUser(w.userId, (tx) => assignBranch(tx, 'route', [w.route2Id], west.id));
    await withUser(w.userId, (tx) => assignBranch(tx, 'crew', [w.crew2Id], west.id));
    return { w, west, main: main!, siteB };
  }

  it('puts everything that exists in Main when the first branch is added, so a one-yard company sees no change', async () => {
    const { createBranch } = await import('@/lib/branches');
    const w = await makeWorld();
    const west = await withUser(w.userId, (tx) => createBranch(tx, w.tenantId, { name: 'West' }));
    const all = await serviceDb().select({ b: site.branch_id }).from(site).where(eq(site.tenant_id, w.tenantId));
    const [main] = await serviceDb().select().from(branch).where(and(eq(branch.name, 'Main'), eq(branch.tenant_id, w.tenantId)));
    expect(new Set(all.map((x) => x.b))).toEqual(new Set([main!.id]));
    expect(west.id).not.toBe(main!.id);
    await expect(withUser(w.userId, (tx) => createBranch(tx, w.tenantId, { name: 'West' }))).rejects.toMatchObject({ code: 'branch_name' });
  });

  it("keeps a branch manager out of another branch's lots, storms, bills and crew, reading and writing", async () => {
    const { w, west, main, siteB } = await twoBranches();
    const mgr = await addUser(w, 'branch_manager', [west.id]);
    const mainStorm = await work(w, w.routeId, w.crewId, 1);
    const westStorm = await createStorm(ctxOf(w), { name: 'West storm', routeIds: [w.route2Id] });
    // Storms take the branch their routes share.
    const stamped = await serviceDb().select({ id: storm.id, b: storm.branch_id }).from(storm).where(eq(storm.tenant_id, w.tenantId));
    expect(stamped.find((s) => s.id === westStorm.storm.id)?.b).toBe(west.id);
    // A bill on Main's storm.
    const { generateDrafts } = await import('@/lib/billing');
    await serviceDb().update(storm).set({ status: 'closed', closed_at: new Date().toISOString() }).where(eq(storm.id, mainStorm.storm.id));
    await generateDrafts(ctxOf(w), mainStorm.storm.id);
    expect((await serviceDb().select().from(invoice_draft).where(eq(invoice_draft.storm_id, mainStorm.storm.id))).length).toBeGreaterThan(0);
    const seen = await withUser(mgr, async (tx) => ({
      sites: (await tx.select({ id: site.id }).from(site)).map((r) => r.id),
      storms: (await tx.select({ id: storm.id }).from(storm)).map((r) => r.id),
      crew: (await tx.select({ id: crew_member.id }).from(crew_member)).map((r) => r.id),
      drafts: (await tx.select({ id: invoice_draft.id }).from(invoice_draft)).length,
      visits: (await tx.select({ id: visit.id }).from(visit)).length,
    }));
    expect(seen.sites).toEqual([siteB]);
    expect(seen.storms).toEqual([westStorm.storm.id]);
    expect(seen.crew).toEqual([w.crew2Id]);
    expect(seen.drafts).toBe(0);
    expect(seen.visits).toBe(0);
    // Can't change Main's lots or move one into Main.
    const changed = await withUser(mgr, (tx) => tx.update(site).set({ label: 'Mine now' }).where(eq(site.id, w.siteIds[0]!)).returning());
    expect(changed).toHaveLength(0);
    await expect(withUser(mgr, (tx) => tx.update(site).set({ branch_id: main.id }).where(eq(site.id, siteB)))).rejects.toThrow();
    // The owner still sees everything.
    expect((await withUser(w.userId, (tx) => tx.select({ id: site.id }).from(site))).length).toBe(6);
  });

  it('checks the finer roles by path: billing changes only money, a field lead only runs the board and sees no money', async () => {
    const { roleAllows, seesMoney } = await import('@/lib/roles');
    expect(roleAllows('billing', '/api/storms', 'POST')).toBe(false);
    expect(roleAllows('billing', '/api/storms/x/live', 'GET')).toBe(true);
    expect(roleAllows('billing', '/api/billing/approve', 'POST')).toBe(true);
    expect(roleAllows('field_lead', '/api/storms/x/publish', 'POST')).toBe(true);
    expect(roleAllows('field_lead', '/api/billing/approve', 'POST')).toBe(false);
    expect(roleAllows('field_lead', '/billing', 'GET')).toBe(false);
    expect(roleAllows('field_lead', '/reports/profit', 'GET')).toBe(false);
    expect(roleAllows('field_lead', '/storms/abc', 'GET')).toBe(true);
    expect(seesMoney('field_lead')).toBe(false);
    expect(seesMoney('billing')).toBe(true);
    // A branch manager needs a branch; an owner is never limited.
    const { addMember } = await import('@/lib/team');
    const w = await makeWorld();
    await expect(addMember(w.tenantId, `bm-${randomUUID()}@flake.test`, 'branch_manager', [])).rejects.toMatchObject({ code: 'branch_required' });
  });

  it('adds up: Profit per lot for each branch sums to the company total', async () => {
    const { profitReport } = await import('@/lib/profit');
    const { w, west } = await twoBranches();
    await work(w, w.routeId, w.crewId, 3);
    const s2 = await work(w, w.route2Id, w.crew2Id, 1);
    const { generateDrafts } = await import('@/lib/billing');
    await serviceDb().update(storm).set({ status: 'closed', closed_at: new Date().toISOString() }).where(eq(storm.tenant_id, w.tenantId));
    for (const s of await serviceDb().select({ id: storm.id }).from(storm).where(eq(storm.tenant_id, w.tenantId))) await generateDrafts(ctxOf(w), s.id).catch(() => null);
    await serviceDb().update(invoice_draft).set({ status: 'approved' }).where(eq(invoice_draft.tenant_id, w.tenantId));
    const range = { startAt: new Date(Date.now() - 86_400_000).toISOString(), endAt: new Date(Date.now() + 60_000).toISOString() };
    const [all, westOnly, mainOnly, none] = await withUser(w.userId, async (tx) => Promise.all([
      profitReport(tx, w.tenantId, range),
      profitReport(tx, w.tenantId, { ...range, branchId: west.id }),
      profitReport(tx, w.tenantId, { ...range, branchId: (await tx.select({ id: branch.id }).from(branch).where(and(eq(branch.name, 'Main'), eq(branch.tenant_id, w.tenantId))))[0]!.id }),
      profitReport(tx, w.tenantId, { ...range, branchId: 'none' }),
    ]));
    expect(all.totals.revenue_cents).toBeGreaterThan(0);
    expect(westOnly.totals.revenue_cents + mainOnly.totals.revenue_cents + none.totals.revenue_cents).toBe(all.totals.revenue_cents);
    expect(westOnly.totals.cost_cents + mainOnly.totals.cost_cents + none.totals.cost_cents).toBe(all.totals.cost_cents);
    expect(westOnly.rows.map((r) => r.siteId)).toEqual([w.siteIds[5]]);
    expect(s2.storm.id).toBeTruthy();
  });

  it("sends a branch's alerts to its own managers and not to another branch's", async () => {
    const { alertStaff } = await import('@/lib/messaging');
    const { w, west, main } = await twoBranches();
    const westMgr = await addUser(w, 'branch_manager', [west.id]);
    const mainMgr = await addUser(w, 'branch_manager', [main.id]);
    const billing = await addUser(w, 'billing', null);
    const westStorm = await createStorm(ctxOf(w), { name: 'West storm', routeIds: [w.route2Id] });
    const to = (await alertStaff(w.tenantId, { url: `/storms/${westStorm.storm.id}` })).map((s) => s.user_id);
    expect(to).toContain(w.userId);
    expect(to).toContain(westMgr);
    expect(to).not.toContain(mainMgr);
    expect(to).not.toContain(billing);
    // An alert about nothing in particular reaches every manager.
    const general = (await alertStaff(w.tenantId, { url: '/dashboard' })).map((s) => s.user_id);
    expect(general).toEqual(expect.arrayContaining([westMgr, mainMgr]));
  });

  it("starts and ends a branch's routes at that branch's yard", async () => {
    const { yardForRoute } = await import('@/lib/branches');
    const { w, west } = await twoBranches();
    await serviceDb().update(branch).set({ yard: { address: 'West yard', lat: 41.1, lon: -81.9 } }).where(eq(branch.id, west.id));
    const fallback = { lat: 1, lon: 2 };
    expect(await withUser(w.userId, (tx) => yardForRoute(tx, w.route2Id, fallback))).toEqual({ lat: 41.1, lon: -81.9 });
    expect(await withUser(w.userId, (tx) => yardForRoute(tx, w.routeId, fallback))).toEqual(fallback);
    const [r] = await serviceDb().select({ b: route.branch_id }).from(route).where(eq(route.id, w.route2Id));
    expect(r!.b).toBe(west.id);
  });
});

describe('share links and the renewal pack (issue 236)', () => {
  it('opens a working link, logs it, and refuses a turned-off or expired one; a viewer cannot make one', async () => {
    const { createShare, openShare, revokeShare, listShares } = await import('@/lib/share-links');
    const w = await makeWorld({ plan: 'pro' });
    const made = await withUser(w.userId, (tx) => createShare(tx, w.tenantId, w.userId, { kind: 'renewal', from: '2026-07-01', to: '2027-06-30', days: 30, label: 'Agent' }));
    const token = made.url.split('/share/')[1]!;
    const opened = await openShare(token, { ip: '203.0.113.9', ua: 'Test' });
    expect(opened.company).toBe('Test Plow');
    const [listed] = await withUser(w.userId, (tx) => listShares(tx));
    expect([listed!.opens, listed!.live]).toEqual([1, true]);
    await expect(withUser(w.viewerId, (tx) => createShare(tx, w.tenantId, w.viewerId, { kind: 'renewal', from: '2026-07-01', to: '2027-06-30', days: 7 }))).rejects.toThrow();
    await withUser(w.userId, (tx) => revokeShare(tx, made.id));
    await expect(openShare(token)).rejects.toMatchObject({ status: 404 });
    const old = await withUser(w.userId, (tx) => createShare(tx, w.tenantId, w.userId, { kind: 'renewal', from: '2026-07-01', to: '2027-06-30', days: 7 }));
    await serviceDb().execute(sql`update share_link set expires_at = now() - interval '1 minute' where id = ${old.id}`);
    await expect(openShare(old.url.split('/share/')[1]!)).rejects.toMatchObject({ status: 404 });
  });

  it("counts the same visits a lot's proof packet lists", async () => {
    const { renewalPack } = await import('@/lib/renewal-pack');
    const { assembleProof } = await import('@/lib/proof');
    const w = await makeWorld({ plan: 'pro' });
    await work(w, w.routeId, w.crewId, 3);
    const pack = await renewalPack(w.tenantId, yesterday(), today());
    const proof = await assembleProof(w.tenantId, w.siteIds[0]!, new Date(Date.now() - 86_400_000).toISOString(), new Date().toISOString());
    const lot = pack.sites.find((s) => s.site_id === w.siteIds[0]);
    expect(lot?.visits).toBe(proof.visits.filter((v) => v.departed_device_at).length);
    expect(pack.visits).toBe(3);
    expect(pack.pct_gps).toBe(100);
  });

  it('counts a storm by the company day it started, even late at night when UTC is already tomorrow', async () => {
    const { renewalPack } = await import('@/lib/renewal-pack');
    const w = await makeWorld({ plan: 'pro' });
    await work(w, w.routeId, w.crewId, 2);
    const day = '2026-12-10';
    await serviceDb().execute(sql`update storm set started_at = (${`${day} 23:30`}::timestamp at time zone ${tz}) where tenant_id = ${w.tenantId}`);
    expect((await renewalPack(w.tenantId, day, day)).visits).toBe(2);
    expect((await renewalPack(w.tenantId, '2026-12-11', '2026-12-11')).visits).toBe(0);
  });
});

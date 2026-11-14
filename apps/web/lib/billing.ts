import { and, or, ne, asc, asService, contract, customer, membership, desc, eq, inArray, installment_invoice, invoice_draft, notInArray, isNotNull, isNull, run_stop, serviceDb, site, sql, storm, storm_run, stripe_event, tenant, visit, visit_correction, visit_photo, weather_snapshot, withUser, type Tx } from '@flake/db';
import { applyCorrections, draftInvoices, flagKey, isDraftClean, type BillingContract, type BillingFlag, type BillingVisit } from '@flake/core/billing';
import { applicationFeeCents, feeRate, proFeaturesEnabled, type Plan } from '@flake/core/fees';
import { seasonalInstallments, type ContractService, type Pricing, type SaltPricing, type StormDepthContext } from '@flake/core/pricing';
import { qboCsv, type QboRow } from '@flake/core/qbo';
import { contractsInForce, currentSeason, fmtLocal, isLaterSeason, localHm, todayIn } from '@flake/core/time';
import { sumOverlap } from '@flake/core/trigger';
import type { StripeEventLike } from '@flake/providers';
import { z } from 'zod';
import { flagFix } from '@flake/contracts';
import { HttpError } from './http';
import { enqueue } from './jobs';
import { log } from './log';
import { queueNotify } from './messaging';
import { getProviders } from './providers';
import { seriesFromSummary } from './weather';
import type { Ctx } from './storms';
import { observedSnapshots } from './weather';



// The free season ends on the company's own calendar, not UTC's.
export const tenantFeeRate = (t: { plan: Plan; free_season_until: string | null; timezone: string }) => feeRate(t.plan, t.free_season_until, todayIn(t.timezone));
export const tenantHasPro = (t: { plan: Plan; free_season_until: string | null; timezone: string }) => proFeaturesEnabled(t.plan, t.free_season_until, todayIn(t.timezone));


/**
 * Observed snow at the site during the storm, and NWS elapsed over the storm. Unavailable stays null and is never
 * guessed. An observed (NOHRSC) total counts only when its whole window falls inside the storm: the 24 h total fetched
 * as the storm started is the day before, and a 2" storm after a 6" one would otherwise bill the 6" tier.
 */
async function depthContext(s: typeof storm.$inferSelect, sites: (typeof site.$inferSelect)[]): Promise<Record<string, StormDepthContext>> {
  const db = serviceDb();
  const start = Date.parse(s.started_at);
  const end = s.closed_at ? Date.parse(s.closed_at) : Date.now();
  const snaps = s.forecast_snapshot_ids?.length ? await db.select().from(weather_snapshot).where(inArray(weather_snapshot.id, s.forecast_snapshot_ids)).orderBy(desc(weather_snapshot.fetched_at)) : [];
  const observed = await observedSnapshots(start, end);
  const out: Record<string, StormDepthContext> = {};
  for (const st of sites) {
    const totals = observed.map((x) => x.summary.sites?.[st.id]).filter((v): v is number => typeof v === 'number');
    const grid = snaps.find((x) => x.source === 'nws_grid' && x.office === st.nws_office && x.grid_x === st.nws_grid_x && x.grid_y === st.nws_grid_y);
    out[st.id] = {
      nohrsc24hIn: totals.length ? Math.max(...totals) : null,
      nwsElapsedIn: grid ? sumOverlap(seriesFromSummary(grid.summary).snowIn, start, end) : null,
    };
  }
  return out;
}

/** Everything billing needs, read through RLS. Corrections are replayed by the pure engine. */
async function loadBillingInput(tx: Tx, stormId: string) {
  const [s] = await tx.select().from(storm).where(eq(storm.id, stormId));
  if (!s) throw new HttpError(404, 'Storm not found');
  const [t] = await tx.select({ timezone: tenant.timezone }).from(tenant).where(eq(tenant.id, s.tenant_id));
  const stops = await tx.select({ site_id: run_stop.site_id, status: run_stop.status }).from(run_stop).innerJoin(storm_run, eq(storm_run.id, run_stop.storm_run_id)).where(eq(storm_run.storm_id, stormId));
  const visits = await tx.select().from(visit).where(eq(visit.storm_id, stormId));
  const siteIds = [...new Set([...stops.map((x) => x.site_id), ...visits.map((v) => v.site_id)])];
  const sites = siteIds.length ? await tx.select().from(site).where(inArray(site.id, siteIds)) : [];
  // The contract in force when the storm started (issue 109): the storm's season, so next winter's renewal doesn't price
  // it, and the signature before the storm, so a mid-season re-sign doesn't reprice work already done.
  const contracts = contractsInForce(siteIds.length ? await tx.select().from(contract).where(and(inArray(contract.site_id, siteIds), inArray(contract.status, ['accepted', 'void']))).orderBy(desc(contract.created_at)) : [], s.started_at, t?.timezone);
  const visitIds = visits.map((v) => v.id);
  const photos = visitIds.length ? await tx.select({ visit_id: visit_photo.visit_id, phase: visit_photo.phase }).from(visit_photo).where(inArray(visit_photo.visit_id, visitIds)) : [];
  const corrections = visitIds.length ? await tx.select().from(visit_correction).where(inArray(visit_correction.visit_id, visitIds)).orderBy(visit_correction.created_at) : [];
  const billingVisits: BillingVisit[] = visits.map((v) => ({
    id: v.id, site_id: v.site_id, services: v.services, arrived_at: v.arrived_device_at, departed_at: v.departed_device_at, depth_in: v.depth_in === null ? null : Number(v.depth_in), salt: v.salt,
    is_replow: Boolean(v.is_replow), arrive_lat: v.arrive_lat, arrive_lon: v.arrive_lon, after_photos: photos.filter((p) => p.visit_id === v.id && p.phase === 'after').length,
  }));
  return { s, stops, sites, contracts, billingVisits, corrections };
}

/**
 * A driver can sync after the drafts were made, even after they were charged. Those visits appear on no invoice, so
 * this names them. Seasonal sites and sites with no contract are left out: they have no per-visit price to miss.
 */
export async function visitsMissedByDrafts(ctx: Ctx, stormId: string) {
  return withUser(ctx.userId, async (tx) => {
    const drafts = await tx.select().from(invoice_draft).where(eq(invoice_draft.storm_id, stormId));
    if (!drafts.length) return [];
    const { sites, contracts, billingVisits, corrections } = await loadBillingInput(tx, stormId);
    const billed = new Set(drafts.flatMap((d) => (d.lines as { source_visit_ids: string[] }[]).flatMap((l) => l.source_visit_ids)));
    const done = applyCorrections(billingVisits, corrections.map((c) => ({ visit_id: c.visit_id, field: c.field, new_value: c.new_value }))).filter((v) => v.departed_at && !billed.has(v.id));
    const received = done.length ? await tx.select({ id: visit.id, at: visit.departed_received_at }).from(visit).where(inArray(visit.id, done.map((v) => v.id))) : [];
    return done.flatMap((v) => {
      const st = sites.find((x) => x.id === v.site_id)!;
      const contract = contracts.find((c) => c.site_id === v.site_id);
      const services = (contract?.services ?? []) as ContractService[];
      if (!contract || services.some((s) => s.pricing?.type === 'seasonal')) return [];
      const draft = drafts.find((d) => d.customer_id === st.customer_id);
      const at = received.find((x) => x.id === v.id)?.at;
      if (draft && at && Date.parse(at) <= Date.parse(draft.created_at!)) return [];
      return [{ visit_id: v.id, site: st.label, in_review: draft?.status === 'draft' || !draft }];
    });
  });
}

/** Regenerating replaces drafts still in review. Anything already approved or charged is left alone. */
export async function generateDrafts(ctx: Ctx, stormId: string) {
  return withUser(ctx.userId, async (tx) => {
    const { s, stops, sites, contracts, billingVisits, corrections } = await loadBillingInput(tx, stormId);
    // Mid-storm, more visits and passes are still coming. Charging now would bill half the work and miss the rest.
    if (s.status === 'active') throw new HttpError(409, 'Close the storm first. Invoices are drafted once the work is done.', 'storm_active');
    const [t] = await tx.select().from(tenant).where(eq(tenant.id, ctx.tenantId));
    const depth = await depthContext(s, sites);
    const newestBySite = new Map<string, typeof contract.$inferSelect>();
    for (const c of contracts) if (!newestBySite.has(c.site_id)) newestBySite.set(c.site_id, c);
    const billingContracts: BillingContract[] = [...newestBySite.values()].map((c) => ({ site_id: c.site_id, services: c.services as ContractService[], salt_pricing: c.salt_pricing as SaltPricing | null, season: c.season }));
    const drafts = draftInvoices({
      sites: sites.map((x) => ({ id: x.id, customer_id: x.customer_id, label: x.label, lat: x.lat, lon: x.lon, polygons: x.polygons as any })),
      contracts: billingContracts,
      stops,
      visits: billingVisits,
      corrections: corrections.map((c) => ({ visit_id: c.visit_id, field: c.field, new_value: c.new_value })),
      depth,
      waived: s.waived_flags,
      season: currentSeason(new Date(s.started_at), t!.timezone),
    });
    const rate = tenantFeeRate(t!);
    // The engine prices; this says where and when, so a customer with several sites can read the invoice.
    for (const d of drafts) {
      for (const l of d.lines) {
        const place = sites.find((x) => x.id === l.site_id)?.label ?? 'Site';
        const first = billingVisits.find((v) => v.id === l.source_visit_ids[0]);
        const when = l.source_visit_ids.length === 1 && first ? fmtLocal(first.arrived_at, t!.timezone) : s.name;
        l.description = `${place}: ${l.description}, ${when}`;
      }
    }
    const keep = new Set(drafts.map((d) => d.customer_id));
    const existing = await tx.select().from(invoice_draft).where(eq(invoice_draft.storm_id, stormId));
    const stale = existing.filter((d) => d.status === 'draft' && !keep.has(d.customer_id));
    // Users can read drafts but not write their amounts (issue 8). The storm was read through RLS above, so it's theirs.
    await asService(tx, ctx.tenantId, async () => {
      for (const d of drafts) {
        const fee = applicationFeeCents(d.subtotal_cents, rate);
        await tx.insert(invoice_draft).values({ tenant_id: ctx.tenantId, storm_id: stormId, customer_id: d.customer_id, lines: d.lines, subtotal_cents: d.subtotal_cents, flags: d.flags, application_fee_cents: fee })
          .onConflictDoUpdate({
            target: [invoice_draft.storm_id, invoice_draft.customer_id],
            set: { lines: d.lines, subtotal_cents: d.subtotal_cents, flags: d.flags, application_fee_cents: fee },
            where: sql`${invoice_draft.status} = 'draft' and ${invoice_draft.tenant_id} = ${ctx.tenantId}`,
          });
      }
      if (stale.length) await tx.delete(invoice_draft).where(and(inArray(invoice_draft.id, stale.map((d) => d.id)), eq(invoice_draft.tenant_id, ctx.tenantId), eq(invoice_draft.status, 'draft')));
    });
    await settleStorm(tx, stormId);
    return tx.select({ draft: invoice_draft, customer }).from(invoice_draft).innerJoin(customer, eq(customer.id, invoice_draft.customer_id)).where(eq(invoice_draft.storm_id, stormId));
  });
}

export const draftClean = (flags: unknown) => isDraftClean(flags as BillingFlag[]);

/**
 * A closed storm with nothing left in review is billed, whether its last bill was approved or voided, or it had none
 * to make (only seasonal or skipped lots). Otherwise it would sit on "Ready to bill" for good.
 */
async function settleStorm(tx: Tx, stormId: string) {
  const [open] = await tx.select({ id: invoice_draft.id }).from(invoice_draft).where(and(eq(invoice_draft.storm_id, stormId), eq(invoice_draft.status, 'draft'))).limit(1);
  if (!open) await tx.update(storm).set({ status: 'billed' }).where(and(eq(storm.id, stormId), eq(storm.status, 'closed')));
}

/**
 * A late after photo (issue 75): remake the storm's drafts still in review so their photo flags match what the office
 * sees. Runs as an owner of the company, as pressing Regenerate would; approved and charged invoices are left alone,
 * and nothing happens once every draft has moved on.
 */
export async function redraftAfterLatePhoto(tenantId: string, stormId: string) {
  const db = serviceDb();
  const [s] = await db.select({ status: storm.status }).from(storm).where(and(eq(storm.id, stormId), eq(storm.tenant_id, tenantId)));
  if (s?.status !== 'closed') return;
  const [inReview] = await db.select({ id: invoice_draft.id }).from(invoice_draft).where(and(eq(invoice_draft.storm_id, stormId), eq(invoice_draft.tenant_id, tenantId), eq(invoice_draft.status, 'draft'))).limit(1);
  if (!inReview) return;
  const [owner] = await db.select({ user_id: membership.user_id }).from(membership).where(and(eq(membership.tenant_id, tenantId), eq(membership.role, 'owner'))).limit(1);
  if (!owner) return;
  await generateDrafts({ userId: owner.user_id, tenantId }, stormId);
}

/**
 * Inline fixes from the review table. Waives and corrections are appended, never edits: the visit row
 * stays as it was recorded. The caller regenerates afterwards.
 */
export async function applyFlagFix(ctx: Ctx, fix: z.infer<typeof flagFix>) {
  await withUser(ctx.userId, async (tx) => {
    switch (fix.action) {
      case 'waive': {
        await tx.update(storm).set({ waived_flags: sql`array_append(${storm.waived_flags}, ${fix.flag_key})` }).where(eq(storm.id, fix.storm_id));
        break;
      }
      case 'skip': {
        const runs = await tx.select({ id: storm_run.id }).from(storm_run).where(eq(storm_run.storm_id, fix.storm_id));
        // A driver left on site (no Done) counts too: their half-open visit is voided, as when a driver skips after arriving.
        if (runs.length) await tx.update(run_stop).set({ status: 'skipped', updated_at: new Date().toISOString() }).where(and(inArray(run_stop.storm_run_id, runs.map((r) => r.id)), eq(run_stop.site_id, fix.site_id), inArray(run_stop.status, ['open', 'enroute', 'problem', 'onsite'])));
        const open = await tx.select({ id: visit.id }).from(visit).where(and(eq(visit.storm_id, fix.storm_id), eq(visit.site_id, fix.site_id), isNull(visit.departed_device_at)));
        for (const v of open) await tx.insert(visit_correction).values({ tenant_id: ctx.tenantId, visit_id: v.id, field: 'voided', old_value: false, new_value: true, reason: 'Marked skipped in billing review', by_user: ctx.userId });
        break;
      }
      case 'finish': {
        const [v] = await tx.select().from(visit).where(and(eq(visit.id, fix.visit_id), eq(visit.storm_id, fix.storm_id)));
        if (!v) throw new HttpError(404, 'Visit not found');
        if (v.departed_device_at) break;
        const [s] = await tx.select({ status: storm.status }).from(storm).where(eq(storm.id, fix.storm_id));
        if (s?.status === 'active') throw new HttpError(409, 'This storm is still running, so the driver can still tap Done. Close the storm first.', 'storm_active');
        const now = new Date().toISOString();
        // Completing the visit is the one change the visit table allows. The note says who entered the time.
        await asService(tx, ctx.tenantId, async () => {
          await tx.update(visit).set({ departed_device_at: new Date(Date.parse(v.arrived_device_at) + fix.minutes * 60000).toISOString(), departed_received_at: now, services: fix.services, notes: v.notes ?? 'Done time entered by the office' })
            .where(and(eq(visit.id, v.id), eq(visit.tenant_id, ctx.tenantId), isNull(visit.departed_device_at)));
          if (v.run_stop_id) await tx.update(run_stop).set({ status: 'done', updated_at: now }).where(and(eq(run_stop.id, v.run_stop_id), eq(run_stop.tenant_id, ctx.tenantId)));
        });
        // On record beside the visit, so a proof packet shows the Done time came from the office, not the phone.
        await tx.insert(visit_correction).values({ tenant_id: ctx.tenantId, visit_id: v.id, field: 'notes', old_value: v.notes, new_value: 'Done time entered by the office', reason: `The driver arrived but never tapped Done. The office entered ${fix.minutes} min on site in billing review.`, by_user: ctx.userId });
        break;
      }
      case 'skip_all': {
        const runs = await tx.select({ id: storm_run.id }).from(storm_run).where(eq(storm_run.storm_id, fix.storm_id));
        if (runs.length) await tx.update(run_stop).set({ status: 'skipped', updated_at: new Date().toISOString() }).where(and(inArray(run_stop.storm_run_id, runs.map((r) => r.id)), inArray(run_stop.site_id, fix.site_ids), inArray(run_stop.status, ['open', 'enroute', 'problem'])));
        break;
      }
      case 'replow': {
        await tx.insert(visit_correction).values({ tenant_id: ctx.tenantId, visit_id: fix.visit_id, field: 'is_replow', old_value: false, new_value: true, reason: 'Marked as re-plow in billing review', by_user: ctx.userId });
        break;
      }
      case 'salt': {
        const [v] = await tx.select().from(visit).where(eq(visit.id, fix.visit_id));
        if (!v) throw new HttpError(404, 'Visit not found');
        await tx.insert(visit_correction).values({ tenant_id: ctx.tenantId, visit_id: fix.visit_id, field: 'salt', old_value: v.salt, new_value: [{ unit: fix.unit, qty: fix.qty }], reason: 'Salt quantity added in billing review', by_user: ctx.userId });
        break;
      }
      case 'services': {
        const [v] = await tx.select().from(visit).where(eq(visit.id, fix.visit_id));
        if (!v) throw new HttpError(404, 'Visit not found');
        const services = [...new Set([...v.services, ...fix.services])];
        await tx.insert(visit_correction).values({ tenant_id: ctx.tenantId, visit_id: fix.visit_id, field: 'services', old_value: v.services, new_value: services, reason: `Added ${fix.services.join(', ')} in billing review`, by_user: ctx.userId });
        break;
      }
      case 'depth': {
        // Per-inch lots need a depth. The storm's depth is the deepest on any visit, so one correction prices the lot.
        const [v] = await tx.select().from(visit).where(and(eq(visit.storm_id, fix.storm_id), eq(visit.site_id, fix.site_id), isNotNull(visit.departed_device_at))).orderBy(asc(visit.arrived_device_at)).limit(1);
        if (!v) throw new HttpError(404, 'No finished visit at this site in this storm');
        await tx.insert(visit_correction).values({ tenant_id: ctx.tenantId, visit_id: v.id, field: 'depth_in', old_value: v.depth_in === null ? null : Number(v.depth_in), new_value: fix.depth_in, reason: 'Snow depth entered in billing review', by_user: ctx.userId });
        break;
      }
    }
  });
  return generateDrafts(ctx, fix.storm_id);
}

/**
 * Moving draft to approved is the idempotency gate: a double click finds nothing left to approve. A draft with flags
 * nobody fixed or waived is refused, so a $0 or doubtful invoice can't go out on one click.
 */
export async function approveDrafts(ctx: Ctx, draftIds: string[]) {
  const approved = await withUser(ctx.userId, async (tx) => {
    const rows = await tx.select({ id: invoice_draft.id, flags: invoice_draft.flags, status_detail: invoice_draft.status_detail }).from(invoice_draft).where(and(inArray(invoice_draft.id, draftIds), eq(invoice_draft.status, 'draft')));
    const flagged = rows.filter((r) => !isDraftClean(r.flags as BillingFlag[]));
    if (flagged.length) {
      throw new HttpError(409, rows.length === 1 ? 'This invoice has flags to fix or waive before it can be approved.' : `${flagged.length} of these invoices have flags to fix or waive first.`, 'flagged');
    }
    if (!rows.length) return [];
    const done = await asService(tx, ctx.tenantId, () =>
      tx.update(invoice_draft).set({ status: 'approved', status_detail: null })
        .where(and(inArray(invoice_draft.id, rows.map((r) => r.id)), eq(invoice_draft.tenant_id, ctx.tenantId), eq(invoice_draft.status, 'draft'), sql`${invoice_draft.storm_id} in (select id from storm where status <> 'active')`))
        .returning({ id: invoice_draft.id, storm_id: invoice_draft.storm_id }),
    );
    // A draft taken back for review was approved before, maybe charged and declined. A fresh Stripe key keeps Stripe
    // from replaying that old answer, and a fresh job key lets the charge run again.
    return done.map((d) => ({ ...d, again: Boolean(rows.find((r) => r.id === d.id)?.status_detail) }));
  });
  for (const d of approved) {
    const attempt = d.again ? Date.now() : undefined;
    await enqueue('billing.charge', { tenantId: ctx.tenantId, draftId: d.id, ...(attempt ? { attempt } : {}) }, { dedupeKey: attempt ? `charge:${d.id}:${attempt}` : `charge:${d.id}` });
  }
  const stormIds = [...new Set(approved.map((d) => d.storm_id))];
  if (stormIds.length) {
    await withUser(ctx.userId, async (tx) => {
      for (const id of stormIds) await settleStorm(tx, id);
    });
  }
  return { approved: approved.length };
}

/** One receipt per invoice, once the money arrived: a card charge, a bank debit that cleared, or a pay link paid. */
async function sendReceipt(tenantId: string, draftId: string) {
  const row = await loadDraft(tenantId, draftId);
  if (!row) return;
  const amount = dollars(row.draft.subtotal_cents);
  await queueNotify(tenantId, { email: row.customer.email }, { template: 'receipt', vars: { storm: row.storm.name, amount }, subject: `${row.tenant.name}: payment for ${row.storm.name}, $${amount}`, key: `receipt:${draftId}`, related: { draft_id: draftId } });
}

async function loadDraft(tenantId: string, draftId: string) {
  const [row] = await serviceDb().select({ draft: invoice_draft, customer, tenant, storm }).from(invoice_draft)
    .innerJoin(customer, eq(customer.id, invoice_draft.customer_id))
    .innerJoin(tenant, eq(tenant.id, invoice_draft.tenant_id))
    .innerJoin(storm, eq(storm.id, invoice_draft.storm_id))
    .where(and(eq(invoice_draft.id, draftId), eq(invoice_draft.tenant_id, tenantId)));
  return row ?? null;
}

const dollars = (c: number) => (c / 100).toFixed(2);

async function sendPayLink(row: NonNullable<Awaited<ReturnType<typeof loadDraft>>>, url: string, reason: string) {
  await queueNotify(row.tenant.id, { phone: row.customer.notify_sms ? row.customer.phone_e164 : null, email: row.customer.email }, {
    template: 'invoice',
    vars: { storm: row.storm.name, amount: dollars(row.draft.subtotal_cents), link: url },
    subject: `${row.tenant.name}: invoice for ${row.storm.name}, $${dollars(row.draft.subtotal_cents)}`,
    key: `pay_link:${row.draft.id}`,
    related: { draft_id: row.draft.id, reason },
  });
}

/**
 * Charges again after a failure or after Stripe gets connected. The status gate means one retry per press, and a
 * failed attempt gets a fresh Stripe idempotency key, because Stripe would otherwise replay the same decline.
 */
export async function retryDraft(ctx: Ctx, draftId: string) {
  const [row] = await withUser(ctx.userId, async (tx) => {
    const [mine] = await tx.select({ id: invoice_draft.id }).from(invoice_draft).where(eq(invoice_draft.id, draftId));
    if (!mine) return [];
    return asService(tx, ctx.tenantId, () => tx.update(invoice_draft).set({ status: 'approved', status_detail: null }).where(and(eq(invoice_draft.id, draftId), eq(invoice_draft.tenant_id, ctx.tenantId), inArray(invoice_draft.status, ['failed', 'approved']))).returning({ id: invoice_draft.id }));
  });
  if (!row) throw new HttpError(409, 'This invoice can no longer be retried', 'not_retryable');
  const attempt = Date.now();
  await enqueue('billing.charge', { tenantId: ctx.tenantId, draftId, attempt }, { dedupeKey: `charge:${draftId}:${attempt}` });
  return { ok: true };
}

const NOT_REVISABLE: Record<string, string> = {
  charged: 'This invoice was already charged. Refund it from your Stripe dashboard if needed.',
  paid: 'This invoice is paid. Refund it from your Stripe dashboard if needed.',
  sent: 'This invoice was sent through Stripe. Void it from your Stripe dashboard.',
  void: 'This invoice is already void.',
  draft: 'This invoice is still in review.',
};

/**
 * Takes an approved or failed invoice back to review, voids it, or marks it paid when the customer paid some other way
 * (a check, cash, or before Stripe was connected). Waits for a charge already running on it, then decides from where
 * that charge left it, so a void can't land on top of a payment that just went through.
 */
export async function reviseDraft(ctx: Ctx, draftId: string, to: 'draft' | 'void' | 'paid') {
  return withUser(ctx.userId, async (tx) => {
    const [mine] = await tx.select({ id: invoice_draft.id, storm_id: invoice_draft.storm_id }).from(invoice_draft).where(eq(invoice_draft.id, draftId));
    if (!mine) throw new HttpError(404, 'Invoice not found');
    await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${`charge:${draftId}`}))`);
    const [now] = await tx.select({ status: invoice_draft.status }).from(invoice_draft).where(eq(invoice_draft.id, draftId));
    const from = to === 'void' ? ['draft', 'approved', 'failed'] : ['approved', 'failed'];
    if (!now || !from.includes(now.status!)) throw new HttpError(409, NOT_REVISABLE[now?.status ?? 'void'] ?? 'This invoice can no longer be changed.', 'not_revisable');
    const detail = { void: 'Voided by the office', draft: 'Taken back for review', paid: 'Paid outside Stripe, marked by the office' }[to];
    await asService(tx, ctx.tenantId, () => tx.update(invoice_draft).set({ status: to, status_detail: detail }).where(and(eq(invoice_draft.id, draftId), eq(invoice_draft.tenant_id, ctx.tenantId))));
    // A storm counts as billed once nothing is left in review, so taking one back reopens its billing, and voiding the
    // last one in review finishes it.
    if (to === 'draft') await tx.update(storm).set({ status: 'closed' }).where(and(eq(storm.id, mine.storm_id), eq(storm.status, 'billed')));
    else await settleStorm(tx, mine.storm_id);
    return { ok: true, status: to };
  });
}

/** Failed or needs customer action: status failed, a hosted pay link goes out, and the dashboard shows why. */
export async function failDraft(tenantId: string, draftId: string, reason: string) {
  const row = await loadDraft(tenantId, draftId);
  if (!row || row.draft.status === 'paid' || row.draft.status === 'void') return;
  const { payments } = await getProviders();
  let link = row.draft.pay_link;
  if (!link && row.tenant.stripe_account_id) {
    const created = await payments.createPayLink(row.tenant.stripe_account_id, {
      amountCents: row.draft.subtotal_cents, feeCents: row.draft.application_fee_cents ?? 0, description: `${row.tenant.name}: ${row.storm.name}`, idempotencyKey: `paylink:${draftId}`, metadata: { draft_id: draftId, tenant_id: tenantId },
    });
    link = created.url;
  }
  // A late failure event must not undo a payment or a void that landed meanwhile, nor text a pay link to someone who paid.
  const took = await serviceDb().update(invoice_draft).set({ status: 'failed', status_detail: reason, pay_link: link })
    .where(and(eq(invoice_draft.id, draftId), notInArray(invoice_draft.status, ['paid', 'void']))).returning({ id: invoice_draft.id });
  if (took.length && link) await sendPayLink(row, link, reason);
}

/** billing.charge. Stripe's idempotency key is the draft id, so a retried job cannot double charge. */
export async function chargeDraft(tenantId: string, draftId: string, attempt?: number) {
  // One charge at a time per invoice. Two Retry presses queue two jobs with different Stripe keys; without this both
  // could see "approved" and charge twice. A second job finds the lock taken and stops: the first one settles the status.
  return serviceDb().transaction(async (tx) => {
    const [got] = (await tx.execute(sql`select pg_try_advisory_xact_lock(hashtext(${`charge:${draftId}`})) as ok`)) as unknown as { ok: boolean }[];
    if (!got?.ok) return;
    return chargeDraftLocked(tenantId, draftId, attempt);
  });
}

async function chargeDraftLocked(tenantId: string, draftId: string, attempt?: number) {
  const row = await loadDraft(tenantId, draftId);
  if (!row || row.draft.status !== 'approved') return;
  const db = serviceDb();
  const { draft, customer: c, tenant: t, storm: s } = row;
  const stripeKey = attempt ? `${draftId}:${attempt}` : draftId;
  const setStatus = (status: typeof draft.status, detail: string | null, extra: Partial<typeof invoice_draft.$inferInsert> = {}) => db.update(invoice_draft).set({ status, status_detail: detail, ...extra }).where(eq(invoice_draft.id, draftId));

  if (draft.subtotal_cents <= 0) return void (await setStatus('void', 'Nothing to charge'));
  if (c.billing_mode === 'manual') return void (await setStatus('approved', 'Manual billing: send the customer a bill, then press Mark paid when it is paid.'));
  if (!t.stripe_account_id || !t.stripe_charges_enabled) return void (await setStatus('approved', 'Payments are not connected: bill the customer yourself and press Mark paid, or connect Stripe in Settings and press Charge now.'));

  const { payments } = await getProviders();
  const fee = applicationFeeCents(draft.subtotal_cents, tenantFeeRate(t));
  const metadata = { draft_id: draftId, tenant_id: tenantId, storm_id: s.id };
  const { customerId } = await payments.ensureCustomer(t.stripe_account_id, { existingId: c.stripe_customer_id, email: c.email, name: c.name, tenantId, customerId: c.id });
  if (customerId !== c.stripe_customer_id) await db.update(customer).set({ stripe_customer_id: customerId }).where(eq(customer.id, c.id));

  if (c.billing_mode === 'invoice_net30') {
    const inv = await payments.createInvoice(t.stripe_account_id, {
      customerId, feeCents: fee, daysUntilDue: 30, idempotencyKey: stripeKey, description: `Snow service: ${s.name}`, metadata,
      lines: (draft.lines as { description: string; amount_cents: number }[]).map((l) => ({ description: l.description, amountCents: l.amount_cents })),
    });
    await setStatus('sent', 'Net-30 invoice sent', { stripe_invoice_id: inv.invoiceId, application_fee_cents: fee, pay_link: inv.hostedUrl });
    for (const e of inv.events) await handleStripeEvent(e);
    return;
  }

  if (!c.stripe_payment_method_id) {
    await db.update(invoice_draft).set({ application_fee_cents: fee }).where(eq(invoice_draft.id, draftId));
    return failDraft(tenantId, draftId, 'No card or bank account on file');
  }
  const charge = await payments.chargeOffSession(t.stripe_account_id, {
    customerId, paymentMethodId: c.stripe_payment_method_id, amountCents: draft.subtotal_cents, feeCents: fee, idempotencyKey: stripeKey, description: `${t.name}: ${s.name}`, metadata,
  });
  if (charge.status === 'succeeded' || charge.status === 'processing') {
    // The receipt goes out when Stripe says the money arrived (payment_intent.succeeded, below, or days later for a bank
    // debit), so nobody is told it's paid when a bank payment then bounces.
    await setStatus('charged', charge.status === 'processing' ? 'Bank payment processing' : null, { stripe_payment_intent_id: charge.paymentIntentId, application_fee_cents: fee });
  } else {
    await db.update(invoice_draft).set({ stripe_payment_intent_id: charge.paymentIntentId, application_fee_cents: fee }).where(eq(invoice_draft.id, draftId));
    await failDraft(tenantId, draftId, charge.failure ?? 'Payment failed');
  }
  for (const e of charge.events) await handleStripeEvent(e);
}

const draftIdFrom = (obj: any): string | null => obj?.metadata?.draft_id ?? null;
const tenantIdFrom = (obj: any): string | null => obj?.metadata?.tenant_id ?? null;

/** The single place Stripe events apply, for real webhooks and the mock alike. Dedupes on event id. */
export async function handleStripeEvent(evt: StripeEventLike): Promise<'processed' | 'duplicate'> {
  const db = serviceDb();
  // An event counts as seen only once it was applied. If applying it threw, Stripe's retry finds processed_at still
  // empty and applies it again, instead of a paid invoice staying "charged" forever. Each change below is safe twice.
  const fresh = await db.insert(stripe_event).values({ id: evt.id, type: evt.type })
    .onConflictDoUpdate({ target: stripe_event.id, set: { type: evt.type }, where: sql`${stripe_event.processed_at} is null` })
    .returning({ id: stripe_event.id });
  if (!fresh.length) return 'duplicate';
  const obj = evt.data.object;
  const draftId = draftIdFrom(obj);
  const tenantId = tenantIdFrom(obj);
  switch (evt.type) {
    case 'account.updated':
      await db.update(tenant).set({ stripe_charges_enabled: Boolean(obj.charges_enabled) }).where(eq(tenant.stripe_account_id, obj.id ?? evt.account));
      break;
    case 'setup_intent.succeeded':
      if (obj.metadata?.customer_id && tenantId) {
        await db.update(customer).set({ stripe_payment_method_id: obj.payment_method, stripe_customer_id: obj.customer ?? undefined }).where(and(eq(customer.id, obj.metadata.customer_id), eq(customer.tenant_id, tenantId)));
      }
      break;
    case 'payment_intent.succeeded':
      if (draftId && tenantId) {
        await db.update(invoice_draft).set({ status: 'paid', status_detail: null, stripe_payment_intent_id: obj.id }).where(and(eq(invoice_draft.id, draftId), eq(invoice_draft.tenant_id, tenantId)));
        await sendReceipt(tenantId, draftId);
      }
      break;
    case 'payment_intent.payment_failed':
    case 'payment_intent.requires_action':
      if (draftId && tenantId) await failDraft(tenantId, draftId, obj.last_payment_error?.message ?? 'Payment needs customer action');
      break;
    case 'invoice.finalized':
      if (draftId && tenantId) await db.update(invoice_draft).set({ status: 'sent' }).where(and(eq(invoice_draft.id, draftId), eq(invoice_draft.tenant_id, tenantId), inArray(invoice_draft.status, ['approved', 'sent'])));
      break;
    case 'invoice.paid':
      if (draftId && tenantId) await db.update(invoice_draft).set({ status: 'paid', status_detail: null }).where(and(eq(invoice_draft.id, draftId), eq(invoice_draft.tenant_id, tenantId)));
      // A seasonal installment's Stripe invoice: the customer page shows it paid.
      if (obj.metadata?.contract_id && tenantId && obj.id) await db.update(installment_invoice).set({ status: 'paid' }).where(and(eq(installment_invoice.stripe_invoice_id, obj.id), eq(installment_invoice.tenant_id, tenantId)));
      break;
    case 'invoice.payment_failed':
      if (draftId && tenantId) await failDraft(tenantId, draftId, 'Invoice payment failed');
      if (obj.metadata?.contract_id && tenantId && obj.id) await db.update(installment_invoice).set({ status: 'failed' }).where(and(eq(installment_invoice.stripe_invoice_id, obj.id), eq(installment_invoice.tenant_id, tenantId), ne(installment_invoice.status, 'paid')));
      break;
    case 'charge.dispute.created': {
      const pi = typeof obj.payment_intent === 'string' ? obj.payment_intent : obj.payment_intent?.id;
      if (pi) await db.update(invoice_draft).set({ disputed: true }).where(eq(invoice_draft.stripe_payment_intent_id, pi));
      break;
    }
    // A dispute the company won clears the flag; a lost one keeps it and says so.
    case 'charge.dispute.closed': {
      const pi = typeof obj.payment_intent === 'string' ? obj.payment_intent : obj.payment_intent?.id;
      if (pi) await db.update(invoice_draft).set(obj.status === 'won' ? { disputed: false } : { disputed: true, status_detail: 'Dispute lost: the customer kept the payment' }).where(eq(invoice_draft.stripe_payment_intent_id, pi));
      break;
    }
    // A refund made in Stripe shows on the invoice, so the office doesn't count it as money in.
    case 'charge.refunded': {
      const pi = typeof obj.payment_intent === 'string' ? obj.payment_intent : obj.payment_intent?.id;
      const inv = typeof obj.invoice === 'string' ? obj.invoice : obj.invoice?.id;
      const refunded = Number(obj.amount_refunded ?? 0);
      const detail = obj.refunded || refunded >= Number(obj.amount ?? 0) ? `Refunded $${dollars(refunded)} in Stripe` : `Refunded $${dollars(refunded)} of $${dollars(Number(obj.amount))} in Stripe`;
      const match = pi && inv ? or(eq(invoice_draft.stripe_payment_intent_id, pi), eq(invoice_draft.stripe_invoice_id, inv)) : pi ? eq(invoice_draft.stripe_payment_intent_id, pi) : inv ? eq(invoice_draft.stripe_invoice_id, inv) : null;
      if (match && refunded > 0) await db.update(invoice_draft).set({ status_detail: detail }).where(match);
      break;
    }
    case 'customer.subscription.created':
    case 'customer.subscription.updated':
    case 'customer.subscription.deleted': {
      if (tenantId) {
        const active = evt.type !== 'customer.subscription.deleted' && ['active', 'trialing', 'past_due'].includes(obj.status);
        await db.update(tenant).set({ plan: active ? 'pro' : 'free', stripe_platform_customer_id: obj.customer ?? undefined }).where(eq(tenant.id, tenantId));
      }
      break;
    }
    default:
      log.info('stripe event ignored', { type: evt.type });
  }
  await db.update(stripe_event).set({ processed_at: new Date().toISOString() }).where(eq(stripe_event.id, evt.id));
  return 'processed';
}

type InstallmentRow = { contract: typeof contract.$inferSelect; site: typeof site.$inferSelect; customer: typeof customer.$inferSelect; tenant: typeof tenant.$inferSelect };

/**
 * Monthly job: one Stripe invoice per seasonal installment, so fee logic matches every other payment. Safe to run
 * again in the same month: each installment is recorded with its month before Stripe is called, and a lot that
 * already has this month's installment (on this contract or one it replaced) gets nothing more. One contract failing
 * doesn't stop the rest; the job fails at the end so it retries, and the retry finishes only what's missing.
 */
export async function billInstallments(tenantId?: string, now = new Date()) {
  const db = serviceDb();
  const rows = await db.select({ contract, site, customer, tenant }).from(contract)
    .innerJoin(site, eq(site.id, contract.site_id)).innerJoin(customer, eq(customer.id, site.customer_id)).innerJoin(tenant, eq(tenant.id, contract.tenant_id))
    .where(and(eq(contract.status, 'accepted'), eq(site.active, true), tenantId ? eq(contract.tenant_id, tenantId) : undefined))
    .orderBy(desc(contract.created_at));
  // Only the newest accepted contract for a lot and season bills. Next season's renewal is a different season.
  const seen = new Set<string>();
  let created = 0;
  const failed: unknown[] = [];
  for (const r of rows) {
    const key = `${r.site.id}:${r.contract.season}`;
    if (seen.has(key)) continue;
    seen.add(key);
    // A renewal for next winter starts billing when its season starts, not the month it was signed, so nobody pays two
    // seasons at once (issue 110). An earlier season's unfinished balance is still owed and keeps billing.
    if (isLaterSeason(r.contract.season, currentSeason(now, r.tenant.timezone))) continue;
    const pricing = (r.contract.services as ContractService[]).find((s) => s.pricing?.type === 'seasonal')?.pricing;
    if (pricing?.type !== 'seasonal') continue;
    try {
      if (await billInstallment(r, pricing, now)) created++;
    } catch (err) {
      failed.push(err);
      log.error('installment failed', err, { contract_id: r.contract.id });
    }
  }
  if (failed.length) throw new Error(`${failed.length} seasonal installment${failed.length === 1 ? '' : 's'} failed; the retry bills only those`, { cause: failed[0] });
  return created;
}

async function billInstallment(r: InstallmentRow, pricing: Extract<Pricing, { type: 'seasonal' }>, now: Date) {
  const db = serviceDb();
  // Manual-billing customers stay off Stripe, the same as storm invoices. So does everyone while the company hasn't
  // connected payments: the installment is still recorded, so the office sees it's due and bills it itself.
  const manual = r.customer.billing_mode === 'manual' || !r.tenant.stripe_account_id || !r.tenant.stripe_charges_enabled;
  const period = localHm(now, r.tenant.timezone).date.slice(0, 7);
  const thisMonth = await db.select({ status: installment_invoice.status, contract_id: installment_invoice.contract_id }).from(installment_invoice)
    .innerJoin(contract, eq(contract.id, installment_invoice.contract_id))
    .where(and(eq(contract.site_id, r.site.id), eq(contract.season, r.contract.season), eq(installment_invoice.period, period)));
  if (thisMonth.some((x) => x.status !== 'pending' || x.contract_id !== r.contract.id)) return false;
  // A pending row is an installment whose Stripe invoice didn't finish. That one goes out before any later one.
  const [pending] = await db.select().from(installment_invoice).where(and(eq(installment_invoice.contract_id, r.contract.id), eq(installment_invoice.status, 'pending'))).orderBy(asc(installment_invoice.seq)).limit(1);
  let row = pending;
  if (row) {
    if (row.period !== period) [row] = await db.update(installment_invoice).set({ period }).where(eq(installment_invoice.id, row.id)).returning();
  } else {
    const seq = r.contract.installments_billed + 1;
    if (seq > pricing.installments) return false;
    // A re-sign mid-season (issue 112): what was already billed for this lot and season counts, and the rest of the
    // new total is spread over the installments left, so the season adds up to the price signed.
    const [{ billed }] = await db.select({ billed: sql<number>`coalesce(sum(${installment_invoice.amount_cents}), 0)::int` }).from(installment_invoice)
      .innerJoin(contract, eq(contract.id, installment_invoice.contract_id))
      .where(and(eq(contract.site_id, r.site.id), eq(contract.season, r.contract.season))) as [{ billed: number }];
    const amount = seasonalInstallments(Math.max(0, pricing.total_cents - billed), pricing.installments - seq + 1)[0]!;
    if (amount <= 0) return false;
    [row] = await db.insert(installment_invoice).values({ tenant_id: r.tenant.id, contract_id: r.contract.id, seq, amount_cents: amount, status: 'pending', period }).onConflictDoNothing().returning();
    if (!row) return false; // another run took this one
  }
  const { id, seq, amount_cents: amount } = row!;
  let invoiceId: string | null = null;
  if (!manual) {
    const { payments } = await getProviders();
    const { customerId } = await payments.ensureCustomer(r.tenant.stripe_account_id!, { existingId: r.customer.stripe_customer_id, email: r.customer.email, name: r.customer.name, tenantId: r.tenant.id, customerId: r.customer.id });
    const inv = await payments.createInvoice(r.tenant.stripe_account_id!, {
      customerId, feeCents: applicationFeeCents(amount, tenantFeeRate(r.tenant)), daysUntilDue: 30, idempotencyKey: `installment:${r.contract.id}:${seq}`,
      description: `Seasonal snow service, installment ${seq} of ${pricing.installments}: ${r.site.label}`, lines: [{ description: `Installment ${seq} of ${pricing.installments}: ${r.site.label}`, amountCents: amount }],
      metadata: { tenant_id: r.tenant.id, contract_id: r.contract.id },
    });
    invoiceId = inv.invoiceId;
  }
  await db.transaction(async (tx) => {
    await tx.update(installment_invoice).set({ status: manual ? 'manual' : 'sent', stripe_invoice_id: invoiceId }).where(eq(installment_invoice.id, id));
    await tx.update(contract).set({ installments_billed: sql`greatest(${contract.installments_billed}, ${seq})` }).where(eq(contract.id, r.contract.id));
  });
  return true;
}

/** A seasonal installment the customer paid some other way (a check), or that the office billed itself. */
export async function markInstallmentPaid(ctx: Ctx, id: string) {
  return withUser(ctx.userId, async (tx) => {
    const [row] = await tx.select({ status: installment_invoice.status }).from(installment_invoice).where(eq(installment_invoice.id, id));
    if (!row) throw new HttpError(404, 'Installment not found');
    if (row.status === 'paid') return { ok: true };
    const took = await asService(tx, ctx.tenantId, () => tx.update(installment_invoice).set({ status: 'paid' }).where(and(eq(installment_invoice.id, id), eq(installment_invoice.tenant_id, ctx.tenantId), inArray(installment_invoice.status, ['manual', 'sent', 'failed']))).returning({ id: installment_invoice.id }));
    if (!took.length) throw new HttpError(409, 'This installment is still being sent. Try again in a minute.', 'not_ready');
    return { ok: true };
  });
}

/** Approved invoices only: a draft still in review isn't a sale yet, and may still be voided or left unbilled. */
export async function exportQbo(ctx: Ctx & { timezone: string }, stormId: string) {
  return withUser(ctx.userId, async (tx) => {
    const rows = await tx.select({ draft: invoice_draft, customer, storm }).from(invoice_draft).innerJoin(customer, eq(customer.id, invoice_draft.customer_id)).innerJoin(storm, eq(storm.id, invoice_draft.storm_id)).where(and(eq(invoice_draft.storm_id, stormId), inArray(invoice_draft.status, ['approved', 'charged', 'sent', 'paid', 'failed'])));
    const date = (d: Date) => fmtLocal(d, ctx.timezone, { year: 'numeric', month: '2-digit', day: '2-digit' });
    const out: QboRow[] = [];
    for (const { draft, customer: c, storm: s } of rows) {
      const invDate = new Date(s.closed_at ?? s.started_at);
      // A card or bank on file is charged when approved; only an invoiced customer gets 30 days.
      const onFile = c.billing_mode === 'card_on_file' || c.billing_mode === 'ach_on_file';
      const due = new Date(invDate.getTime() + (onFile ? 0 : 30 * 86400000));
      for (const l of draft.lines as { service: string; description: string; quantity: number; unit_amount_cents: number; amount_cents: number }[]) {
        out.push({ invoiceNo: draft.id.slice(0, 8), customer: c.name, invoiceDate: date(invDate), dueDate: date(due), terms: onFile ? 'Due on receipt' : 'Net 30', memo: s.name, item: l.service, description: l.description, quantity: l.quantity, rateCents: l.unit_amount_cents, amountCents: l.amount_cents });
      }
    }
    return qboCsv(out);
  });
}

export { flagKey };

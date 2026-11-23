import { BUCKETS, BUCKET_LABEL, bucketTotals, localDay, type Bucket } from '@flake/core/receivables';
import { desc, eq, isNull, payment, customer } from '@flake/db';
import { buttonVariants, Card, EmptyState, PageHeader } from '@flake/ui';
import { asUser, requirePage } from '@/lib/auth';
import { money } from '@/lib/client';
import { openBills } from '@/lib/receivables';
import { ReceivablesTable } from './receivables-table';

export const metadata = { title: 'Receivables' };

/** Who owes what and how late (issue 168). Payments, due dates and reminders are recorded here. */
export default async function Receivables({ searchParams }: { searchParams: Promise<{ bucket?: string; customer?: string; page?: string }> }) {
  const q = await searchParams;
  const ctx = await requirePage();
  const tz = ctx.tenant.timezone;
  const today = localDay(new Date(), tz);
  const data = await asUser(ctx, async (tx) => ({
    rows: await openBills(tx, tz, today),
    recent: await tx.select({ p: payment, name: customer.name }).from(payment).innerJoin(customer, eq(customer.id, payment.customer_id)).where(isNull(payment.voided_at)).orderBy(desc(payment.created_at)).limit(15),
  }));
  const totals = bucketTotals(data.rows.map((r) => ({ balanceCents: r.balance_cents, bucket: r.bucket })));
  const bucket = BUCKETS.includes(q.bucket as Bucket) ? (q.bucket as Bucket) : null;
  const shown = data.rows.filter((r) => (!bucket || r.bucket === bucket) && (!q.customer || r.customer_id === q.customer));
  const all = data.rows.reduce((a, r) => a + r.balance_cents, 0);
  // 100 bills a page (issue 228); totals above still count every bill.
  const PAGE = 100;
  const pages = Math.max(1, Math.ceil(shown.length / PAGE));
  const page = Math.min(pages, Math.max(1, Number(q.page) || 1));
  const pageHref = (n: number) => `/receivables?${new URLSearchParams({ ...(bucket ? { bucket } : {}), ...(q.customer ? { customer: q.customer } : {}), page: String(n) }).toString()}`;
  return (
    <>
      <PageHeader title="Receivables" subtitle="Open bills, what is left on each, and how late. Record a check or cash payment here; a part payment leaves the rest open." />
      {/* With nothing owed at all, six $0.00 boxes say less than one line does (UX pass, Nov 23). */}
      {data.rows.length ? <div className="mb-4 grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-6" data-testid="aging-totals">
        <a href="/receivables" className={`rounded-md border p-3 text-sm ${!bucket ? 'border-ink' : 'border-line-faint'}`}>
          <div className="text-muted">All open</div><div className="tabular text-lg font-semibold" data-testid="aging-all">{money(all)}</div>
        </a>
        {BUCKETS.map((b) => (
          <a key={b} href={`/receivables?bucket=${b}`} className={`rounded-md border p-3 text-sm ${bucket === b ? 'border-ink' : 'border-line-faint'}`} data-testid={`aging-${b}`}>
            <div className="text-muted">{BUCKET_LABEL[b]}</div><div className={`tabular text-lg font-semibold ${b !== 'current' && totals[b] ? 'text-danger' : ''}`}>{money(totals[b])}</div>
          </a>
        ))}
      </div> : null}
      {shown.length
        ? <><ReceivablesTable rows={shown.slice((page - 1) * PAGE, page * PAGE)} today={today} readOnly={ctx.role === 'viewer'} />{pages > 1 ? (
          <div className="mt-2 flex flex-wrap items-center gap-2 text-sm" data-testid="receivables-pages">
            {page > 1 ? <a className={buttonVariants({ variant: 'outline', size: 'sm' })} href={pageHref(page - 1)}>Previous</a> : null}
            <span className="text-muted">Page {page} of {pages}, {shown.length} bills</span>
            {page < pages ? <a className={buttonVariants({ variant: 'outline', size: 'sm' })} href={pageHref(page + 1)} data-testid="receivables-next">Next</a> : null}
          </div>
        ) : null}</>
        : <div data-testid="receivables-empty"><EmptyState title={data.rows.length ? 'Nothing in this group' : 'Nothing owed'} body={data.rows.length ? undefined : 'Approved bills that haven’t been paid show here, oldest first, with how late each one is.'} /></div>}
      {data.recent.length ? (
        <Card className="mt-6 max-w-3xl" data-testid="recent-payments">
          <h2 className="font-semibold">Payments recorded</h2>
          <ul className="mt-2 divide-y divide-line-faint text-sm">
            {data.recent.map(({ p, name }) => (
              <li key={p.id} className="flex flex-wrap gap-2 py-1.5"><span>{new Date(`${p.paid_on}T12:00:00Z`).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC' })}</span><span className="font-medium wrap-anywhere">{name}</span><span className="tabular">{money(p.amount_cents)}</span><span className="text-muted">{p.method}{p.reference ? ` ${p.reference}` : ''}</span></li>
            ))}
          </ul>
        </Card>
      ) : null}
    </>
  );
}

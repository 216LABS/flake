import { contract, customer, desc, inArray, site } from '@flake/db';
import { Badge, buttonVariants, EmptyState, Input, PageHeader, Table, Td, Th } from '@flake/ui';
import Link from 'next/link';
import { asUser, requirePage } from '@/lib/auth';
import { billingLabel, kindLabel } from '@/lib/labels';

export const metadata = { title: 'Customers' };

export default async function Customers({ searchParams }: { searchParams: Promise<{ archived?: string; q?: string; waiting?: string }> }) {
  const params = await searchParams;
  const showArchived = params.archived === '1';
  const q = (params.q ?? '').trim().toLowerCase();
  const ctx = await requirePage();
  const { customers: all, sites, quotes } = await asUser(ctx, async (tx) => ({
    customers: await tx.select().from(customer).orderBy(desc(customer.created_at)),
    sites: await tx.select().from(site),
    // Quotes waiting for a signature, sent or handed over as a link.
    quotes: await tx.select({ site_id: contract.site_id }).from(contract).where(inArray(contract.status, ['sent', 'draft'])),
  }));
  const waitingIds = new Set(sites.filter((s) => s.active && quotes.some((k) => k.site_id === s.id)).map((s) => s.customer_id));
  const onlyWaiting = params.waiting === '1';
  const archived = all.filter((c) => c.archived_at);
  const listed = showArchived ? archived : all.filter((c) => !c.archived_at);
  // Name, contact, email, phone, or any of their sites' names and addresses.
  const matches = (c: (typeof all)[number]) => !q || [c.name, c.contact_name, c.email, c.phone_e164, ...sites.filter((s) => s.customer_id === c.id).flatMap((s) => [s.label, s.address])]
    .some((v) => v?.toLowerCase().includes(q));
  const customers = listed.filter(matches).filter((c) => !onlyWaiting || waitingIds.has(c.id));
  const siteCount = (id: string) => sites.filter((s) => s.customer_id === id && s.active).length;
  return (
    <>
      <PageHeader title={showArchived ? 'Archived customers' : 'Customers'} actions={ctx.role !== 'viewer' && !showArchived ? <Link href="/customers/new" className={buttonVariants({ variant: 'accent' })} data-testid="new-customer">New customer</Link> : null} />
      {listed.length > 8 || q ? (
        <form className="mb-3 flex gap-2" role="search" action="/customers">
          {showArchived ? <input type="hidden" name="archived" value="1" /> : null}
          <Input type="search" name="q" defaultValue={params.q ?? ''} aria-label="Search customers" placeholder="Search name, address, email or phone" data-testid="customer-search" />
          <button type="submit" className={buttonVariants({ variant: 'outline' })}>Search</button>
        </form>
      ) : null}
      {onlyWaiting ? <p className="mb-2 text-sm text-muted" data-testid="waiting-filter">Customers with a quote waiting for a signature. <Link className="text-link underline" href="/customers">Show all</Link></p> : null}
      {q ? <p className="mb-2 text-sm text-muted" data-testid="customer-search-count">{customers.length === 1 ? '1 customer matches' : `${customers.length} customers match`} &ldquo;{params.q}&rdquo;. <Link className="text-link underline" href={showArchived ? '/customers?archived=1' : '/customers'}>Show all</Link></p> : null}
      {customers.length ? (
        <Table stack data-testid="customers-table">
          <thead><tr><Th>Name</Th><Th>Kind</Th><Th>Sites</Th><Th>Billing</Th><Th>Payment on file</Th></tr></thead>
          <tbody>
            {customers.map((c) => (
              <tr key={c.id} className="max-md:relative" data-testid="customer-row">
                {/* On a phone the whole card opens the customer (issue 47). */}
                <Td className="max-md:text-base">
                  <Link className="font-semibold text-ink underline-offset-2 hover:underline max-md:after:absolute max-md:after:inset-0" href={`/customers/${c.id}`}>{c.name}</Link>
                  {waitingIds.has(c.id) ? <Badge tone="amber" className="ml-2 align-middle" data-testid="quote-waiting">Quote waiting</Badge> : null}
                  {/* On a phone one line says it all, so a long list stays scannable. */}
                  <span className="block text-sm text-muted md:hidden" data-testid="customer-summary">{[kindLabel(c.kind), siteCount(c.id) === 1 ? '1 site' : `${siteCount(c.id)} sites`, billingLabel(c.billing_mode), c.stripe_payment_method_id ? 'payment on file' : 'no payment on file'].join(' · ')}</span>
                </Td>
                <Td label="Kind" className="max-md:hidden"><Badge>{kindLabel(c.kind)}</Badge></Td>
                <Td label="Sites" className="max-md:hidden">{siteCount(c.id)}</Td>
                <Td label="Billing" className="max-md:hidden">{billingLabel(c.billing_mode)}</Td>
                <Td label="Payment on file" className="max-md:hidden">{c.stripe_payment_method_id ? 'Yes' : 'No'}</Td>
              </tr>
            ))}
          </tbody>
        </Table>
      ) : onlyWaiting ? <EmptyState title="No quotes are waiting" body="Every quote has been signed or answered." /> : q ? <EmptyState title="No customers match" body="Try part of a name, a street, an email or a phone number." /> : showArchived ? <EmptyState title="No archived customers" /> : <EmptyState title="No customers yet" body="Most operators add one in a few minutes." action={<Link href="/customers/new" className={buttonVariants({ variant: 'accent' })}>Add your first customer</Link>} />}
      {showArchived ? <Link className="mt-4 inline-block text-sm text-link underline" href="/customers">Back to customers</Link>
        : archived.length ? <Link className="mt-4 inline-block text-sm text-link underline" href="/customers?archived=1" data-testid="show-archived">Archived customers ({archived.length})</Link> : null}
    </>
  );
}

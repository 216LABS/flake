import { contract, customer, desc, inArray, site } from '@flake/db';
import { Badge, buttonVariants, EmptyState, Input, PageHeader, Table, Td, Th } from '@flake/ui';
import Link from 'next/link';
import { asUser, requirePage } from '@/lib/auth';
import { ButtonLink, FilterTabs } from '@/components/links';
import { billingLabel, kindLabel } from '@/lib/labels';

export const metadata = { title: 'Customers' };

/** A page of customers at a time (issue 146): 227 rows on a phone is 23 screens. */
const PAGE = 100;
const SORTS = { newest: 'Newest first', name: 'Name, A to Z', sites: 'Most sites' } as const;

export default async function Customers({ searchParams }: { searchParams: Promise<{ archived?: string; q?: string; waiting?: string; sort?: string; all?: string }> }) {
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
  const siteCount = (id: string) => sites.filter((s) => s.customer_id === id && s.active).length;
  const sort = (params.sort && params.sort in SORTS ? params.sort : 'newest') as keyof typeof SORTS;
  const found = listed.filter(matches).filter((c) => !onlyWaiting || waitingIds.has(c.id));
  if (sort === 'name') found.sort((a, b) => a.name.localeCompare(b.name, 'en', { sensitivity: 'base', numeric: true }));
  if (sort === 'sites') found.sort((a, b) => siteCount(b.id) - siteCount(a.id) || a.name.localeCompare(b.name));
  const customers = params.all === '1' ? found : found.slice(0, PAGE);
  const keep = (extra: Record<string, string>) => `/customers?${new URLSearchParams({ ...(showArchived ? { archived: '1' } : {}), ...(params.q ? { q: params.q } : {}), ...(sort !== 'newest' ? { sort } : {}), ...extra }).toString()}`;
  return (
    <>
      <PageHeader title={showArchived ? 'Archived customers' : 'Customers'} actions={ctx.role !== 'viewer' && !showArchived ? <><Link href="/bids" className={buttonVariants({ variant: 'outline' })} data-testid="open-bids">Bids and renewals</Link><Link href="/customers/import" className={buttonVariants({ variant: 'outline' })} data-testid="import-customers">Import</Link><Link href="/customers/new" className={buttonVariants({ variant: 'accent' })} data-testid="new-customer">New customer</Link></> : null} />
      {archived.length || showArchived ? <FilterTabs label="Which customers" items={[{ href: '/customers', label: 'Active', active: !showArchived }, { href: '/customers?archived=1', label: `Archived (${archived.length})`, active: showArchived, testId: 'show-archived' }]} /> : null}
      {listed.length > 8 || q ? (
        <form className="mb-3 flex gap-2" role="search" action="/customers">
          {showArchived ? <input type="hidden" name="archived" value="1" /> : null}
          <Input type="search" name="q" defaultValue={params.q ?? ''} aria-label="Search customers" placeholder="Search name, address, email or phone" data-testid="customer-search" />
          <select name="sort" defaultValue={sort} aria-label="Sort customers" className="h-10 rounded-control border border-line bg-surface px-2 text-sm" data-testid="customer-sort">
            {Object.entries(SORTS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
          </select>
          <button type="submit" className={buttonVariants({ variant: 'outline' })}>Show</button>
        </form>
      ) : null}
      {onlyWaiting ? <p className="mb-2 text-sm text-muted" data-testid="waiting-filter">Customers with a quote waiting for a signature. <ButtonLink variant="ghost" size="sm" href="/customers">Show all</ButtonLink></p> : null}
      {q ? <p className="mb-2 text-sm text-muted" data-testid="customer-search-count">{found.length === 1 ? '1 customer matches' : `${found.length} customers match`} &ldquo;{params.q}&rdquo;. <ButtonLink variant="ghost" size="sm" href={showArchived ? '/customers?archived=1' : '/customers'}>Clear search</ButtonLink></p> : null}
      {customers.length ? (
        <Table stack data-testid="customers-table">
          <thead><tr><Th>Name</Th><Th>Kind</Th><Th>Sites</Th><Th>Billing</Th><Th>Payment on file</Th></tr></thead>
          <tbody>
            {customers.map((c) => (
              <tr key={c.id} className="max-md:relative" data-testid="customer-row">
                {/* On a phone the whole card opens the customer (issue 47). */}
                <Td className="wrap-anywhere max-md:text-base">
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
      {customers.length < found.length ? <p className="mt-3 text-sm text-muted" data-testid="customers-more">Showing {customers.length} of {found.length}. <ButtonLink variant="outline" size="sm" href={keep({ all: '1' })}>Show all {found.length}</ButtonLink></p> : null}
    </>
  );
}

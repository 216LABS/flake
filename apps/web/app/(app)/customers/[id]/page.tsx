import { contract, customer, desc, eq, inArray, installment_invoice, invoice_draft, site, sql, storm } from '@flake/db';
import { Badge, buttonVariants, Card, PageHeader, Table, Td, Th } from '@flake/ui';
import { ArchiveCustomer, CustomerEditor } from './customer-editor';
import { PortalCard } from './portal-card';
import { InstallmentPaid } from './installment-paid';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { asUser, requirePage } from '@/lib/auth';
import { isUuid } from '@/lib/http';
import { money } from '@/lib/client';
import { invoiceStatus } from '@/lib/labels';

export const metadata = { title: 'Customer' };

export default async function CustomerPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!isUuid(id)) notFound();
  const ctx = await requirePage();
  const data = await asUser(ctx, async (tx) => {
    const [c] = await tx.select().from(customer).where(eq(customer.id, id));
    if (!c) return null;
    const sites = await tx.select().from(site).where(eq(site.customer_id, id));
    const contracts = sites.length ? await tx.select().from(contract).where(inArray(contract.site_id, sites.map((s) => s.id))).orderBy(desc(contract.created_at)) : [];
    // Every bill past review, newest first: what was charged, what's paid, and what they still owe.
    const invoices = await tx.select({ id: invoice_draft.id, status: invoice_draft.status, status_detail: invoice_draft.status_detail, total: invoice_draft.subtotal_cents, storm_id: storm.id, storm: storm.name, at: storm.started_at })
      .from(invoice_draft).innerJoin(storm, eq(storm.id, invoice_draft.storm_id)).where(eq(invoice_draft.customer_id, id)).orderBy(desc(storm.started_at)).limit(50);
    const installments = sites.length ? await tx.select({ id: installment_invoice.id, seq: installment_invoice.seq, amount: installment_invoice.amount_cents, status: installment_invoice.status, period: installment_invoice.period, season: contract.season, services: contract.services, site_id: contract.site_id })
      .from(installment_invoice).innerJoin(contract, eq(contract.id, installment_invoice.contract_id)).where(inArray(contract.site_id, sites.map((s) => s.id))).orderBy(desc(installment_invoice.created_at)).limit(50) : [];
    // Everything still owed, not just the bills listed: the same sum the dashboard shows.
    const [{ owed } = { owed: 0 }] = (await tx.execute(sql`select coalesce((select sum(subtotal_cents) from invoice_draft where customer_id = ${id} and status in ('approved', 'sent', 'failed')), 0)::int
      + coalesce((select sum(i.amount_cents) from installment_invoice i join contract k on k.id = i.contract_id join site s on s.id = k.site_id where s.customer_id = ${id} and i.status in ('manual', 'sent', 'failed')), 0)::int as owed`)) as unknown as { owed: number }[];
    return { c, sites, contracts, invoices: invoices.filter((i) => i.status !== 'draft'), installments, owed };
  });
  if (!data) notFound();
  const { c, sites, contracts, invoices, installments, owed } = data;
  const unpaidInstallment = (status: string) => status === 'manual' || status === 'sent' || status === 'failed';
  const INSTALLMENT_STATUS: Record<string, string> = { manual: 'Bill it yourself', pending: 'Sending', sent: 'Invoice sent', paid: 'Paid', failed: 'Payment failed' };
  const ofCount = (services: unknown) => (services as { pricing?: { type: string; installments?: number } }[]).find((x) => x.pricing?.type === 'seasonal')?.pricing?.installments;
  return (
    <>
      <PageHeader title={<>{c.name}{c.archived_at ? <Badge className="ml-2 align-middle" data-testid="archived-badge">archived</Badge> : null}</>} subtitle={c.kind === 'hoa' ? 'HOA' : `${c.kind[0]!.toUpperCase()}${c.kind.slice(1)}`} actions={ctx.role === 'viewer' ? null : <>
        {c.archived_at ? null : <Link href={`/customers/new?customer=${c.id}`} className={buttonVariants({ variant: 'accent' })} data-testid="add-site">Add a site</Link>}
        <ArchiveCustomer id={c.id} name={c.name} archived={Boolean(c.archived_at)} />
      </>} />
      <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
        <CustomerEditor customer={c} />
        <Card>
          <h2 className="font-semibold">Notices and payment</h2>
          <p className="mt-1 text-sm">Texts: {c.notify_sms ? 'yes' : 'no'}. Emails: {c.notify_email ? 'yes' : 'no'}.</p>
          <p className="text-sm">Payment on file: {c.stripe_payment_method_id ? 'yes' : 'no'}</p>
          <p className="mt-2 text-xs text-faint">Customers choose texts and add a payment method themselves on their quote page.</p>
        </Card>
        {ctx.role === 'viewer' ? null : <PortalCard customerId={c.id} email={c.email} />}
      </div>
      <h2 className="mb-2 mt-6 font-semibold">Sites</h2>
      <Table stack>
        <thead><tr><Th>Site</Th><Th>Address</Th><Th>Area</Th><Th>Contract</Th></tr></thead>
        <tbody>
          {[...sites].sort((a, b) => Number(Boolean(b.active)) - Number(Boolean(a.active))).map((s) => {
            // The signed agreement wins, even with a renewal waiting or declined beside it; otherwise the newest offer.
            const k = contracts.find((x) => x.site_id === s.id && x.status === 'accepted') ?? contracts.find((x) => x.site_id === s.id && x.status !== 'void');
            return (
              <tr key={s.id} className={s.active ? '' : 'text-faint'} data-testid="site-row" data-active={String(Boolean(s.active))}>
                <Td><Link className="text-link underline" href={`/sites/${s.id}`}>{s.label}</Link>{s.active ? null : <Badge className="ml-2">retired</Badge>}</Td>
                <Td label="Address">{s.address}</Td>
                <Td label="Area">{s.area_confirmed_sqft ? `${Number(s.area_confirmed_sqft).toLocaleString()} sq ft` : s.area_estimate_sqft ? `~${Number(s.area_estimate_sqft).toLocaleString()} sq ft` : 'unavailable'}</Td>
                <Td label="Contract"><Badge tone={k?.status === 'accepted' ? 'green' : 'amber'}>{k ? ({ accepted: `signed ${k.season}`, sent: 'quote sent', draft: 'quote waiting', declined: 'quote declined' } as Record<string, string>)[k.status] ?? k.status : 'none'}</Badge></Td>
              </tr>
            );
          })}
        </tbody>
      </Table>
      <h2 className="mb-2 mt-6 font-semibold">Invoices</h2>
      {invoices.length || installments.length ? (
        <>
          {owed ? <p className="mb-2 text-sm" data-testid="customer-owed">Still owed: <b className="tabular">{money(owed)}</b></p> : null}
          {invoices.length ? <Table stack>
            <thead><tr><Th>Storm</Th><Th>Total</Th><Th>Status</Th></tr></thead>
            <tbody>
              {invoices.map((i) => (
                <tr key={i.id} data-testid="customer-invoice">
                  <Td><Link className="text-link underline" href={`/billing?storm=${i.storm_id}`}>{i.storm}</Link></Td>
                  <Td label="Total" className="tabular">{money(i.total)}</Td>
                  <Td label="Status"><div className="min-w-0">{invoiceStatus(i.status ?? '')}{i.status_detail ? <span className="block text-xs text-muted">{i.status_detail}</span> : null}</div></Td>
                </tr>
              ))}
            </tbody>
          </Table> : null}
          {installments.length ? (
            <>
              <h3 className="mb-2 mt-4 text-sm font-semibold">Seasonal installments</h3>
              <Table stack>
                <thead><tr><Th>Installment</Th><Th>Amount</Th><Th>Status</Th></tr></thead>
                <tbody>
                  {installments.map((i) => {
                    const lot = sites.find((s) => s.id === i.site_id)?.label ?? 'Site';
                    const of = ofCount(i.services);
                    const label = `${lot}, ${i.season} installment ${i.seq}${of ? ` of ${of}` : ''}`;
                    return (
                      <tr key={i.id} data-testid="customer-installment">
                        <Td><div className="min-w-0">{label}{i.period && /^\d{4}-\d{2}$/.test(i.period) ? <span className="block text-xs text-muted">{new Date(`${i.period}-15T12:00:00Z`).toLocaleDateString('en-US', { month: 'long', year: 'numeric', timeZone: 'UTC' })}</span> : null}</div></Td>
                        <Td label="Amount" className="tabular">{money(i.amount)}</Td>
                        <Td label="Status"><div className="min-w-0">{INSTALLMENT_STATUS[i.status] ?? i.status}{ctx.role !== 'viewer' && unpaidInstallment(i.status) ? <div className="mt-1"><InstallmentPaid id={i.id} label={label} /></div> : null}</div></Td>
                      </tr>
                    );
                  })}
                </tbody>
              </Table>
            </>
          ) : null}
        </>
      ) : <p className="text-sm text-muted">No invoices yet. They show here once a storm&apos;s bills are approved.</p>}
    </>
  );
}

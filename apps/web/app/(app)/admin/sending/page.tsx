import { PageHeader } from '@flake/ui';
import { notFound } from 'next/navigation';
import { requirePage } from '@/lib/auth';
import { isOutboundAdmin, listOutbound } from '@/lib/outbound';
import { SendingAdmin } from './sending-admin';

export const metadata = { title: 'Sending' };
export const dynamic = 'force-dynamic';

/** 216LABS only (issue 171): which companies Flake sends email and texts for. Every company starts off. */
export default async function SendingPage() {
  const ctx = await requirePage();
  if (!isOutboundAdmin(ctx.email)) notFound();
  const rows = await listOutbound();
  return (
    <>
      <PageHeader title="Sending" subtitle="Flake sends email and texts only for companies turned on here. Login codes are not affected. Texts still need the company's verified number and each person's opt-in." />
      <SendingAdmin rows={JSON.parse(JSON.stringify(rows))} tz={ctx.tenant.timezone} />
    </>
  );
}

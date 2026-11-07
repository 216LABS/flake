import { desc, message_log } from '@flake/db';
import { fmtLocal } from '@flake/core/time';
import { Badge, PageHeader, Table, Td, Th } from '@flake/ui';
import { asUser, requirePage } from '@/lib/auth';
import { InboundForm } from './inbound-form';

export default async function Inbox() {
  const ctx = await requirePage();
  const rows = await asUser(ctx, (tx) => tx.select().from(message_log).orderBy(desc(message_log.created_at)).limit(200));
  return (
    <>
      <PageHeader title="Dev inbox" subtitle="Every text and email the mocks would have sent." />
      <InboundForm />
      <Table>
        <thead><tr><Th>When</Th><Th>Channel</Th><Th>To</Th><Th>Template</Th><Th>Body</Th><Th>Status</Th></tr></thead>
        <tbody>
          {rows.map((m) => (
            <tr key={m.id} data-testid="inbox-row" data-template={m.template} data-channel={m.channel}>
              <Td>{fmtLocal(m.created_at!, ctx.tenant.timezone)}</Td>
              <Td><Badge>{m.channel}</Badge></Td>
              <Td>{m.to_addr}</Td>
              <Td>{m.template}</Td>
              <Td className="whitespace-pre-wrap">{m.body}</Td>
              <Td>{m.status}</Td>
            </tr>
          ))}
        </tbody>
      </Table>
    </>
  );
}

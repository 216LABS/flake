import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { customersFromCsv } from '@/lib/csv';

const fixture = (name: string) => readFileSync(resolve(__dirname, 'fixtures', name), 'utf8');

describe('issue 239: Jobber and Service Autopilot exports import as they are', () => {
  it('reads a Jobber client export: display name, the service address over billing, the first phone and email', () => {
    const out = customersFromCsv(fixture('jobber-clients.csv'));
    expect(out.source).toBe('jobber');
    expect(out.missing).toEqual([]);
    expect(out.rows[0]).toMatchObject({ name: 'Harbor Point HOA', address: '14701 Detroit Ave Unit A, Lakewood, OH 44107', email: 'board@example.com', phone: '216-555-0141', problem: null });
    // No service address on this client: the billing address is the lot. Several emails in one cell: the first.
    expect(out.rows[1]).toMatchObject({ name: 'Kim Lee', address: '1400 Clarence Ave, Lakewood, OH 44107', email: 'kim@example.com', phone: '216-555-0143', problem: null });
    expect(out.used).toMatchObject({ name: 'Display Name', address: 'Service Street 1 + Service Street 2 + Service City + Service State + Service Zip code' });
  });

  it('reads a Service Autopilot client export, client type as the kind', () => {
    const out = customersFromCsv(fixture('service-autopilot-clients.csv'));
    expect(out.source).toBe('service_autopilot');
    expect(out.rows.map((r) => [r.name, r.address, r.kind, r.problem])).toEqual([
      ['Rocky Auto Service', '20100 Detroit Rd, Rocky River, OH 44116', 'Commercial', null],
      ['Pine Church', '1800 W 117th St, Cleveland, OH 44102', 'Commercial', null],
    ]);
  });

  it('lets an unknown column be picked by hand, and says what is missing without it', () => {
    const csv = 'Who,Where\nKim,1400 Clarence Ave Lakewood OH\n';
    expect(customersFromCsv(csv).missing).toEqual(['name', 'address']);
    const picked = customersFromCsv(csv, { name: 0, address: 1 });
    expect(picked.missing).toEqual([]);
    expect(picked.rows[0]).toMatchObject({ name: 'Kim', address: '1400 Clarence Ave Lakewood OH', problem: null });
  });
});

import { randomUUID } from 'node:crypto';
import { afterAll, describe, expect, it } from 'vitest';
import { closeDb, membership, serviceDb, sql, tenant } from '@flake/db';
import { parseEnabled, ssoErrorCode, ssoErrorText, teamAccountForEmail } from '../lib/sso';

/** Issue 242: Microsoft and Google sign-in. */
describe('SSO', () => {
  afterAll(async () => closeDb());

  it('shows a provider only when the Supabase project has it on', () => {
    expect(parseEnabled({ external: { azure: true, google: false, github: true, email: true } })).toEqual(['azure']);
    expect(parseEnabled({ external: { google: true, azure: true } })).toEqual(['azure', 'google']);
    expect(parseEnabled({})).toEqual([]);
    expect(parseEnabled(null)).toEqual([]);
    expect(parseEnabled({ external: { google: 'true' } })).toEqual([]);
  });

  it('turns callback errors into short codes and plain words', () => {
    expect(ssoErrorCode('access_denied', 'The user cancelled')).toBe('access_denied');
    expect(ssoErrorCode('server_error', 'Identity is already linked to another user')).toBe('link_taken');
    expect(ssoErrorCode('access_denied', 'Manual linking is disabled')).toBe('link_off');
    expect(ssoErrorCode(null, 'invalid flow state, no valid flow state found')).toBe('expired');
    expect(ssoErrorCode(null, 'code verifier should be non-empty')).toBe('expired');
    expect(ssoErrorCode('server_error', 'Error getting user email from external provider')).toBe('failed');
    for (const c of ['access_denied', 'link_taken', 'link_off', 'expired', 'failed', 'anything']) expect(ssoErrorText(c)).toMatch(/\w/);
    expect(ssoErrorText(null)).toBeNull();
    // A made-up code in the URL shows the general words, never itself.
    expect(ssoErrorText('<script>')).not.toContain('<');
  });

  it('spots a second, empty account made by a provider sign-in for an email the office already added', async () => {
    const tag = randomUUID().slice(0, 8);
    const email = `split-${tag}@flake.test`;
    const [t] = await serviceDb().insert(tenant).values({ name: `zz Split ${tag}`, slug: `zz-split-${tag}`, timezone: 'America/New_York' }).returning();
    const member = randomUUID();
    const other = randomUUID();
    await serviceDb().execute(sql`insert into auth.users (id, email, aud, role, instance_id) values (${member}::uuid, ${email}, 'authenticated', 'authenticated', '00000000-0000-0000-0000-000000000000'), (${other}::uuid, ${email.toUpperCase()}, 'authenticated', 'authenticated', '00000000-0000-0000-0000-000000000000')`);
    await serviceDb().insert(membership).values({ tenant_id: t!.id, user_id: member, role: 'dispatcher' });
    try {
      expect(await teamAccountForEmail(other, email.toUpperCase())).toBe(true);
      // The team member themself isn't told they're split.
      expect(await teamAccountForEmail(member, email)).toBe(false);
      expect(await teamAccountForEmail(other, `nobody-${tag}@flake.test`)).toBe(false);
      expect(await teamAccountForEmail(other, null)).toBe(false);
    } finally {
      await serviceDb().execute(sql`delete from membership where tenant_id = ${t!.id}`);
      await serviceDb().execute(sql`delete from tenant where id = ${t!.id}`);
      await serviceDb().execute(sql`delete from auth.users where id in (${member}::uuid, ${other}::uuid)`);
    }
  });
});

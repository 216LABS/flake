import { and, desc, eq, gt, isNull, proof_packet, serviceDb, share_link, share_link_open, site, sql, tenant, type Tx } from '@flake/db';
import { baseUrl } from './env';
import { HttpError } from './http';
import { decryptToken, encryptToken, hashToken, newToken, sha256Hex } from './tokens';

/**
 * Sharing a proof packet or the insurance renewal pack with someone who isn't a customer (issue 236): an agent, an
 * adjuster or an attorney. An expiring, revocable link to a read-only page with that one document, never the records
 * page or other packets. Every open is logged (hashed IP, browser). Nothing is emailed: the office copies or texts it.
 */
export const shareUrl = (token: string) => `${baseUrl()}/share/${token}`;

export async function createShare(tx: Tx, tenantId: string, userId: string, b: { kind: 'proof' | 'renewal'; proof_packet_id?: string; from?: string; to?: string; days: number; label?: string | null }) {
  if (b.kind === 'proof') {
    const [p] = await tx.select({ id: proof_packet.id }).from(proof_packet).where(eq(proof_packet.id, b.proof_packet_id ?? '00000000-0000-0000-0000-000000000000'));
    if (!p) throw new HttpError(404, 'Proof packet not found');
  } else if (!b.from || !b.to || b.to < b.from) throw new HttpError(422, 'Pick the dates for the renewal pack.');
  const token = newToken();
  const [row] = await tx.insert(share_link).values({
    tenant_id: tenantId, kind: b.kind, proof_packet_id: b.kind === 'proof' ? b.proof_packet_id! : null, params: b.kind === 'renewal' ? { from: b.from, to: b.to } : {},
    label: b.label?.trim() || null, token_hash: hashToken(token), token_enc: encryptToken(token), expires_at: new Date(Date.now() + b.days * 86400000).toISOString(), created_by: userId,
  }).returning();
  return { ...row!, url: shareUrl(token) };
}

/** The office's list: each link, whether it still works, and when it was opened. Viewers see it; only writers change it. */
export async function listShares(tx: Tx) {
  const rows = await tx.select().from(share_link).orderBy(desc(share_link.created_at)).limit(100);
  const opens = rows.length ? await tx.select({ id: share_link_open.share_link_id, n: sql<number>`count(*)::int`, last: sql<string | null>`max(${share_link_open.opened_at})` }).from(share_link_open).groupBy(share_link_open.share_link_id) : [];
  return rows.map((r) => ({
    id: r.id, kind: r.kind, label: r.label, proof_packet_id: r.proof_packet_id, params: r.params, expires_at: r.expires_at, revoked_at: r.revoked_at, created_at: r.created_at,
    url: r.token_enc && !r.revoked_at ? shareUrl(decryptToken(r.token_enc)) : null,
    live: !r.revoked_at && Date.parse(r.expires_at) > Date.now(),
    opens: opens.find((o) => o.id === r.id)?.n ?? 0, last_open: opens.find((o) => o.id === r.id)?.last ?? null,
  }));
}

export async function revokeShare(tx: Tx, id: string) {
  const [r] = await tx.update(share_link).set({ revoked_at: new Date().toISOString() }).where(and(eq(share_link.id, id), isNull(share_link.revoked_at))).returning({ id: share_link.id });
  if (!r) throw new HttpError(404, 'That link is gone or already turned off.');
  return { ok: true };
}

/** The public side: a working link's document, and its open logged. A revoked, expired or unknown link is a 404. */
export async function openShare(token: string, seen?: { ip?: string | null; ua?: string | null }) {
  const db = serviceDb();
  const [r] = await db.select({ link: share_link, company: tenant.name }).from(share_link).innerJoin(tenant, eq(tenant.id, share_link.tenant_id))
    .where(and(eq(share_link.token_hash, hashToken(token)), isNull(share_link.revoked_at), gt(share_link.expires_at, new Date().toISOString())));
  if (!r) throw new HttpError(404, 'This link has expired or was turned off.');
  if (seen) await db.insert(share_link_open).values({ tenant_id: r.link.tenant_id, share_link_id: r.link.id, ip_hash: seen.ip ? sha256Hex(`${r.link.id}:${seen.ip}`).slice(0, 32) : null, user_agent: seen.ua?.slice(0, 300) ?? null });
  const packet = r.link.proof_packet_id ? (await db.select({ p: proof_packet, label: site.label }).from(proof_packet).innerJoin(site, eq(site.id, proof_packet.site_id)).where(eq(proof_packet.id, r.link.proof_packet_id)))[0] : null;
  return { link: r.link, company: r.company, packet: packet ? { ...packet.p, site: packet.label } : null };
}

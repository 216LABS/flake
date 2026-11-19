import { eq, serviceDb, tenant } from '@flake/db';
import { getBlob, putBlob, removeBlob } from './blob';
import { HttpError } from './http';

export const LOGO_MAX_BYTES = 1_000_000;

/** PNG or JPEG only, by its first bytes, not its label: those are what PDFs can draw. */
export function logoType(bytes: Uint8Array): 'png' | 'jpg' | null {
  if (bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47) return 'png';
  if (bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return 'jpg';
  return null;
}

/** Where a customer page loads the company's logo from (issue 173), or null without one. The file name busts caches. */
export const logoUrl = (t: { id: string; logo_path: string | null }) => (t.logo_path ? `/api/logo/${t.id}?v=${t.logo_path.split('/').pop()!.split('.')[0]}` : null);

/** Saves a new logo for the company and removes the old file. Server-written: owners have no grant on logo_path. */
export async function saveLogo(tenantId: string, bytes: Uint8Array) {
  if (bytes.length > LOGO_MAX_BYTES) throw new HttpError(413, 'That logo is over 1 MB. Save it smaller and try again.');
  const kind = logoType(bytes);
  if (!kind) throw new HttpError(422, 'Upload the logo as a PNG or JPEG.', 'bad_type');
  const path = `${tenantId}/logo/${crypto.randomUUID()}.${kind}`;
  await putBlob('contracts', path, bytes, kind === 'png' ? 'image/png' : 'image/jpeg');
  const [old] = await serviceDb().select({ logo_path: tenant.logo_path }).from(tenant).where(eq(tenant.id, tenantId));
  await serviceDb().update(tenant).set({ logo_path: path }).where(eq(tenant.id, tenantId));
  if (old?.logo_path) await removeBlob('contracts', old.logo_path).catch(() => undefined);
  return path;
}

export async function removeLogo(tenantId: string) {
  const [old] = await serviceDb().select({ logo_path: tenant.logo_path }).from(tenant).where(eq(tenant.id, tenantId));
  await serviceDb().update(tenant).set({ logo_path: null }).where(eq(tenant.id, tenantId));
  if (old?.logo_path) await removeBlob('contracts', old.logo_path).catch(() => undefined);
}

/** The logo's bytes for a PDF, or null. */
export async function logoBytes(t: { logo_path: string | null }): Promise<{ data: Uint8Array; format: 'png' | 'jpg' } | null> {
  if (!t.logo_path) return null;
  const data = await getBlob('contracts', t.logo_path).catch(() => null);
  const format = data ? logoType(data) : null;
  return data && format ? { data, format } : null;
}

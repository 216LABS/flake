import { createCipheriv, createDecipheriv, createHash, createHmac, randomBytes } from 'node:crypto';
import { required } from './env';

/** Link tokens: 32 random bytes, stored only as an HMAC-SHA256 hash (ADDENDUM_DEVOPS section 6). */
export const newToken = () => randomBytes(32).toString('base64url');
export const hashToken = (token: string) => createHmac('sha256', required('LINK_TOKEN_SECRET')).update(token).digest('hex');

const key = () => createHash('sha256').update(`enc:${required('LINK_TOKEN_SECRET')}`).digest();

/** Lets the dashboard show a QR or copy-link after publish without keeping the token in the clear. */
export function encryptToken(token: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', key(), iv);
  const body = Buffer.concat([cipher.update(token, 'utf8'), cipher.final()]);
  return Buffer.concat([iv, cipher.getAuthTag(), body]).toString('base64url');
}

export function decryptToken(enc: string): string {
  const raw = Buffer.from(enc, 'base64url');
  const decipher = createDecipheriv('aes-256-gcm', key(), raw.subarray(0, 12));
  decipher.setAuthTag(raw.subarray(12, 28));
  return Buffer.concat([decipher.update(raw.subarray(28)), decipher.final()]).toString('utf8');
}

export const shortCode = () => randomBytes(6).toString('base64url');
export const sha256Hex = (data: Uint8Array | string) => createHash('sha256').update(data).digest('hex');

/** How long a crew join link works (issue 137). */
export const INVITE_DAYS = 14;

/**
 * A crew join link carries when it was made, so it can expire without a column: "<base36 ms>.<random>". The whole token
 * is hashed, so the time can't be changed without breaking the hash. Links made before this have no time and still work.
 */
export const newInviteToken = (now = Date.now()) => `${now.toString(36)}.${newToken()}`;
export function inviteExpired(token: string, now = Date.now()): boolean {
  const m = /^([0-9a-z]{6,12})\./.exec(token);
  if (!m) return false;
  return now - parseInt(m[1]!, 36) > INVITE_DAYS * 86_400_000;
}

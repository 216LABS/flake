/**
 * Fails closed: a live Vercel deployment that is missing APP_ENV is still production. Treating it as a laptop would turn
 * on the demo login, whose password is in this public repo, and the shared fake weather clock.
 */
export const appEnv = () => process.env.APP_ENV ?? (process.env.VERCEL_ENV === 'production' ? 'production' : 'local');
export const isProd = () => appEnv() === 'production';
export const isMock = () => (process.env.PROVIDERS_MODE ?? 'mock') !== 'live';
export const isTestEnv = () => appEnv() !== 'production';
/** Demo accounts have a password in this public repo, so a hosted copy has to opt in. */
export const demoLoginEnabled = () => ['local', 'test'].includes(appEnv()) || process.env.DEMO_LOGIN === '1';
export const emailConfigured = () => isMock() || Boolean(process.env.RESEND_API_KEY);
export const baseUrl = () => process.env.APP_BASE_URL ?? 'http://localhost:3000';

export function required(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`${name} is not set`);
  return v;
}

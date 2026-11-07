export const appEnv = () => process.env.APP_ENV ?? 'local';
export const isProd = () => appEnv() === 'production';
export const isMock = () => (process.env.PROVIDERS_MODE ?? 'mock') !== 'live';
export const baseUrl = () => process.env.APP_BASE_URL ?? 'http://localhost:3000';

export function required(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`${name} is not set`);
  return v;
}

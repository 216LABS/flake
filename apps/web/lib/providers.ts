import { app_setting, eq, serviceDb } from '@flake/db';
import { createProviders, type Providers, type WeatherFixtureName } from '@flake/providers';
import { appEnv, baseUrl, isMock, isProd } from './env';

export async function getSetting<T>(key: string): Promise<T | null> {
  const [row] = await serviceDb().select().from(app_setting).where(eq(app_setting.key, key));
  return (row?.value as T) ?? null;
}

export async function setSetting(key: string, value: unknown) {
  await serviceDb().insert(app_setting).values({ key, value }).onConflictDoUpdate({ target: app_setting.key, set: { value } });
}

/** Providers for this request. In mock mode /dev/weather chooses which synthetic fixture replays. */
export async function getProviders(): Promise<Providers> {
  const weatherFixture = isMock() ? ((await getSetting<WeatherFixtureName>('dev.weather_fixture')) ?? 'lakewood-lake-effect-2025-12') : undefined;
  return createProviders({ mode: isMock() ? 'mock' : 'live', appEnv: appEnv(), env: process.env, baseUrl: baseUrl(), weatherFixture });
}

/** The fake clock only exists outside production, and only matters for weather evaluation. */
export async function weatherNow(): Promise<Date> {
  if (isProd() || !isMock()) return new Date();
  const fake = await getSetting<string>('dev.clock');
  return fake ? new Date(fake) : new Date();
}

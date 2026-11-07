import { WEATHER_FIXTURES } from '@flake/providers';
import { PageHeader } from '@flake/ui';
import { requirePage } from '@/lib/auth';
import { getSetting, weatherNow } from '@/lib/providers';
import { WeatherClock } from './weather-clock';

export default async function DevWeather() {
  await requirePage();
  const fixture = (await getSetting<string>('dev.weather_fixture')) ?? 'lakewood-lake-effect-2025-12';
  return (
    <>
      <PageHeader title="Weather clock" subtitle="Replays clearly labeled SYNTHETIC weather. Move the clock, then poll to fire triggers." />
      <WeatherClock fixtures={Object.keys(WEATHER_FIXTURES)} fixture={fixture} clock={(await weatherNow()).toISOString()} />
    </>
  );
}

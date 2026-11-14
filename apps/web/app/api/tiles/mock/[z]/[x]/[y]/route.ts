import { isProd } from '@/lib/env';

// A static placeholder tile for mock mode. 1x1 light gray PNG, stretched by the map.
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mN4/ePBfwAIiQOxSgXSZwAAAABJRU5ErkJggg==', 'base64');

export async function GET() {
  // Production never uses mock providers (they're refused there), so this dev helper isn't served (issue 135).
  if (isProd()) return new Response('Not found', { status: 404 });
  return new Response(PNG, { headers: { 'Content-Type': 'image/png', 'Cache-Control': 'public, max-age=86400' } });
}

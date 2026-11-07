// A static placeholder tile for mock mode. 1x1 light gray PNG, stretched by the map.
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mN4/ePBfwAIiQOxSgXSZwAAAABJRU5ErkJggg==', 'base64');

export async function GET() {
  return new Response(PNG, { headers: { 'Content-Type': 'image/png', 'Cache-Control': 'public, max-age=86400' } });
}

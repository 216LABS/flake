// The map library loads its worker by URL, and the bundler can't see it. So it is served from public/, matching the installed version.
import { copyFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';

const require = createRequire(import.meta.url);
const dist = join(dirname(require.resolve('maplibre-gl/package.json')), 'dist');
copyFileSync(join(dist, 'maplibre-gl-worker.mjs'), new URL('../public/maplibre-gl-worker.mjs', import.meta.url));

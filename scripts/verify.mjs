// `pnpm verify`: typecheck + lint + unit + db + integration + e2e in mock mode.
// Every stage runs even if an earlier one fails, so one run reports everything that is broken.
import { spawnSync } from 'node:child_process';

const stages = [
  ['typecheck', 'pnpm typecheck'],
  ['lint', 'pnpm lint'],
  ['unit', 'pnpm test:unit'],
  ['db start', 'pnpm db:start'],
  ['db reset', 'pnpm db:reset'],
  ['db/rls', 'pnpm test:db'],
  ['integration', 'pnpm test:integration'],
  ['e2e', 'pnpm test:e2e'],
];
const results = [];
for (const [name, cmd] of stages) {
  console.log(`\n=== ${name}: ${cmd}`);
  const started = Date.now();
  const r = spawnSync(cmd, { stdio: 'inherit', shell: true });
  results.push({ name, ok: r.status === 0, secs: Math.round((Date.now() - started) / 1000) });
}
console.log('\n=== verify summary');
for (const r of results) console.log(`${r.ok ? 'PASS' : 'FAIL'}  ${r.name} (${r.secs}s)`);
process.exit(results.every((r) => r.ok) ? 0 : 1);

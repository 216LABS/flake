import { defineConfig } from 'vitest/config';

const full = { branches: 100, functions: 100, lines: 100, statements: 100 };
export default defineConfig({
  test: {
    include: ['test/**/*.test.ts'],
    coverage: {
      provider: 'v8',
      include: ['src/**/*.ts'],
      reporter: ['text'],
      thresholds: {
        'src/pricing.ts': full,
        'src/trigger.ts': full,
        'src/billing.ts': full,
        'src/area.ts': full,
        'src/proof.ts': full,
        'src/fees.ts': full,
      },
    },
  },
});

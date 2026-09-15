import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: true,
    include: ['src/**/*.test.ts'],
    // worker-isolate tests (sharp WASM spike, later queue/scheduled/entry
    // integration) run under the `workers` pool in the root workspace config
    // (vitest.config.mts) — not under the plain node runner.
    exclude: ['src/__tests__/worker/**'],
  },
});

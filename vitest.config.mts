import { defineConfig } from 'vitest/config';
import { cloudflarePool } from '@cloudflare/vitest-pool-workers';

export default defineConfig({
  // Vitest 4 workspace: four projects sharing one runner.
  // - app: the mobile app tests (happy-dom + RN mocks) — untouched behavior
  // - api: packages/api (node env — better-sqlite3 D1 shim, Effect programs)
  // - shared: packages/shared contract schema pins (node env)
  // - workers: workerd-isolate tests via @cloudflare/vitest-pool-workers
  //   (sharp WASM spike, later queue/scheduled/worker-entry integration)
  test: {
    projects: [
      {
        resolve: {
          alias: {
            '@': '/',
          },
        },
        test: {
          name: 'app',
          include: ['tests/**/*.test.ts', 'tests/**/*.test.tsx'],
          environment: 'happy-dom',
          globals: true,
          env: {
            EXPO_PUBLIC_AUTH_STUB_MODE: 'true',
            EXPO_PUBLIC_AUTH_API_BASE_URL: 'https://api.test.local',
          },
          setupFiles: ['tests/setup.ts'],
        },
      },
      {
        test: {
          name: 'api',
          include: ['packages/api/src/**/*.test.ts'],
          environment: 'node',
          globals: true,
        },
      },
      {
        test: {
          name: 'shared',
          include: ['packages/shared/src/**/*.test.ts'],
          environment: 'node',
          globals: true,
        },
      },
      {
        test: {
          name: 'workers',
          include: ['packages/api/src/__tests__/worker/**/*.test.ts'],
        },
        pool: cloudflarePool({
          singleWorker: true,
          miniflare: {
            compatibilityDate: '2026-02-28',
            compatibilityFlags: ['nodejs_compat'],
          },
        }),
      },
    ],
  },
});

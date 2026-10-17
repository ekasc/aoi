import { defineConfig } from 'vitest/config';
import { cloudflarePool } from '@cloudflare/vitest-pool-workers';

// Vitest workspace: unit, integration, and worker-isolate projects.
//
// Classification rule (see TESTING.md): a test is a UNIT test only when it is
// deterministic, fast, and isolated — no real persistence, no Hono app, no
// workerd isolate. Anything that boots the Hono routes, the better-sqlite3 D1
// shim, or the workerd pool is an INTEGRATION test, even when Vitest runs it.
//
// Projects:
// - unit-app:      tests/unit/** (happy-dom + RN mocks) — app behavior,
//                  album protocol crypto/trust/read/recovery pure units,
//                  component interaction states incl. error/retry.
// - unit-shared:   packages/shared contract + wire schema pins (node).
// - unit-api:      packages/api tests with NO harness (mocked drizzle via
//                  __tests__/helpers/test-app, pure helpers). They prove
//                  handler logic, never the real DB.
// - integration:   packages/api harness tests (real Hono routes + D1 shim +
//                  real crypto) plus tests/integration/** — the real
//                  client-to-server boundary over HTTP (see
//                  tests/integration/helpers/http-harness.ts).
// - workers:       workerd-isolate tests (sharp WASM spike, later
//                  queue/scheduled/worker-entry integration).
export default defineConfig({
  test: {
    projects: [
      {
        resolve: {
          alias: {
            '@': '/',
          },
        },
        test: {
          name: 'unit-app',
          include: ['tests/unit/**/*.test.ts', 'tests/unit/**/*.test.tsx'],
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
          name: 'unit-shared',
          include: ['packages/shared/src/**/*.test.ts'],
          environment: 'node',
          globals: true,
        },
      },
      {
        test: {
          name: 'unit-api',
          include: [
            'packages/api/src/__tests__/crypto.test.ts',
            'packages/api/src/__tests__/validation.test.ts',
            'packages/api/src/__tests__/rate-limit.test.ts',
            'packages/api/src/__tests__/domains/errors.test.ts',
            'packages/api/src/__tests__/lib/push.test.ts',
            'packages/api/src/__tests__/programs/queue.test.ts',
            'packages/api/src/__tests__/services/rate-limit.test.ts',
            'packages/api/src/__tests__/routes/activity.test.ts',
            'packages/api/src/__tests__/routes/calendar.test.ts',
            'packages/api/src/__tests__/routes/health.test.ts',
            'packages/api/src/__tests__/routes/letters.test.ts',
            'packages/api/src/__tests__/routes/location.test.ts',
            'packages/api/src/__tests__/routes/moments.test.ts',
            'packages/api/src/__tests__/routes/preferences.test.ts',
            'packages/api/src/__tests__/routes/push.test.ts',
            'packages/api/src/__tests__/routes/question.test.ts',
            'packages/api/src/__tests__/routes/someday.test.ts',
            'packages/api/src/__tests__/routes/spaces.test.ts',
            'packages/api/src/__tests__/routes/squeezes.test.ts',
          ],
          environment: 'node',
          globals: true,
        },
      },
      {
        resolve: {
          alias: {
            '@': '/',
          },
        },
        test: {
          name: 'integration',
          include: [
            // Every harness-backed api test: real Hono routes + D1 shim +
            // real crypto. Listed explicitly so a new test cannot silently
            // land in the wrong suite — add its path to exactly one project.
            'packages/api/src/__tests__/create-app.test.ts',
            'packages/api/src/__tests__/auth/**/*.test.ts',
            'packages/api/src/__tests__/db/**/*.test.ts',
            'packages/api/src/__tests__/domains/activity.test.ts',
            'packages/api/src/__tests__/domains/album.test.ts',
            'packages/api/src/__tests__/domains/album-protocol.test.ts',
            'packages/api/src/__tests__/domains/collections.test.ts',
            'packages/api/src/__tests__/domains/media.test.ts',
            'packages/api/src/__tests__/domains/moment-attachments.test.ts',
            'packages/api/src/__tests__/domains/moments.test.ts',
            'packages/api/src/__tests__/domains/push.test.ts',
            'packages/api/src/__tests__/domains/remaining-domains.test.ts',
            'packages/api/src/__tests__/domains/spaces.test.ts',
            'packages/api/src/__tests__/domains/timeline.test.ts',
            'packages/api/src/__tests__/effects/**/*.test.ts',
            'packages/api/src/__tests__/programs/cron.test.ts',
            'packages/api/src/__tests__/routes/auth-rate-limit.test.ts',
            'packages/api/src/__tests__/routes/e2e-auth.test.ts',
            'packages/api/src/__tests__/routes/session-*.test.ts',
            // The real client-to-server boundary suite (HTTP + wire
            // serialization + D1 + real crypto). See TESTING.md.
            'tests/integration/**/*.test.ts',
          ],
          environment: 'node',
          globals: true,
          // Harness boots (SQLite baseline + HTTP server) cost more than a
          // unit file; files run serially inside this project so D1 files
          // never share state across files.
          pool: 'forks',
          fileParallelism: false,
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

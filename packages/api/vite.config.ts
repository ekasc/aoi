import { cloudflare, type WorkerConfig } from '@cloudflare/vite-plugin';
import { defineConfig } from 'vite';

/**
 * Worker dev/build via the Cloudflare Vite plugin (Tsuki's proven pattern):
 * `pnpm dev` → vite dev with miniflare locals (D1/R2/Queue/Cron/RateLimit),
 * `pnpm build:cloudflare` → worker bundle in dist/server/.
 *
 * ── Environment separation ──────────────────────────────────────────────
 * The Vite plugin emits ONE worker config (dist/ssr/wrangler.json) and
 * strips wrangler's `env.*` blocks, so `--env` cannot select bindings at
 * deploy time. Instead, each deploy target is a SEPARATE WORKER chosen at
 * build time via the `AOI_DEPLOY_ENV` env var:
 *
 *   pnpm deploy:dev         → AOI_DEPLOY_ENV=dev  (worker: aoi-api)
 *   pnpm deploy:production  → AOI_DEPLOY_ENV=prod (worker: aoi-api-prod)
 *
 * Two environments only: dev (safe playground on the preview D1/R2, its own
 * queues) and production (real D1/R2/queues + cron). Each has its own
 * secrets (`wrangler secret put <NAME> --name aoi-api[-prod]`). The default
 * build (no var) is dev — production requires an explicit deploy script, so
 * an accidental `wrangler deploy` can never touch prod data.
 *
 * Bindings per env are centralized here (single source of truth). The base
 * `wrangler.jsonc` intentionally declares NO bindings — the plugin merges
 * the file config with this customizer's result via defu (which
 * CONCATENATES arrays), so declaring bindings in both places would
 * duplicate them on the emitted worker.
 */
const ENV_BINDINGS = {
  dev: {
    name: 'aoi-api',
    appEnv: 'development',
    corsOrigin: '*',
    d1: {
      database_name: 'aoi-db-preview',
      database_id: '59157bef-4efd-4076-9cd9-771c7d274693',
    },
    r2: 'aoi-media-dev',
    queue: 'aoi-queue-dev',
    queueDlq: 'aoi-queue-dlq-dev',
    analytics: 'AOI_ANALYTICS',
    crons: [] as string[],
    rl: { auth: '91001', general: '91002', squeeze: '91003', location: '91004', media: '91005' },
  },
  prod: {
    name: 'aoi-api-prod',
    appEnv: 'production',
    // Real CORS origin — replace once the app domain is live. The mobile
    // app sends no Origin header, so this only gates web.
    corsOrigin: 'https://aoi.example',
    d1: {
      database_name: 'aoi-db',
      database_id: '41d6fca9-8b53-49dc-95c8-11b007417d2e',
    },
    r2: 'aoi-media',
    queue: 'aoi-queue',
    queueDlq: 'aoi-queue-dlq',
    analytics: 'AOI_ANALYTICS',
    // Daily retention/media purge.
    crons: ['0 3 * * *'] as string[],
    rl: { auth: '93001', general: '93002', squeeze: '93003', location: '93004', media: '93005' },
  },
} as const;

type DeployEnv = keyof typeof ENV_BINDINGS;

function resolveDeployEnv(): DeployEnv {
  const raw = process.env.AOI_DEPLOY_ENV;
  if (!raw) return 'dev';
  if (raw in ENV_BINDINGS) return raw as DeployEnv;
  throw new Error(
    `Unknown AOI_DEPLOY_ENV: ${raw}. Expected one of: ${Object.keys(ENV_BINDINGS).join(', ')}`
  );
}

const deployEnv = resolveDeployEnv();
const bindings = ENV_BINDINGS[deployEnv];

const rateLimitBindings = [
  { name: 'RATE_LIMIT_AUTH', namespace_id: bindings.rl.auth, simple: { limit: 10, period: 60 } },
  { name: 'RATE_LIMIT_GENERAL', namespace_id: bindings.rl.general, simple: { limit: 100, period: 60 } },
  { name: 'RATE_LIMIT_SQUEEZE', namespace_id: bindings.rl.squeeze, simple: { limit: 10, period: 60 } },
  { name: 'RATE_LIMIT_LOCATION_REQUEST', namespace_id: bindings.rl.location, simple: { limit: 3, period: 60 } },
  { name: 'RATE_LIMIT_MEDIA', namespace_id: bindings.rl.media, simple: { limit: 20, period: 60 } },
];

export default defineConfig({
  define: {
    'process.env.AOI_DEPLOY_ENV': JSON.stringify(deployEnv),
  },
  // Fixed local port + 0.0.0.0: the app's EXPO_PUBLIC_AUTH_API_BASE_URL
  // (127.0.0.1 for the simulator, the Mac's LAN IP for physical devices)
  // and BETTER_AUTH_URL all target 8090. Binding all interfaces lets a
  // physical iPhone reach the API over WiFi. strictPort makes a port
  // collision fail loudly instead of silently moving to 8091.
  server: {
    host: '0.0.0.0',
    port: 8090,
    strictPort: true,
  },
  plugins: [
    cloudflare({
      viteEnvironment: { name: 'ssr' },
      inspectorPort: false,
      config: (config) => {
        const result: WorkerConfig = {
          ...config,
          // Compatibility is owned HERE (single source). The base file
          // declares neither, so no duplication (API error 10021).
          compatibility_date: '2026-02-28',
          compatibility_flags: ['nodejs_compat'],
          name: bindings.name,
          vars: {
            APP_ENV: bindings.appEnv,
            CORS_ORIGIN: bindings.corsOrigin,
            LOG_LEVEL: 'info',
          },
          d1_databases: [
            {
              binding: 'DB',
              database_name: bindings.d1.database_name,
              database_id: bindings.d1.database_id,
              migrations_dir: 'drizzle-d1',
            },
          ],
          r2_buckets: [{ binding: 'MEDIA', bucket_name: bindings.r2 }],
          queues: {
            producers: [
              { binding: 'AOI_QUEUE', queue: bindings.queue },
              { binding: 'AOI_QUEUE_DLQ', queue: bindings.queueDlq },
            ],
            consumers: [
              {
                queue: bindings.queue,
                max_batch_size: 10,
                max_retries: 5,
                dead_letter_queue: bindings.queueDlq,
              },
            ],
          },
          triggers: { crons: bindings.crons },
          analytics_engine_datasets: [
            { binding: 'AOI_ANALYTICS', dataset: bindings.analytics },
          ],
        };
        // `ratelimits` is not on the typed WorkerConfig (plugin supports it
        // at runtime) — carry it through explicitly.
        (result as unknown as Record<string, unknown>).ratelimits = rateLimitBindings;
        return result;
      },
    }),
  ],
  build: {
    // The worker bundle does not need the legacy node entry or tests.
    rollupOptions: {
      external: [],
    },
  },
});

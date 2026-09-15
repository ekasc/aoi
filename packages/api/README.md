# Aoi API — Cloudflare Worker

The production backend for Aoi: a Cloudflare Worker running Hono over a
bounded Effect runtime, with D1 (SQLite), R2 (private media), one Queue +
DLQ, cron cleanup, and Worker Rate Limiting. Contracts live in
`packages/shared` (Zod schemas are the single source of truth).

## Prerequisites

- Node 20+, pnpm
- `wrangler login` (an account with Workers / D1 / R2 / Queues access)

## Local development

```bash
pnpm install
pnpm --filter @aoi/api dev          # vite dev with Miniflare locals
```

Local dev runs through the Cloudflare Vite plugin (`vite.config.ts`) with
local Miniflare D1/R2/Queues — no cloud resources touched. Secrets for local
runs live in `packages/api/.dev.vars` (gitignored; copy
`.dev.vars.example`).

## Environments

Two fully separated environments. Each has its OWN D1 database, R2 bucket,
queue pair, rate-limit namespaces, and secrets — production data can never
be reached from a dev deploy.

| Target | Script | Worker | D1 | R2 | Queues |
|---|---|---|---|---|---|
| dev (default) | `pnpm --filter @aoi/api deploy:dev` | `aoi-api` | `aoi-db-preview` | `aoi-media-dev` | `aoi-queue-dev` / `-dlq-dev` |
| production | `pnpm --filter @aoi/api deploy:production` | `aoi-api-prod` | `aoi-db` | `aoi-media` | `aoi-queue` / `-dlq` |

### How separation works

The Cloudflare Vite plugin emits a single worker config and strips wrangler's
`env.*` blocks, so per-env bindings are selected at BUILD time in
`vite.config.ts` via the `AOI_DEPLOY_ENV` env var (see `ENV_BINDINGS`).
Deploy scripts set the var and deploy the built worker:

```bash
pnpm --filter @aoi/api deploy:dev         # AOI_DEPLOY_ENV=dev  → aoi-api
pnpm --filter @aoi/api deploy:production  # AOI_DEPLOY_ENV=prod → aoi-api-prod
```

The default build (no var) is **dev** — an accidental `wrangler deploy`
touches only dev resources.

### Secrets

Secrets are per-worker and never committed. Set them with:

```bash
npx wrangler secret put BETTER_AUTH_SECRET --name <worker>
npx wrangler secret put BETTER_AUTH_URL --name <worker>
# provider credentials (user-owned gates):
npx wrangler secret put GOOGLE_CLIENT_ID --name <worker>
npx wrangler secret put GOOGLE_CLIENT_SECRET --name <worker>
npx wrangler secret put APPLE_CLIENT_ID --name <worker>
npx wrangler secret put APPLE_CLIENT_SECRET --name <worker>
npx wrangler secret put APPLE_APP_BUNDLE_ID --name <worker>
```

### Migrations

D1 migrations live in `packages/api/drizzle-d1/` and are applied with
`wrangler d1 migrations apply <db> --remote`:

```bash
pnpm --filter @aoi/api db:migrate:dev          # aoi-db-preview
pnpm --filter @aoi/api db:migrate:production   # aoi-db
```

## Architecture

```
packages/api/src/
  worker.ts        — Worker entry (fetch / queue / scheduled)
  create-app.ts    — Hono shell: request-id, CORS, error envelope, routes
  env.ts           — typed WorkerEnv (structural binding types)
  auth/            — Better Auth (Apple/Google, bearer plugin)
  domains/         — Effect programs per domain (auth, spaces, moments,
                     media, push, calendar, proposals, letters, question,
                     someday, location, preferences, milestones, squeezes)
  routes/          — thin Hono transport per domain (session-*.ts)
  effects/         — Effect services: clock, id, d1 (batch/guardedUpdate),
                     config, logger, runtime, test-harness
  programs/        — queue consumer + handlers, cron retention/purge
  services/        — rate-limit, observability, media-store, media-processing
```

Ground rules:
- D1 atomicity is owned by the domain layer: `batch()` for multi-statement
  writes, `guardedUpdate` for conditional transitions, unique/check
  constraints for invariants, client-generated ids for idempotency.
- Every durable entity carries `id, space_id, version, created_at,
  updated_at, deleted_at` (tombstones) plus future E2EE/offline reserved
  fields.
- Media is stored as stable R2 keys (`media/{id}/...`) — never durable
  signed URLs; serving is membership-gated through `/v1/media/:id/object`.
- Push jobs carry kind-only data (never content); the queue consumer
  delivers vague copy and prunes dead tokens.
- Logs are privacy-safe: no tokens, keys, coordinates, or content.

## Verification

```bash
pnpm run typecheck
pnpm run test:unit        # app + api + shared + workers projects
pnpm run lint
pnpm --filter @aoi/api deploy:cloudflare:dry   # build + dry-run
```

## Legacy Node/Postgres app

`src/app.ts`, `src/index.ts`, and the old `routes/*` / `db/*` files are the
previous Node + Postgres implementation. They are preserved read-only as the
migration reference; the Worker (`src/worker.ts` + `create-app.ts` +
`session-*` routes) is the current backend.

# Aoi

Aoi is a private relationship app for exactly two people: shared memories, plans, lists, and a photo sky, with no public sharing, feeds, streaks, or engagement metrics.

This repo is a pnpm workspace:

- `app/`, `components/`, `features/`, `constants/`, `hooks/` — the Expo client
- `packages/api/` — the Cloudflare Worker API
- `packages/shared/` — Zod contracts shared by both

Product behavior lives in [PRODUCT.md](PRODUCT.md). Build and code rules live in [AGENTS.md](AGENTS.md). Test layers live in [TESTING.md](TESTING.md).

## Current app

Four tabs, plus Account behind the avatar on Lists:

| Destination | What it holds |
| --- | --- |
| **Memories** | The chronological archive. Notes, milestones, dates, goals, photos, video, voice, and traces. Composer with pending/failed/retry states, feed and gallery, month and anniversary chapters, resurfacing, PDF keepsakes. |
| **Us** | A full-screen photo sky built from the pair's encrypted shared album. Pinch/drag/zoom, a focused photo, and Sky History (Plus). Photos are chosen, encrypted on device, then uploaded. |
| **Plans** | Month grid, agenda, Someday list, goals, together events, weekly recurrence (13 concrete weeks), reminders, anniversaries, year view. |
| **Lists** | The pair's own collections: items with an optional note, link, cover, status (want/doing/done), and a score out of ten. |
| **Account** | Appearance, relationship dates, data export, shared-album devices and recovery, Plus, sessions, guide, leave/delete. |

Other screens: memory detail and edit, responses on a memory, chapter keepsake, weekly question, partner portrait ("the little things"), paywall, invite/join, album enrollment and restore.

## Stack

**App**

- Expo SDK 58, React Native 0.88, React 19
- TypeScript strict, Expo Router with typed routes and React Compiler
- Reanimated 4 and Moti for motion; Skia for the sky
- SQLite for local calendar data, AsyncStorage/SecureStore elsewhere
- RevenueCat for store purchases

**API**

- Cloudflare Worker (`src/worker.ts`) running Hono over a bounded Effect runtime
- D1 (SQLite), R2 (private media), one Queue + DLQ, cron cleanup, Worker rate limits
- Better Auth for Apple/Google sign-in, with bearer sessions for the app
- RevenueCat webhook as the authoritative Plus source

The legacy Node/Postgres implementation (`src/app.ts`, `src/index.ts`, `routes/*`, `db/*`) is kept read-only as the migration reference. The Worker is the current backend.

## Quickstart

Requirements: Node 22, pnpm 12, and Xcode or the Android SDK for native runs. A Cloudflare account is only needed for deploys.

```sh
pnpm install
pnpm start          # Metro, with the local Worker defaults baked in
```

`pnpm start` sets `EXPO_PUBLIC_AUTH_STUB_MODE=false`, the dev Worker URL, and the Google client IDs for a normal local run. It also sets `AOI_DEV_NO_CAPABILITIES=1` so a free Apple personal team can install a local build; that stripped build has no Apple sign-in and no push. Export an explicit value to override any of them.

For a fully local app with no backend:

```sh
EXPO_PUBLIC_AUTH_STUB_MODE=true pnpm start
```

Run the API locally (port 8090, local Miniflare D1/R2/Queue):

```sh
pnpm --filter @aoi/api dev
pnpm --filter @aoi/api db:migrate:local
```

Local Worker secrets belong in `packages/api/.dev.vars` (gitignored; copy `.dev.vars.example`).

## Commands

| Command | Purpose |
| --- | --- |
| `pnpm start` | Metro with dev Worker defaults |
| `pnpm run ios` / `pnpm run android` | Native build and run (asks first in agent sessions) |
| `pnpm run web` | Expo web |
| `pnpm run lint` | Expo ESLint |
| `pnpm run typecheck` | `tsc --noEmit` |
| `pnpm run test:unit` | App + shared + API unit projects |
| `pnpm run test:integration` | Real Hono/D1 boundary + workerd projects |
| `pnpm run test:e2e` | Maestro runner (requires a device and backend) |
| `pnpm run a11y:audit` | Static accessibility contract |
| `pnpm --filter @aoi/api deploy:dev` | Deploy the dev Worker |
| `pnpm --filter @aoi/api deploy:production` | Deploy the production Worker |

## Environment

App (`.env`, `EXPO_PUBLIC_*` is inlined at build time):

| Variable | Required | Notes |
| --- | --- | --- |
| `EXPO_PUBLIC_AUTH_STUB_MODE` | yes | `true` = local mock, `false` = real API. Unset throws at startup. |
| `EXPO_PUBLIC_AUTH_API_BASE_URL` | when stub is `false` | Worker origin |
| `EXPO_PUBLIC_GOOGLE_CLIENT_ID` | when stub is `false` | Web client id; must match the server `GOOGLE_CLIENT_ID` |
| `EXPO_PUBLIC_GOOGLE_IOS_CLIENT_ID` | when stub is `false` | Native Google SDK client |
| `EXPO_PUBLIC_REVENUECAT_IOS_KEY` | for purchases | Public SDK key |
| `EXPO_PUBLIC_REVENUECAT_ANDROID_KEY` | for purchases | Public SDK key |
| `EXPO_PUBLIC_REVENUECAT_ENTITLEMENT_ID` | optional | Defaults to `plus` |
| `EXPO_PUBLIC_DEV_SEED` | dev only | `full` / `empty` / `pending` / `failed` / `setup` seeds the real app tree |

Worker (`packages/api/.dev.vars` locally, `wrangler secret` in deploys):

`BETTER_AUTH_SECRET`, `BETTER_AUTH_URL` / `APP_BASE_URL`, `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `APPLE_CLIENT_ID`, `APPLE_CLIENT_SECRET`, `APPLE_APP_BUNDLE_ID`, `REVENUECAT_WEBHOOK_SECRET`, and the optional `R2_*` presigning keys.

Do not commit secrets, `.env`, `.dev.vars`, or `google-services.json` values.

## Backend shape

The Worker mounts:

- `/api/auth/*` — Better Auth
- `/v1/auth/*` — app session adapters (`session`, `refresh`, `logout`, `google`, `apple`, `account`, `sessions`)
- `/v1/spaces/*` — create, join, leave, current space, invite, activity, plus
- `/v1/spaces/current/moments*` — timeline, read state, reconcile, summary, CRUD
- `/v1/moments/:id/responses` — tap/word/photo/voice responses
- `/v1/spaces/current/calendar/events` and `/v1/calendar/events/:id`
- `/v1/spaces/current/{collections,collection-previews}` and `/v1/collections/:id`, `/v1/collection-items/:id`
- `/v1/spaces/current/{someday,question,plus,location}` and their mutation routes
- `/v1/spaces/current/album/*` — encrypted album media and protocol
- `/v1/media/*` — upload URL, complete, object
- `/v1/push/tokens`
- `/v1/users/me/{preferences,partner-details}`
- `/v1/billing/revenuecat/webhook`
- `/healthz`, `/readyz`, `/docs`

Contracts live in `packages/shared/src/*`; the API Zod schemas and client types mirror them. When a wire shape changes, update the shared type, the API schema, the serializer, and the client feature together.

## Deploy

- Worker: `pnpm --filter @aoi/api deploy:dev` or `deploy:production`. Bindings are selected at build time by `AOI_DEPLOY_ENV` in `packages/api/vite.config.ts`.
- D1 migrations: `db:migrate:dev` / `db:migrate:production`.
- App: EAS profiles in `eas.json` (`development`, `preview`, `production`). No EAS Update or CI-driven store release is configured.
- CI: `.github/workflows/ci.yml` runs lint, typecheck, unit, integration, and a non-publishing Worker build. The Android E2E workflow runs the album flows on two emulators.

## Repo map

```
app/                  Expo Router routes
  (public)/           landing
  (auth)/             sign-in, space setup
  (app)/(tabs)/       Memories, Us, Plans, Lists
  (app)/              account, moment, calendar, chapter, collection, album,
                      question, partner, paywall, goal
components/           reusable UI (kebab-case)
features/             state, repositories, API clients, pure logic
constants/            theme tokens, presets, typography
hooks/                shared hooks
packages/api/         Cloudflare Worker (legacy Node app retained)
packages/shared/      shared contracts
tests/                unit and integration suites
e2e/maestro/          device flows
scripts/              dev, E2E, perf, stress, release checks
```

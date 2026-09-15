# Lead Implementation Plan — Aoi backend migration to a Cloudflare Workers modular monolith

> Phase: Plan (read-only — no source edited, nothing committed). Label: `lead-implementation-plan`.
> Synthesizes four shape passes (`shape-auth-spaces`, `shape-d1-effect-contracts`, `shape-cloudflare-media-operations`, repository/domain shape) into an executable, staged, vertical plan. Every claim below was verified by direct inspection of this repo (`git status`, schema, routes, libs, tests, client `features/*`, `package.json`s, `pnpm-lock.yaml`) and of the read-only sibling Tsuki repo (Vite-plugin + `nodejs_compat` + dynamic sharp 0.35 WASM + Rate-Limiting/Analytics binding patterns).

---

## 0. Verified ground truth (conflict resolution)

| Item | Verified finding | Consequence for the plan |
|---|---|---|
| Tables | **19** in `packages/api/src/db/schema.ts` (first shape pass said 16 — undercount; schema + `d1-effect-contracts` agree on 19) | Fresh D1 baseline must contain all 19, plus Better Auth integration |
| `oauth_states` | **Referenced only in `schema.ts`**; WorkOS owns OAuth state; zero route references | Not dropped: **repurposed as Better Auth's `verification` store** (Better Auth persists OAuth state/PKCE there). Resolves the drop-vs-keep conflict between shape reports |
| Dirty work | 29 modified + 4 untracked; `packages/shared` dirty edits remove `.js` import extensions; `package.json` adds `@react-navigation/native` + `expo-video`; `db/migrate.ts` adds `dotenv/config` | Shared edits are **aligned with the plan** — preserve and extend. `migrate.ts` change is superseded by the D1 migration path (file is replaced wholesale; the 2-line addition is subsumed). App/asset changes are an unrelated UI pass — untouched |
| Effect/wrangler/CF | `pnpm-lock.yaml` has **zero** `effect`, `wrangler`, `@cloudflare/vite-plugin`, `better-auth` (13 "effect" hits are radix/expo transitive names) | All target-stack deps are net-new additions |
| sharp | `packages/api/node_modules/sharp@0.34.5` ships `@img/sharp-wasm32` optional dep (fallback chain exists) | Pin **sharp 0.35.3** (Tsuki's proven version) + explicit `@img/sharp-wasm32`; dynamic import; **spike first** |
| Tsuki versions | `@cloudflare/vite-plugin@^1.43.0`, `wrangler@^4.107.0`, `compatibility_flags: ["nodejs_compat"]` | Pin the same plugin/wrangler majors |
| Rate-limit | In-memory `Map` + module-scope `setInterval` (`middleware/rate-limit.ts`) — not shareable across isolates | Replace with Worker Rate Limiting bindings; `namespace_id`s are dashboard-created (**user gate**); dev = permissive fallback + header-only counters |
| Auth | WorkOS + hand-rolled jose HS256 rotation with theft detection; **`setApiTokens`/`getApiTokens` never called** (verified: only self-references + one call in `refreshTokens`) → remote mode sends no `Authorization` header | Better Auth replaces machinery; **token-plumbing fix is mandatory** for any remote E2E |
| Client/API seams | `space-setup.tsx` sends `relationshipStartDate.toISOString()` vs API's `YYYY-MM-DD` regex → 400 on every remote create; client calls `POST /v1/spaces/leave` (server has no route); client stores presigned `downloadUrl` in `moments.mediaPreview`/`audioUri` (violates locked invariant) | Add leave endpoint, fix date format, migrate media to stable URLs + `mediaId` |
| Tests | 364 `it()` assertions; every route test chain-mocks `../../db/index.js` + mocks `lib/push.js`; pin behavior (shapes, codes, guarded WHERE, push kinds) | Port assertions onto Effect programs + real SQLite; do not delete the behavioral pins |
| Root vitest | `vitest.config.ts` includes `packages/api/src/__tests__/**` with `happy-dom` + stub env | Move API tests to a **separate vitest workspace project** (node env) so the app project config stays intact |

### Locked decisions (from the brief, not renegotiable)
Cloudflare Workers · Hono transport · bounded Effect TS (typed errors, Layers, queue/cron programs, Clock/ID/test layers) · Zod in `packages/shared` as contract source (OpenAPI + client validation) · Better Auth (Apple + Google) · Drizzle + D1 · private R2 · one Queue + DLQ · Cron · Worker Rate Limiting · modular monolith in `packages/api` · Tsuki pattern for Vite plugin + `nodejs_compat` + dynamic sharp@0.35 WASM (Tsuki untouched) · D1 atomicity via batch/guarded SQL/constraints/idempotency · stable media IDs/R2 keys, never durable signed URLs · preserve future E2EE/offline fields · Deferred: E2EE, full offline sync, DO, Workflows, Containers, Postgres, WebSockets.

### Decisions resolved by this plan (was "flagged open")
1. **Better Auth session strategy**: Better Auth default = signed JWT session tokens + DB sessions (drizzle adapter). Maps 1:1 to the client's Bearer contract. Keep `/v1/auth/session|refresh|logout|account` as thin adapters over Better Auth (same shapes); replace the three WorkOS endpoints with Better Auth Apple/Google; coordinated client rewrite confined to `features/auth/*` + `api-client` plumbing.
2. **R2**: private bucket + `MEDIA` binding for `head`/`get`/serve (range support); S3-client **presigning kept only for the direct PUT** (`@aws-sdk/client-s3` + `s3-request-presigner`, works under `nodejs_compat`); stable content-hash keys; serve via stable app URL `/v1/media/:id/object?variant=…`; per-request presigned GET kept only as an internal escape hatch, never persisted.
3. **D1 datetimes**: INTEGER epoch ms (`mode: 'timestamp_ms'`); serializers convert `number → Date → toISOString()` at the API edge.
4. **`/v1/spaces/leave`**: **add it** (client already calls it; guarded `state='left'` flip + `leftAt`; frees the partial-unique active slot; the other partner's data is preserved).
5. **Test runner**: better-sqlite3-backed in-process D1 for domain/route tests (fast, deterministic) + `@cloudflare/vitest-pool-workers` for worker-integration (queue consumer, scheduled, worker entry, sharp spike) in a second vitest workspace project.
6. **`oauth_states`**: repurposed as Better Auth `verification` table (not dropped).
7. **Moments idempotency**: optional client-supplied `clientId` + partial unique index `(space_id, client_id) WHERE deleted_at IS NULL`; client sends a draft-derived key (fixes double-tap).
8. **Moments cursor**: composite opaque `occurredAt|id` (`(occurredAt < ?) OR (occurredAt = ? AND id < ?)`); accept legacy bare-ISO for one page (client-ephemeral; zero harm).
9. **`size_bytes`**: INTEGER (fresh D1, ≤100 MB bound — fits 64-bit SQLite).
10. **`PRAGMA foreign_keys`**: assert ON in the D1 layer bootstrap (D1 default; pin explicitly so `ON DELETE cascade` holds).

---

## 1. Migration & dirty-state strategy

- **Data**: no production data migration. PG migrations `drizzle/0000–0010` are dev-only SQL and **not reusable** (dialect rewrite). Fresh D1 gets **one new baseline** generated by drizzle-kit (sqlite dialect) from the rewritten schema. Old PG SQL files are superseded; the `drizzle/` dir is regenerated (in-scope for this task).
- **Migration mechanism**: `drizzle-kit generate` (sqlite) → `wrangler d1 migrations apply` (local miniflare + CI dry-run; production apply is a user gate).
- **Local dev**: `wrangler dev` via the Vite plugin (miniflare D1/R2/Queue/Cron/Rate-Limit locals). `.dev.vars` (gitignored) for local secrets. `packages/api/.env` stays untracked and untouched.
- **Dirty files — exact disposition**:
  - Preserve untouched: `app/**` (29 files), `assets/**`, `components/**`, `features/calendar/calendar-context.tsx`, `constants/theme-presets.ts`, `tests/unit/calendar/…`, `app.json`, `pnpm-lock.yaml`, `package.json` dep additions.
  - Preserve + extend: `packages/shared/src/{index,auth,proposal}.ts` (.js-extension removal is the pattern Stage 1 continues).
  - Superseded (replaced by this task, diff-acknowledged): `packages/api/src/db/migrate.ts` (dotenv line subsumed by the wrangler path), `packages/api/src/db/index.ts` (Postgres client), `src/lib/{workos-auth,google-auth,jwt}.ts`, `src/middleware/rate-limit.ts`, `src/db/schema.ts` (pg-core), `drizzle/` (PG SQL).
  - Never touched: `.env`, `.env*.local`, `ios/`, `android/`, Tsuki.
  - Never run: `git reset`, `git checkout`, `git clean`. No commits, no push.

---

## 2. Stages (each compiles + green tests; vertical slices)

> Deps added (root workspace so both packages can see them): `effect`, `better-auth`, `@cloudflare/vite-plugin@^1.43`, `wrangler@^4.107`, `@hono/zod-openapi` (spec generation), `file-type` (magic bytes), `sharp@0.35.3` + `@img/sharp-wasm32` (pinned), dev: `better-sqlite3` + `@types/better-sqlite3`, `@cloudflare/vitest-pool-workers`, `miniflare` (comes with wrangler). Removed from `packages/api`: `@workos-inc/node`, `jose`, `postgres`, `@hono/node-server`, `dotenv` (worker runtime needs none). Kept: `@aws-sdk/client-s3` + `s3-request-presigner` (presign only), `hono`, `drizzle-orm` (sqlite-core + d1 driver), `zod`, `@aoi/shared`.

### Stage 0 — De-risking spike: sharp WASM on workerd (do first, everything depends on it)
- **Goal**: prove `await import('sharp')` + `@img/sharp-wasm32` re-encodes an EXIF-carrying JPEG to clean WebP under workerd (Miniflare), with `limitInputPixels`/dimension caps.
- **Files**: `packages/api/package.json` (sharp pin + explicit wasm dep), `packages/api/src/__tests__/worker/sharp-wasm.spike.test.ts` (`@cloudflare/vitest-pool-workers`), `docs/shape/spike-sharp-wasm.md` (verdict + fallback).
- **Test gate**: spike test green. **Fallback (documented)**: keep client `exif:false` baseline + magic-byte verification, defer server re-encode, flag Cloudflare Images as the paid alternative — do NOT block the whole plan on it.

### Stage 1 — Shared Zod contracts (`packages/shared`)
- **Goal**: make `packages/shared` the single contract source. Convert every module's exported types to `z.infer<typeof schema>` backed by named zod schemas (`createMomentSchema`, `listMomentsQuerySchema`, …); keep pure helpers verbatim (sorters, ISO-week bank, `isLocationShareFresh`, `isExpoPushToken`, `parsePushNotificationData`, seal horizons, `WEEKLY_RECURRENCE_INSTANCE_COUNT=13`, label/preset lists, `PUSH_NOTIFICATION_KINDS`, limits). Move API-side constants into shared (`PUSH_TOKEN_MAX_LENGTH=200`, media MIME allow-lists). **No `.js` import extensions anywhere** (extend the user's dirty pattern). Error messages stay word-only/fixed (rendered by the client).
- **Files**: `packages/shared/src/{user,auth,space,moment,calendar,preferences,activity,someday,question,letter,proposal,push,location,api,media}.ts`, `index.ts` (extend), `packages/shared/src/__tests__/*.test.ts` (schema pins).
- **Test gate**: `pnpm --filter @aoi/shared typecheck`; new schema tests; root app tests still green (types unchanged in name).

### Stage 2 — Worker skeleton + D1 baseline
- **Goal**: the monolith boots as a Worker (Tsuki pattern), D1 bound, schema ported to sqlite-core with all constraints, one baseline migration, real-SQLite test harness.
- **Files**:
  - `packages/api/vite.config.ts` — `cloudflare({ viteEnvironment: { name: 'ssr' }, inspectorPort: false })`.
  - `packages/api/wrangler.jsonc` — `compatibility_date`, `compatibility_flags: ["nodejs_compat"]`, `main: dist/server/index.js`, `d1_databases: [{ binding: "DB", database_name, database_id (placeholder) }]`, `r2_buckets: [{ binding: "MEDIA", bucket_name: "aoi-media" }]`, `queues.producers/consumers` (AOI_QUEUE, AOI_QUEUE_DLQ), `triggers.crons` (staged), `ratelimits` placeholders (auth 10/min, general 100/min, squeeze 10/min, location-request 3/min, media 20/min), `analytics_engine_datasets: [{ binding: "AOI_ANALYTICS", dataset: "AOI_ANALYTICS" }]`, `observability.enabled: true`.
  - `packages/api/src/worker.ts` — `export default { fetch, queue, scheduled }`; `createApp(layers)` Hono shell (tests inject a Test layer).
  - `packages/api/src/db/schema.ts` — sqlite-core rewrite: `users` gets Better Auth-aligned columns (`name` replaces `display_name`, `image` replaces `avatar_url`, add `email_verified`) while **keeping the `users` table name** (15 FK targets stay valid); `user_sessions` → Better Auth `session` shape; `auth_accounts` → Better Auth `account` shape (unique `(provider_id, account_id)`); `oauth_states` → Better Auth `verification` shape; all 15 remaining tables keep semantics with INTEGER-ms timestamps, `jsonb→text json` (`reminderMinutesBefore`, `label`, `destination`), `doublePrecision→real`, `date→text 'YYYY-MM-DD'`, `size_bytes→integer`; **new**: partial uniques `space_members(user_id) WHERE state='active'` and `space_members(space_id) WHERE state='active' AND role='partner'`, moments `(space_id, client_id) WHERE deleted_at IS NULL`; `media_objects` gains `content_hash`, `variant_keys`, `processing_attempts`, `completed_at`, and reserved `encryption_scheme`/`encryption_meta`/`client_sha256` (NULL, no behavior); every `ck_*` CHECK and partial index carried over.
  - `packages/api/drizzle.config.ts` (dialect sqlite) + regenerated `drizzle/` baseline.
  - `packages/api/src/db/index.ts` — `drizzle(d1, { schema })` inside a DbLayer service + `PRAGMA foreign_keys` assertion.
  - `packages/api/src/effects/{clock,id,d1,config,logger}.ts` — Clock (single `now` source), Id (UUID), D1 (batch/guarded helpers), Config (fail-fast), Logger (sanitized JSON).
  - `packages/api/src/effects/test-harness.ts` — better-sqlite3-backed D1 shim + TestClock wiring.
  - `vitest.workspace.ts` (root) — project A: current app tests (happy-dom); project B: API tests (node env, better-sqlite3); adjust `vitest.config.ts` include accordingly.
  - Scripts in `packages/api/package.json`: `dev` → wrangler via vite, `db:generate`, `db:migrate:local`, `build:cloudflare`, `deploy:cloudflare:dry`.
- **Test gate**: `pnpm --filter @aoi/api typecheck`; constraint tests (partial uniques reject double-active-space and second partner; upserts; CHECKs) on the shim; `wrangler dev` serves `/healthz` + `/readyz`; `pnpm run test:unit` (both workspace projects) green.

### Stage 3 — Effect core: typed errors, Layers, transport mapping
- **Goal**: routes become thin transport; domain commands are Effect programs; every HTTP code is a typed `Data.TaggedError`; 500s remain fixed strings (privacy invariant, never `err.message`); no-existence-leak 404s are typed errors.
- **Files**: `packages/api/src/domains/errors.ts` (+ per-domain submodules later), `packages/api/src/app.ts` → `createApp(layers)` with error→`ApiError` mapper and the exact `{error:{code,message}}` envelope + code mapping from today's `app.ts`; `packages/api/src/lib/errors.ts` retired; `packages/api/src/services/rate-limit.ts` (binding wrapper `consumeEdgeRateLimit` pattern from Tsuki, dev fallback, header-only `X-RateLimit-*` counters — documented as non-enforcing); `packages/api/src/services/push-producer.ts` (enqueue `{type:'notify.partner', kind, spaceId, fromUserId, fromName?, dayOfWeek?}`); `packages/api/src/programs/queue.ts` (tagged-union decode, `JobDecodeError`→DLQ, business failure→retry≤5→DLQ).
- **Test gate**: error-mapping table tests (all 7 codes incl. word-only 400s, fixed 500); rate-limit service tests; push-enqueue capture tests.

### Stage 4 — Auth (Better Auth + client gateway + token plumbing)
- **Goal**: Apple+Google via Better Auth; session/refresh/logout/account shapes preserved; middleware verifies Better Auth bearer tokens; **client token plumbing fixed** so remote mode actually sends `Authorization`.
- **Files**:
  - `packages/api/src/auth/better-auth.ts` — instance: drizzle adapter (mapped models), `apple()` + `google()` plugins, JWT session strategy, `trustedOrigins`, secret from Config (fail-fast `BETTER_AUTH_SECRET`), baseURL from env; mounted via `toHono` at `/api/auth/*` (Better Auth default paths).
  - `packages/api/src/routes/auth.ts` — rewrite: `GET /v1/auth/session`, `POST /v1/auth/refresh` (Better Auth refresh-token), `POST /v1/auth/logout` (sign-out), `DELETE /v1/auth/account` (delete-user + soft-delete + enqueue cleanup); drop WorkOS endpoints.
  - `packages/api/src/domains/auth.ts` — account-deletion program (revoke sessions, mark `deletedAt`, enqueue R2/push cleanup).
  - `packages/api/src/middleware/auth.ts` — Better Auth `getSession({ headers })` from Bearer; sets `userId`; 401 on missing/invalid.
  - Delete: `src/lib/{workos-auth,google-auth,jwt}.ts` (superseded). Keep `src/lib/crypto.ts` (invite codes; `hashToken`/`randomToken` move to Web Crypto in Stage 5).
  - **Client** (coordinated, confined): `features/auth/*` — `oauth-client.ts` targets Better Auth social URLs + native Apple `idToken` flow (`expo-apple-authentication` + Better Auth's documented native Apple path; verify against Better Auth docs, fallback = custom idToken-verify endpoint minting a Better Auth session), `auth-api.ts` adapters, `types.ts`; `features/api-client.ts` — session-context must call `setApiTokens(...)` on restore/sign-in (bug fix), keep 401-refresh-retry; `features/session/session-context.tsx` wiring.
- **Test gate**: adapters + middleware tests on shim (session/refresh/logout/account shapes unchanged); client auth unit tests updated; Apple relay-email/account-linking notes documented (verified-email-only linking; Apple `@privaterelay.appleid.com` will not cross-link — correct, documented).

### Stage 5 — Spaces (+ leave endpoint, invite redeem, date fix)
- **Goal**: spaces domain on D1 with constraint-enforced atomicity; add `/v1/spaces/leave`; fix client date bug.
- **Files**: `packages/api/src/domains/spaces.ts` (create: guarded insert relying on partial unique; join: guarded invite redeem `UPDATE … WHERE redeemed_at IS NULL` + member INSERT in one `batch()`; `getActiveSpaceId` consolidated here from the 3 duplicated copies + `lib/space.ts`; creator-only PATCH; leave: `state='left'` + `leftAt`; archived-space invisibility), `packages/api/src/routes/spaces.ts` (+ leave route); client `app/(auth)/space-setup.tsx` — send `YYYY-MM-DD` (extract from date, drop `toISOString()`).
- **Test gate**: double-create-space → 409 (constraint), double-join → 409/conflict copy, single-redeem invite race, leave frees the active slot; client unit test for date formatting; remote-create smoke against miniflare.

### Stage 6 — Moments + Activity (batch, tombstone, cursor, idempotency)
- **Goal**: moments domain with composite cursor, `clientId` idempotency, batch write + tombstone, push enqueue; activity feed.
- **Files**: `packages/api/src/domains/moments.ts` (create w/ optional `clientId`; list `limit∈[1,100]` default 20, `limit+1` hasMore, `(occurredAt< ?) OR (occurredAt= ? AND id< ?)`; PATCH/DELETE own-only + `batch([guarded update, activity insert])`; viewer-relative `isOwn`/`authorRole` computed per request), `domains/activity.ts` (7-day clamp, cap 50, tombstone-only read), `routes/moments.ts`, `routes/activity.ts`.
- **Test gate**: keyset pagination incl. tie-break, double-tap create dedupe, double-tombstone → 404, batch atomicity (shim), activity purge thresholds.

### Stage 7 — Calendar + Proposals
- **Goal**: weekly recurrence expansion (13 instances, one group id), merged-range validation, reminders JSON, guarded proposal accept + atomic event insert.
- **Files**: `domains/calendar.ts` (range overlap `endsAt≥from AND startsAt<to`; create expands ×13 with one `Id`-generated `recurrenceGroupId`; instance ops never touch the group; reminders ≤8 unique ints 0–2880, empty array clears; `Other` label customText; weekday-at-most push copy), `domains/proposals.ts` (strictly-future, end>start, proposee-only, guarded `WHERE status='pending'`, accept = `batch([status flip, calendar event insert])` with proposer role snapshot, cross-space 404), `routes/calendar.ts`, `routes/proposals.ts`.
- **Test gate**: recurrence count/group, double-accept → "already answered", batch atomicity, label/reminder edge cases.

### Stage 8 — Someday / Question / Letters / Milestones / Preferences
- **Goal**: remaining read-model domains; letter body lock; reveal gate.
- **Files**: `domains/{someday,question,letters,milestones,preferences}.ts` + `routes/*`. Letters: immutable, serializer omits `body` until `openedAt` (author + partner), guarded one-way open `WHERE opened_at IS NULL`, horizon 18,262 days, "Not yet time" 400. Question: server-computed ISO week, both-answered reveal, partner timing never surfaced. Someday: meaningful-transition-only writes, shared `sortSomedayItems`. Preferences: theme enum upsert. Milestones: soft-delete filter.
- **Test gate**: body-lock read paths (incl. seal response), open race idempotent read, reveal gate, no-space graceful empties.

### Stage 9 — Push queue consumer + Squeezes
- **Goal**: all `notifyPartnerInSpace` call sites become `PushProducer.enqueue`; the queue consumer runs Expo delivery off-request.
- **Files**: `packages/api/src/programs/queue-consumer.ts` (`push.deliver` job: `buildPushCopy` **verbatim**, `sendPushToUser` **verbatim** — batch ≤100, 10s abort, `DEAD_TOKEN_ERRORS` prune), `domains/push.ts` (token registry upsert/reassign, cap 200, identical response), `domains/squeezes.ts` (wordless 202, 10/min), `routes/push.ts`, `routes/squeezes.ts`.
- **Test gate**: miniflare-queue integration (enqueue→consume→Expo fetch mocked; dead-token deletion; DLQ on business failure; decode error→DLQ); enqueue-never-blocks-request assertions; all 14 kinds' vague copy pinned.

### Stage 10 — Media (R2 + sanitize queue job + stable URLs)
- **Goal**: full media pipeline off the request path; stable content-hash keys; serve with range for audio; moments store `mediaId` + stable URL.
- **Files**: `domains/media.ts` (upload-url intent → presigned PUT (S3, 3600s, ≤100MB, allowlists), complete = head-verify ContentType + guarded `pending→complete|failed`, serve = membership gate + `bucket.get(key, { range })` + `206`/`Content-Range` + `nosniff` + sanitized `Content-Disposition`), `services/media-store.ts` (R2 binding head/get/put/delete + S3 presigner), `services/media-processing.ts` (queue job `media.sanitize`: magic-byte `file-type` check → dynamic `await import('sharp')` with `limitInputPixels: 268402689`, dimension ≤16384, re-encode WebP q84 display + bounded thumb, output caps; m4a pass-through verify-only), `programs/queue-consumer.ts` (+media job, `processing_attempts`, idempotent re-delivery no-op), `programs/cron.ts` (+media purge jobs: staged >24h, soft-deleted purge, orphan R2 sweep), `routes/media.ts` (upload-url/complete/object; download-url replaced — client migration in Stage 12), schema `media_objects` additions (already in Stage 2), `packages/shared/src/media.ts` (Stage 1).
- **Test gate**: state-machine transitions, idempotent re-delivery, EXIF stripped + GPS gone, dimension/byte caps, animated-frame cap, audio 206 range, membership 404/403, enqueue not send.

### Stage 11 — Location + Cron + Observability
- **Goal**: location domain (both-consent, freshness, one-time grants, sweep) + all Cron retention jobs + analytics/logging.
- **Files**: `domains/location.ts` (single-JOIN consent re-check, unique `(user_id)` upsert, outright delete on stop/revoke/expiry, mutuality-gated request 3/min, archived hard-off, coordinates never in logs/errors — word-only validation), `programs/cron.ts` (activity purge 7d, location expiry incl. unread grants, dead push tokens, media purges from Stage 10, DLQ review metric), `services/observability.ts` (AOI_ANALYTICS `writeDataPoint`, sanitized JSON logs, request-id).
- **Test gate**: TestClock threshold tests; grant consumed-once; sweep removes rows + R2 keys; word-only 400s.

### Stage 12 — Client media integration + remote smoke
- **Goal**: mobile app consumes stable media URLs; full remote smoke through the worker.
- **Files**: `features/media/use-media-upload.ts` (return `mediaId` + stable `/v1/media/:id/object?variant=…` URL; stop persisting presigned URLs), `features/moments/*` (mediaId), `components/moments/moment-card.tsx`, `app/(app)/memory-wall.tsx`, `components/media/audio-player.tsx` (range playback via `expo-video`/`expo-audio`), `features/space/types.ts` (leave), `app/(auth)/space-setup.tsx` (already Stage 5).
- **Test gate**: client unit tests (mock fetch with stable URLs); manual/simulator remote smoke against miniflare: auth → space → moments(+media) → calendar → proposals → someday → question → letters → location → push; response-shape byte-compatibility spot checks.

### Stage 13 — Deployment, CI, docs, verification; isolate user gates
- **Files**: `.github/workflows/ci.yml` (+ worker build + `wrangler deploy --dry-run` + release-verify, modeled on Tsuki's), `scripts/verify-release.mjs` (asserts bindings: DB, MEDIA, AOI_QUEUE+DLQ, crons, ratelimits, AOI_ANALYTICS; modeled on Tsuki's `verify-v1-online-release.mjs`), `docs/` updates (`CONTEXT.md` backend section, `PLAN.md`/`TODOS.md` status, `README`, `aoi-db-api.md` superseded note, `packages/api/docs/backup-restore.md` — D1 export/time-travel, R2 lifecycle, DLQ replay), `.dev.vars.example` (gitignored pattern), `packages/api/.env.example` refresh.
- **Gates**: `pnpm run typecheck`, `pnpm run lint`, `pnpm --filter @aoi/api typecheck`, all unit + worker integration suites, `pnpm run build:cloudflare`, `wrangler deploy --dry-run`; `git status` delta vs. start = only intended files (user's 29+4 untouched).

---

## 3. User-owned gates (isolated, explicit — everything else is implemented locally)
1. **Apple Developer**: Sign in with Apple capability + private key (ES256 client secret), Services ID (web/Android), redirect/`aoi://oauth2redirect`; physical-device Apple sheet (simulator cannot do real Apple ID).
2. **Google Cloud console**: Web server client + real iOS/Android client IDs + redirect URIs (env/`wrangler secret`; never committed).
3. **Cloudflare dashboard/CLI**: create D1 `aoi-db` (+ production `wrangler d1 migrations apply`), R2 bucket + API token (`wrangler secret put`), `wrangler queues create aoi-queue aoi-queue-dlq`, five Rate-Limiting **namespace IDs** (wrangler placeholders), Analytics Engine dataset, `BETTER_AUTH_SECRET` + secrets, custom domain/route.
4. **Physical-device E2E**: native Apple/Google sign-in, deep links, media picker→upload→timeline/media wall/audio playback on iOS + Android, real push to a device.
5. **Deploy**: production `wrangler deploy` + `wrangler secret put` (CI only builds/dry-runs).

## 4. Completion criteria (from the locked brief)
1. Typecheck + lint green (root and `@aoi/api`); worker boots via Vite plugin; `/healthz` serves.
2. D1 baseline migration applies cleanly; all 19 tables + constraints/partial uniques verified (test-asserted on the shim).
3. All 16 domains as Effect programs under Layers; **364+ assertions preserved/exceeded**; typed-error→`ApiError` mapping covered.
4. Client compatibility: remote smoke passes; auth Bearer contract preserved through Better Auth (adapters) — coordinated client change documented and shipped in Stages 4/12.
5. Queue + DLX deliver all 14 push kinds with exact existing vague copy; enqueue never stalls requests.
6. Cron runs retention purges (activity 7d, location expiry, dead tokens, media).
7. Five Rate-Limiting tiers present (headers included, enforcement via bindings).
8. Media: private R2, stable hash keys, sharp 0.35 WASM sanitize with caps, per-request signing only.
9. Deferred items absent; no secrets committed; user's uncommitted work + untracked assets intact (`git status` delta check); Tsuki untouched.

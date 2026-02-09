# Aoi Go Backend Performance Blueprint (Updated Scope)

This blueprint is aligned to the current app scope and the updated docs:

- `README.md`
- `aoi-prd-engineering.md`
- `aoi-db-api.md`

It is intentionally focused on the active MVP surface: auth, space, imported milestones, moments, calendar, and preferences.

---

## 1) Scope changes that affect backend design

Compared to earlier docs, scope has changed in these important ways:

- OAuth provider sign-in (Apple/Google) is the active auth path.
- Email code auth is deprecated in product flow.
- Theme selection is now a first-class onboarding/app requirement.
- Relationship setup + optional milestone import are in core scope.
- Timeline + goals + calendar are in core scope.
- Media pipeline, purchases/entitlements, storage quotas, and recap services are deferred.

Backend priorities should follow this exact scope.

---

## 2) What the current codebase already requires

### 2.1 Existing endpoint contract (already in use)

From `features/auth/auth-api.ts`, these routes are hard requirements:

- `POST /v1/auth/oauth/start`
- `POST /v1/auth/oauth/callback`
- `GET /v1/auth/session`
- `POST /v1/auth/logout`

### 2.2 Domain model expected by frontend

From `features/*/types.ts` and route screens:

- session user: `id`, `email`, `displayName`, optional `avatarUrl`
- relationship space: `name`, `partnerName`, `relationshipStartDate`, `inviteCode`
- imported milestones: `note | milestone | date | goal`
- moments: timeline items with author metadata and optional goal `targetAt`
- calendar events: actor-aware events with labels and owner-only edits
- user preference: theme id selection/persistence

### 2.3 High-sensitivity UX paths

- app boot session restore -> `GET /v1/auth/session`
- onboarding create/join space + milestone import
- timeline list reads
- calendar month range reads

These paths should receive the strictest latency and reliability goals.

---

## 3) Performance targets (SLOs)

Start with realistic measurable goals:

- `GET /v1/auth/session`: p95 < 120ms, p99 < 250ms
- `GET /v1/spaces/current`: p95 < 150ms
- `GET /v1/spaces/current/moments` (limit=30): p95 < 180ms
- `GET /v1/spaces/current/calendar/events` (month range): p95 < 170ms
- write endpoints (`POST/PATCH/DELETE` core routes): p95 < 220ms
- 5xx error rate: < 0.5% rolling 30m

Capacity assumptions for initial production planning:

- 10k daily active users
- 85-90% reads / 10-15% writes
- peak traffic concentrated around evening local time

---

## 4) Service architecture (performance-first, low complexity)

### 4.1 Use a modular monolith first

Implement one Go service with clear internal modules:

- `auth`
- `space`
- `milestones`
- `moments`
- `calendar`
- `preferences`

Why:

- lower latency than service-to-service calls
- easier consistency and transaction boundaries
- simpler deploy and observability

### 4.2 Keep nodes stateless

- access token auth per request
- refresh tokens persisted server-side (hashed)
- no in-memory session dependencies
- any node can serve any request

### 4.3 Keep handlers thin

Use strict separation:

- handlers: transport + validation + response mapping
- services: business rules + authz policies
- repos: SQL only

---

## 5) Recommended Go layout

```text
services/api/
  cmd/api/main.go
  internal/
    app/
    config/
    http/
      middleware/
      handlers/
      dto/
    auth/
    space/
    milestones/
    moments/
    calendar/
    preferences/
    db/
      migrations/
      queries/
      repo/
    cache/
    observability/
  pkg/
    id/
    timeutil/
    errors/
```

Recommended runtime libs:

- HTTP: Gin
- DB: `pgx/v5` + `pgxpool`
- migrations: `golang-migrate` (or equivalent)
- logging: `zap` or `zerolog`
- telemetry: OpenTelemetry
- cache/limits/idempotency: Redis-compatible store

---

## 6) API surface (active MVP)

### 6.1 Auth (must match current app)

- `POST /v1/auth/oauth/start`
- `POST /v1/auth/oauth/callback`
- `GET /v1/auth/session`
- `POST /v1/auth/logout`

### 6.2 Space

- `GET /v1/spaces/current`
- `POST /v1/spaces`
- `POST /v1/spaces/join`
- `PATCH /v1/spaces/current`

### 6.3 Imported milestones

- `GET /v1/spaces/current/imported-milestones`
- `POST /v1/spaces/current/imported-milestones`

### 6.4 Moments

- `GET /v1/spaces/current/moments?cursor=<opaque>&limit=30`
- `POST /v1/spaces/current/moments`
- `PATCH /v1/moments/:id`
- `DELETE /v1/moments/:id`

### 6.5 Calendar

- `GET /v1/spaces/current/calendar/events?from=<iso>&to=<iso>`
- `GET /v1/calendar/events/:id`
- `POST /v1/spaces/current/calendar/events`
- `PATCH /v1/calendar/events/:id`
- `DELETE /v1/calendar/events/:id`

### 6.6 Preferences

- `GET /v1/users/me/preferences`
- `PATCH /v1/users/me/preferences`

### 6.7 Health

- `GET /healthz`
- `GET /readyz`

---

## 7) Database and indexing strategy

Use the schema in `aoi-db-api.md`.

Performance-critical indexes to enforce from day one:

```sql
-- Invite code join
create unique index if not exists uq_space_invites_code_normalized
  on space_invites (code_normalized);

-- Membership checks on almost every request
create index if not exists idx_space_members_user_state
  on space_members (user_id, state);

-- Timeline keyset pagination
create index if not exists idx_moments_space_occurred_id
  on moments (space_id, occurred_at desc, id desc)
  where deleted_at is null;

-- Calendar month/day range queries
create index if not exists idx_calendar_events_space_starts
  on calendar_events (space_id, starts_at asc)
  where deleted_at is null;

-- Owner checks
create index if not exists idx_calendar_events_owner
  on calendar_events (created_by_user_id, id)
  where deleted_at is null;

create index if not exists idx_moments_owner
  on moments (created_by_user_id, id)
  where deleted_at is null;
```

Use UUIDv7 (or ULID) when possible for better index locality.

---

## 8) Read-path optimization plan

### 8.1 Session endpoint

- return only fields needed by app boot flow
- avoid extra joins and heavy profile loading
- cache token/session metadata where useful

### 8.2 Timeline list

- keyset pagination only (no offset)
- default `limit=30`, hard max `limit=100`
- cursor based on `(occurred_at,id)`

### 8.3 Calendar range reads

- strict bounded range by `from` and `to`
- index-backed `starts_at` range scan
- keep payload compact

### 8.4 Space and preference reads

- optimize for one current-space lookup per request path
- optional short TTL cache with write invalidation

---

## 9) Write-path safety and speed

### 9.1 Idempotency keys

For write routes (`POST`, and optionally destructive `DELETE`):

- accept `Idempotency-Key`
- store by `(user_id, key)` with TTL
- return prior result for retries

This protects mobile retry behavior on unstable networks.

### 9.2 Transaction boundaries

Keep transactions small and explicit:

- create space + membership + invite
- join invite + membership update + invite redemption
- moment/calendar writes with ownership checks

### 9.3 Locking

- row-level locks only where contention exists (invite redemption)
- no broad table locks

---

## 10) Security and privacy baseline

- auth middleware on all protected routes
- membership checks on all space-scoped resources
- owner checks for event/moment mutation
- strict payload validation
- request body size limits
- route-level rate limiting:
  - auth start/callback
  - space join
  - invite-related writes
- never log raw provider tokens or secrets

---

## 11) Observability and profiling

Minimum instrumentation:

- structured logs with `request_id`, `route`, `status`, `latency_ms`
- metrics by route (rate/errors/duration)
- DB query duration histograms
- tracing hooks for:
  - session restore
  - timeline list
  - calendar range list
  - space join/create

Operational dashboards:

- p50/p95/p99 latency by endpoint
- DB pool usage and wait time
- 4xx/5xx rates
- top slow queries

---

## 12) Runtime and deployment notes

### 12.1 Environment

- app: `APP_ENV`, `PORT`, `LOG_LEVEL`
- db: `DATABASE_URL`, pool config
- auth: provider credentials, signing keys
- cache: `REDIS_URL`

### 12.2 Hardening

- graceful shutdown with request draining
- request/server timeouts (`ReadHeaderTimeout`, `ReadTimeout`, `WriteTimeout`, `IdleTimeout`)
- separate liveness and readiness probes

### 12.3 Scaling

- stateless replicas behind Fly load balancing
- strict per-instance DB pool caps
- avoid overcommitting Neon connection limits

---

## 13) Testing and benchmarking plan

### 13.1 Test layers

- unit tests: validation, policy, business rules
- integration tests: repository + SQL behavior on Postgres
- API contract tests: route/request/response compatibility

### 13.2 Load tests (required)

Use `k6` or `vegeta` for:

- `GET /v1/auth/session`
- `GET /v1/spaces/current/moments`
- `GET /v1/spaces/current/calendar/events`
- `POST /v1/spaces/join` burst safety

Track:

- p95/p99 latency
- error rate
- DB CPU/IO and query plans
- pool wait and timeout events

---

## 14) Phased implementation sequence

### Phase 1 - Foundations + auth parity

- scaffold service, config, middleware, health endpoints
- implement auth contract routes used by app

### Phase 2 - Space and imported milestones

- space create/join/current/update
- imported milestones list/append
- invite normalization and unique index enforcement

### Phase 3 - Moments API

- create/list/update/delete moments
- keyset pagination
- owner/membership checks

### Phase 4 - Calendar API

- range list + get by id + create/update/delete
- owner-only update/delete behavior
- index and benchmark month queries

### Phase 5 - Preferences + production hardening

- theme preference read/write
- rate limiting, idempotency, observability completeness
- performance tuning and launch checklist

---

## 15) Definition of done for a performant MVP backend

Backend is production-ready when:

- required auth contract is compatible with mobile app behavior
- p95 SLOs are met for session, timeline, and calendar endpoints
- hot queries are index-backed and stable under load
- idempotency protections exist for critical writes
- membership and ownership authorization is enforced server-side
- logs/metrics/tracing support incident triage

---

## 16) Deferred extension modules (post-MVP)

These are future modules, not launch blockers for current scope:

- media upload/presign/download service
- purchase verification + entitlement service
- storage quota accounting and enforcement
- recap generation/materialization service
- export and account deletion workflows

When reintroduced, they should be designed as additive modules, not coupled into the critical auth/space/timeline/calendar path.

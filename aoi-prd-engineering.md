# Aoi - PRD + Engineering Spec (Updated Scope)

## 0. Document intent

This document is the current source-of-truth for Aoi MVP scope and implementation strategy.

It supersedes earlier assumptions that included purchases, media upload infrastructure, and recap generation in MVP. The current MVP is centered on relationship setup, timeline + goals, and calendar planning with a performance-ready backend contract.

---

## 1. Product Requirements Document (PRD)

### 1.1 Product summary

Aoi is a private app for two people to keep relationship moments and plans together. The product is intentionally calm: no public sharing, no social feed, and no AI features.

### 1.2 Target users

- Couples who want a private shared space
- Users who want light planning + memory capture in one place
- Low-frequency creators who return over time

### 1.3 Product principles

- Private by default
- Two-person shared context
- Calm UX over engagement mechanics
- Predictable behavior over algorithmic behavior

### 1.4 In-scope MVP flows

#### Access and onboarding

- Provider sign in with Apple or Google
- Session restore from secure local storage
- Relationship onboarding:
  - create a space with partner metadata
  - or join with invite code
- Optional past milestone import during onboarding
- Required shared theme selection before entering app tabs

#### Main app

- Timeline tab:
  - text-first moments (`note`, `milestone`, `date`, `goal`)
  - upcoming goals lane derived from target dates
- Calendar tab:
  - event CRUD
  - actor-aware events (`you` vs `partner`)
  - month grid with per-day counts
- Profile tab:
  - identity details
  - relationship details
  - edit relationship details
  - import milestones later
- Settings tab:
  - change theme preset
  - sign out

### 1.5 User stories (current MVP)

#### Auth

- As a user, I can sign in using Apple or Google.
- As a returning user, I can reopen the app and have my session restored.
- As a user, I can sign out from profile/settings.

#### Space setup

- As a signed-in user, I can create a relationship space.
- As a signed-in user, I can join an existing space with an invite code.
- As a user, I can import previous milestones during onboarding or later.

#### Timeline

- As a user, I can add moments with title/body and optional goal target date.
- As a user, I can see timeline items sorted chronologically.
- As a user, I can see upcoming goals grouped separately.

#### Calendar

- As a user, I can create events with start/end times and labels.
- As a user, I can edit/delete events I created.
- As a user, I can view partner-created events but cannot edit them.

#### Preferences

- As a user, I can choose and persist a shared theme preset.

### 1.6 Explicitly deferred scope

The following are intentionally deferred from MVP backend delivery:

- Media upload pipeline and media moments
- Purchases, receipt verification, and entitlement enforcement
- Storage quota metering and subscriptions
- Deterministic monthly/anniversary recap services
- Full export and account deletion backend workflows

### 1.7 Monetization status

Monetization strategy remains a product decision, but billing enforcement is not in current MVP implementation scope.

### 1.8 Privacy and safety baseline

- No social graph/feed/sharing features
- Authenticated-only data access
- Membership checks for space-scoped data
- Ownership checks for user-owned updates/deletes

### 1.9 MVP success metrics (pragmatic)

- Onboarding completion: sign-in -> space setup -> theme selection
- First-week activation: users who create at least one moment and one calendar event
- Stability: crash-free sessions and auth/session restore success rate
- Performance: p95 latency targets met for auth/session, timeline, and calendar APIs

---

## 2. Engineering Spec (MVP)

### 2.1 Stack

- Mobile: React Native (Expo)
- Backend: Go (Gin)
- Database: Postgres (Neon)
- Cache/ratelimiting/idempotency: Redis-compatible store
- Hosting: Fly.io

### 2.2 Architecture overview

#### Mobile (current)

- Local-first state/repositories for space/moments/calendar
- Remote auth adapter with local stub mode fallback
- Secure session persistence in `expo-secure-store`

#### Backend (target)

- Stateless API nodes
- Modular monolith boundaries:
  - `auth`
  - `space`
  - `milestones`
  - `moments`
  - `calendar`
  - `preferences`
- Clear permission policy layer for membership and ownership checks

### 2.3 Contract requirements already in code

The following routes are already called by the mobile app and must be preserved:

- `POST /v1/auth/oauth/start`
- `POST /v1/auth/oauth/callback`
- `GET /v1/auth/session`
- `POST /v1/auth/logout`

### 2.4 Target API domains for MVP

#### Auth

- OAuth start/callback/session/logout

#### Space

- get current space
- create space
- join space by invite
- update space metadata

#### Imported milestones

- list imported milestones
- append imported milestones

#### Moments

- list moments (cursor-based)
- create moment
- update moment
- delete moment

#### Calendar

- list events by range
- get event by id
- create/update/delete event

#### Preferences

- get user preferences
- update user preferences (theme id initially)

### 2.5 Data ownership and permission model

- A space has two members.
- Space membership gates visibility to moments, milestones, and events.
- Event creator ownership gates event updates/deletes.
- Moment author ownership gates edit/delete of user-owned moments.

### 2.6 Performance requirements

- Session endpoint optimized for app boot path.
- Timeline reads use keyset pagination.
- Calendar reads use indexed time-range queries.
- Write endpoints support idempotency keys for mobile retries.

### 2.7 Security baseline

- Auth middleware for all non-public routes.
- Input validation at transport boundary.
- Request body size limits.
- Route-level rate limits for auth and invite join paths.
- No sensitive tokens or raw provider payloads in logs.

### 2.8 Observability baseline

- Structured logs with request id
- Per-route latency and error metrics
- DB query timing metrics
- Tracing hooks for auth/session, timeline list, and calendar range reads

### 2.9 Delivery plan (scope-aligned)

#### Phase 1

- service scaffold, config, health checks
- auth endpoint parity with mobile contract

#### Phase 2

- space + invite + imported milestone APIs

#### Phase 3

- moments APIs with cursor pagination and ownership checks

#### Phase 4

- calendar APIs with range query optimization and owner-only writes

#### Phase 5

- preferences API
- performance hardening, load tests, production readiness checks

---

## 3. Open questions

- Should relationship edit permissions be both members or creator-only?
- Should timeline support hard delete in MVP, or soft delete only?
- Should imported milestones remain distinct server records or become first-class moments at write time?
- Should theme be per-user or per-space once backend sync is live?

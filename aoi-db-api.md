# Aoi - Database Schema + API Endpoints (Updated MVP Scope)

## 0. Principles

- Postgres (Neon)
- Stateless API (Gin)
- OAuth provider auth (Apple, Google)
- Membership-gated access to shared data
- Owner-gated updates/deletes for user-owned resources
- Cursor/range-friendly indexing for timeline and calendar

This document reflects the current MVP scope in the app. Media uploads, purchases, and recap services are explicitly deferred.

---

## 1. Database schema (current MVP)

### 1.1 Users and auth

#### `users`

- `id` (uuid, pk)
- `email` (citext, unique, nullable for provider edge-cases)
- `display_name` (text, not null)
- `avatar_url` (text, nullable)
- `created_at` (timestamptz, not null)
- `updated_at` (timestamptz, not null)
- `deleted_at` (timestamptz, nullable)

#### `auth_accounts`

- `id` (uuid, pk)
- `user_id` (uuid, fk users)
- `provider` (text, check: `apple | google`)
- `provider_subject` (text, not null)
- `created_at` (timestamptz, not null)

Constraints:

- unique (`provider`, `provider_subject`)

#### `user_sessions`

- `id` (uuid, pk)
- `user_id` (uuid, fk users)
- `refresh_token_hash` (text, not null)
- `user_agent` (text, nullable)
- `ip` (inet, nullable)
- `expires_at` (timestamptz, not null)
- `revoked_at` (timestamptz, nullable)
- `created_at` (timestamptz, not null)

### 1.2 Space and membership

#### `spaces`

- `id` (uuid, pk)
- `name` (text, not null)
- `relationship_start_date` (date, not null)
- `created_by_user_id` (uuid, fk users)
- `created_at` (timestamptz, not null)
- `updated_at` (timestamptz, not null)
- `archived_at` (timestamptz, nullable)

#### `space_members`

- `space_id` (uuid, fk spaces)
- `user_id` (uuid, fk users)
- `role` (text, check: `you | partner`)
- `state` (text, check: `active | left`)
- `joined_at` (timestamptz, not null)
- `left_at` (timestamptz, nullable)

Primary key:

- (`space_id`, `user_id`)

#### `space_invites`

- `id` (uuid, pk)
- `space_id` (uuid, fk spaces)
- `code` (text, not null)                    -- canonical display code
- `code_normalized` (text, not null)         -- uppercase/no-space lookup key
- `created_by_user_id` (uuid, fk users)
- `expires_at` (timestamptz, nullable)
- `redeemed_by_user_id` (uuid, fk users, nullable)
- `redeemed_at` (timestamptz, nullable)
- `created_at` (timestamptz, not null)

Constraints:

- unique (`code_normalized`)

### 1.3 Imported milestones

#### `imported_milestones`

- `id` (uuid, pk)
- `space_id` (uuid, fk spaces)
- `created_by_user_id` (uuid, fk users)
- `type` (text, check: `note | milestone | date | goal`)
- `title` (text, not null)
- `body` (text, nullable)
- `occurred_at` (timestamptz, not null)
- `target_at` (timestamptz, nullable)
- `created_at` (timestamptz, not null)
- `deleted_at` (timestamptz, nullable)

### 1.4 Moments

#### `moments`

- `id` (uuid, pk)
- `space_id` (uuid, fk spaces)
- `created_by_user_id` (uuid, fk users)
- `author_role` (text, check: `you | partner`)
- `author_name` (text, not null)
- `type` (text, check: `note | milestone | date | goal | media`)
- `title` (text, not null)
- `body` (text, not null default '')
- `occurred_at` (timestamptz, not null)
- `target_at` (timestamptz, nullable)
- `media_preview` (text, nullable)           -- MVP keeps optional pointer only
- `created_at` (timestamptz, not null)
- `updated_at` (timestamptz, not null)
- `deleted_at` (timestamptz, nullable)

### 1.5 Calendar

#### `calendar_events`

- `id` (uuid, pk)
- `space_id` (uuid, fk spaces)
- `created_by_user_id` (uuid, fk users)
- `actor` (text, check: `you | partner`)
- `actor_name` (text, not null)
- `title` (text, not null)
- `starts_at` (timestamptz, not null)
- `ends_at` (timestamptz, not null)
- `label_preset` (text, check: `Work | Gym | Travel | Date | Family | Other`)
- `label_custom_text` (text, nullable)
- `created_at` (timestamptz, not null)
- `updated_at` (timestamptz, not null)
- `deleted_at` (timestamptz, nullable)

### 1.6 Preferences

#### `user_preferences`

- `user_id` (uuid, pk, fk users)
- `theme_id` (text, not null)  -- `sunset-shore | sea-glass | deep-ocean`
- `updated_at` (timestamptz, not null)

---

## 2. Indexes (performance-critical)

```sql
-- Auth lookups
create unique index if not exists uq_auth_accounts_provider_subject
  on auth_accounts (provider, provider_subject);

create index if not exists idx_user_sessions_user_expires
  on user_sessions (user_id, expires_at)
  where revoked_at is null;

-- Space membership and invite joins
create index if not exists idx_space_members_user_state
  on space_members (user_id, state);

create unique index if not exists uq_space_invites_code_normalized
  on space_invites (code_normalized);

-- Imported milestone timeline reads
create index if not exists idx_imported_milestones_space_occurred
  on imported_milestones (space_id, occurred_at desc, id desc)
  where deleted_at is null;

-- Moments keyset pagination
create index if not exists idx_moments_space_occurred_id
  on moments (space_id, occurred_at desc, id desc)
  where deleted_at is null;

create index if not exists idx_moments_owner
  on moments (created_by_user_id, id)
  where deleted_at is null;

-- Calendar month/day range reads
create index if not exists idx_calendar_events_space_starts
  on calendar_events (space_id, starts_at asc)
  where deleted_at is null;

create index if not exists idx_calendar_events_owner
  on calendar_events (created_by_user_id, id)
  where deleted_at is null;
```

---

## 3. API endpoints (MVP)

### 3.1 Auth (already required by frontend)

- `POST /v1/auth/oauth/start`
- `POST /v1/auth/oauth/callback`
- `GET /v1/auth/session`
- `POST /v1/auth/logout`

### 3.2 Space

- `GET /v1/spaces/current`
- `POST /v1/spaces`
- `POST /v1/spaces/join`
- `PATCH /v1/spaces/current`

### 3.3 Imported milestones

- `GET /v1/spaces/current/imported-milestones`
- `POST /v1/spaces/current/imported-milestones`

### 3.4 Moments

- `GET /v1/spaces/current/moments?cursor=&limit=`
- `POST /v1/spaces/current/moments`
- `PATCH /v1/moments/:id`
- `DELETE /v1/moments/:id`

### 3.5 Calendar

- `GET /v1/spaces/current/calendar/events?from=&to=`
- `GET /v1/calendar/events/:id`
- `POST /v1/spaces/current/calendar/events`
- `PATCH /v1/calendar/events/:id`
- `DELETE /v1/calendar/events/:id`

### 3.6 Preferences

- `GET /v1/users/me/preferences`
- `PATCH /v1/users/me/preferences`

### 3.7 Internal

- `GET /healthz`
- `GET /readyz`

---

## 4. Authorization rules

- User must be authenticated for all `v1` endpoints except OAuth start/callback.
- User must be an active member of the target space.
- Event update/delete allowed only for `created_by_user_id`.
- Moment update/delete allowed only for `created_by_user_id`.
- Invite join uses normalized invite code and transitions membership state atomically.

---

## 5. Deferred schema and APIs

Deferred modules from previous docs are intentionally excluded from current MVP schema/API implementation:

- media object registry + presign/complete/download
- purchases + entitlements
- storage usage accounting
- recap materialization
- export/deletion workflows

They can be added in a later schema version once the current MVP backend is stable.

# Aoi — Database Schema + API Endpoints (MVP)

## 0. Principles
- Postgres (Neon)
- Store object keys, not URLs.
- Media owned by uploader.
- Relationship membership gates visibility.
- Stateless API (Gin).
- Direct-to-R2 uploads via presigned URLs.

---

## 1. Database Schema (proposed)

### 1.1 Users
**users**
- id (uuid, pk)
- email (citext, unique)
- created_at (timestamptz)
- deleted_at (timestamptz, nullable)

**user_settings**
- user_id (uuid, pk, fk users)
- locale (text)
- timezone (text)
- created_at
- updated_at

### 1.2 Relationships
**relationships**
- id (uuid, pk)
- created_by (uuid, fk users)
- status (text) // active | archived
- title (text, nullable)
- started_at (date, nullable)
- created_at
- updated_at

**relationship_members**
- relationship_id (uuid, fk relationships)
- user_id (uuid, fk users)
- role (text) // owner | partner
- state (text) // active | left | archived (per-user)
- joined_at (timestamptz)
- left_at (timestamptz, nullable)
- archived_at (timestamptz, nullable)
- primary key (relationship_id, user_id)

**relationship_invites**
- id (uuid, pk)
- relationship_id (uuid, fk relationships)
- inviter_user_id (uuid, fk users)
- invite_code (text, unique)
- expires_at (timestamptz)
- redeemed_by_user_id (uuid, fk users, nullable)
- redeemed_at (timestamptz, nullable)
- created_at

### 1.3 Media + Moments
**media**
- id (uuid, pk)
- owner_user_id (uuid, fk users)
- relationship_id (uuid, fk relationships)
- object_key (text, unique)
- media_type (text) // photo | video
- byte_size (bigint)
- width (int, nullable)
- height (int, nullable)
- duration_seconds (numeric, nullable)
- has_location (bool)
- location_lat_round (numeric, nullable)
- location_lng_round (numeric, nullable)
- captured_at (timestamptz, nullable)
- created_at
- deleted_at (timestamptz, nullable)

**moments**
- id (uuid, pk)
- relationship_id (uuid, fk relationships)
- created_by_user_id (uuid, fk users)
- type (text) // media | note | milestone | date | goal
- title (text, nullable)
- body (text, nullable)
- occurred_at (timestamptz, nullable)
- created_at
- updated_at
- deleted_at (timestamptz, nullable)

**moment_media**
- moment_id (uuid, fk moments)
- media_id (uuid, fk media)
- primary key (moment_id, media_id)

### 1.4 Entitlements + Purchases
**entitlements**
- id (uuid, pk)
- user_id (uuid, fk users)
- kind (text) // relationship_create
- remaining (int)
- source (text) // apple | google
- created_at
- updated_at

**purchase_receipts**
- id (uuid, pk)
- user_id (uuid, fk users)
- platform (text) // apple | google
- product_id (text)
- receipt_token (text)
- status (text) // active | refunded | revoked
- purchased_at (timestamptz)
- updated_at

### 1.5 Storage usage
**storage_usage**
- user_id (uuid, pk, fk users)
- bytes_used (bigint)
- tier (text) // base | subscription
- updated_at

### 1.6 Retention
**retention_events**
- id (uuid, pk)
- user_id (uuid, fk users)
- kind (text)
- effective_at (timestamptz)
- created_at

---

## 2. API Endpoints (MVP)

### 2.1 Auth
- `POST /auth/request-code` { email }
- `POST /auth/verify-code` { email, code } -> tokens + user
- `POST /auth/refresh` { refresh_token } -> new access token
- `POST /auth/logout` { refresh_token }

### 2.2 Relationships
- `GET /relationships`
- `POST /relationships` (consumes entitlement)
- `POST /relationships/:id/invites`
- `POST /invites/redeem` { invite_code }
- `POST /relationships/:id/archive`
- `POST /relationships/:id/leave`

### 2.3 Moments
- `GET /relationships/:id/moments?cursor=&limit=`
- `POST /relationships/:id/moments`
- `PATCH /moments/:id`
- `DELETE /moments/:id`

### 2.4 Media
- `POST /media/presign`
- `POST /media/complete`
- `GET /media/:id/download` -> signed URL
- `DELETE /media/:id` (owner-only)

### 2.5 Recaps
- `GET /relationships/:id/recaps/monthly?year=&month=`
- `GET /relationships/:id/recaps/anniversary`

### 2.6 Purchases / entitlements
- `POST /purchases/verify`
- `GET /entitlements` -> entitlements + access state

### 2.7 Export + deletion
- `POST /export`
- `DELETE /account`

### 2.8 Internal
- `POST /internal/cleanup` (cron, protected)

---

## 3. Notes
- Use short-TTL signed URLs for download.
- Location rounding: store rounded lat/lng only, never raw.
- View-only mode disables all writes and presigns but allows reads and export.

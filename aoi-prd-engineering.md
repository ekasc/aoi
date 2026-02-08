# Aoi — PRD + Engineering Spec (MVP)

## 0. Document intent
This is the source-of-truth spec for Aoi MVP: product requirements, non-goals, and the engineering plan to ship a first release that is scalable by design (tokenized UI, stateless API, direct-to-object storage uploads), without overbuilding.

---

## 1. Product Requirements Document (PRD)

### 1.1 Summary
Aoi is a private, shared relationship scrapbook for two people. It stores photos, short videos, notes, milestones, important dates, and goals, and generates monthly and anniversary recaps. A relationship is treated as a chapter: it can be active, archived, or ended. The app is calm, emotionally neutral, and privacy-first.

### 1.2 Target user
- Gen Z / Millennial couples who want a private, intentional memory space.
- Users who dislike social media performance and want a calm, personal archive.
- Low-frequency users: they add content occasionally and revisit later.

### 1.3 Core user stories (MVP)
**Account**
- As a user, I can create an account and sign in.
- As a user, I can delete my account and export my data.

**Relationship space**
- As a user, I can purchase the ability to create a relationship space ($9.99 per relationship).
- As a user, I can create a relationship space and invite one partner for free.
- As a partner, I can accept an invite and access the shared relationship view.
- As either partner, I can archive the relationship (my view becomes read-only).
- As either partner, I can leave a relationship (my view is disconnected; content ownership rules apply).

**Moments**
- As a user, I can add a photo moment with optional location (toggle at upload time).
- As a user, I can add a short video moment (10–20s) with optional location (toggle).
- As a user, I can add a note/milestone/date/goal entry.
- As a user, I can view moments in a timeline.

**Recaps**
- As a user, I can view a monthly recap (no AI, deterministic selection).
- As a user, I can view an anniversary recap (no AI, deterministic selection).
- Recaps stop when the relationship is archived.

**Storage**
- As a user, I can view my storage usage.
- As a user, I can buy additional storage via subscription (post-MVP if needed; MVP may include stub UI).
- If my subscription ends, I can still view and export, but cannot upload more.

**Refunds and revocation**
- If my purchase is refunded, my entitlement becomes invalid and the app becomes view-only.
- I can export during a grace period, then data may be deleted per policy.

### 1.4 Non-goals (explicit)
- No chat or messaging.
- No social feed/sharing.
- No AI features.
- No relationship analytics/scoring.
- No maps UI.
- No push notifications (MVP).
- No multiple themes (MVP). One base theme only.

### 1.5 Monetization (locked)
- Free to download.
- $9.99 one-time IAP per relationship creation.
- Invite one partner for free.
- Storage subscription exists for extra capacity (can be shipped after MVP; design for it now).

### 1.6 Privacy & safety principles
- Media is owned by the uploader.
- Users can delete their own content; cannot delete partner’s content.
- Relationship references content; it does not “own” it.
- Location is optional per upload and stored at rounded precision.

### 1.7 Retention policy (conservative)
- Paid users: retain long-term, no forced deletion due to inactivity.
- Free users: delete after ~6 months inactivity.
- Refunded users: 30-day grace for export, then delete after ~90 days.
- User-initiated deletion overrides retention.

### 1.8 MVP success metrics (pragmatic)
- Activation: % of purchasers who create a relationship + invite partner within 24h.
- Retention: % of couples who add at least 5 moments within 30 days.
- Content creation: median moments per relationship after 30 days.
- Support load: refunds that cause data disputes (should be near zero due to ownership rules).

---

## 2. Engineering Spec (MVP)

### 2.1 Stack (locked)
- Mobile: React Native (Expo)
- Backend: Go (Gin)
- DB: Postgres (Neon)
- Object storage: Cloudflare R2 (S3-compatible)
- Hosting: Fly.io
- Upload pattern: presigned URLs, direct-to-R2 uploads
- API: stateless, horizontally scalable

### 2.2 Architecture overview
**Client**
- Auth + session management
- Content creation (compress media, request presign, upload, confirm)
- Timeline rendering
- Archive/leave flows
- Export request UI (server generates export manifest or returns signed URLs)

**Backend**
- Auth (email magic link or email + code; implementation choice)
- Relationship service: create/invite/join/leave/archive
- Content service: moments CRUD (visibility via relationship membership)
- Media service: presign PUT/GET, finalize upload, track usage
- Entitlements: verify Apple/Google purchase tokens and grant relationship creation rights
- Retention: scheduled cleanup (refund + inactivity policies)

**Storage**
- R2 bucket: `aoi-media`
- Lifecycle rules:
  - deleted objects removed after retention window

### 2.3 Key engineering constraints
- Do not stream media through API.
- Store only object keys in DB, never full URLs.
- Build adapters for:
  - object storage client (R2/S3)
  - receipt validation provider (Apple/Google)
  - media compression pipeline (Expo wrapper)
- Theme tokens in one file; no inline colors scattered through components.

### 2.4 Auth (MVP recommendation)
- Email code (no passwords).
- Session access token + refresh token.
- Rate limit login attempts.

### 2.5 Data ownership model (core)
- Media rows are owned by a user.
- A relationship has two members.
- Timeline is a view over entries visible to both members.
- Deleting a relationship for one user should not erase the other user’s ownership.

### 2.6 Upload flow (canonical)
1. Client compresses photo/video locally.
2. Client calls `POST /media/presign`.
3. Server returns `{object_key, upload_url, headers, expires_at}`.
4. Client uploads directly to R2.
5. Client calls `POST /media/complete`.
6. Server validates object exists, writes media record, updates usage.
7. Client creates a moment entry referencing `media_id`.

### 2.7 Entitlements and purchases
- Client completes IAP.
- Client sends purchase token/receipt to backend.
- Backend verifies and issues entitlement:
  - `relationship_create` (remaining=1)
- Relationship creation consumes entitlement.

Refund handling:
- On app open (or periodic), client refreshes entitlements.
- Backend checks verification status; if invalid, flips user access state to view-only.
- Deletion grace period enforced via retention job.

### 2.8 Storage quota enforcement
- Track usage as sum of stored object sizes per user.
- On upload presign:
  - deny if user is over quota or in view-only mode
- On subscription end:
  - allow reads/exports
  - deny new uploads

### 2.9 Recaps generation (deterministic)
- Monthly recap: select moments within month using deterministic rules:
  - milestones first
  - then recent media, capped
- Anniversary recap: similar, based on relationship start date
- Cache recap results per period.

### 2.10 Observability (MVP)
- Structured logs
- Basic metrics: upload success/failure, verification outcomes
- Client error reporting optional.

### 2.11 Security baseline
- Auth required for all endpoints except login.
- Membership checks for relationship access.
- Owner checks for media delete.
- Signed URLs for downloads, short TTL.
- Rate limit login, presign, purchase verify.

### 2.12 Release plan (MVP)
- Phase 1: Auth + base UI shell + tokenized design system
- Phase 2: Relationship create/invite/join + entitlement verification
- Phase 3: Media upload + timeline
- Phase 4: Archive/leave + export + retention job

---

## 3. Open questions
- Exact auth method: email magic link vs email code.
- Base and paid storage quota numbers.
- Location rounding strategy (ex: ~1km precision).
- Age rating decision (16+ vs 18+).

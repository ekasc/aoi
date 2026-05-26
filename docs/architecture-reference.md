# Aoi — Architecture Decisions & Product Context

This document captures decisions made during architecture brainstorming sessions.
It serves as shared context for future sessions so no decision needs to be re-litigated.

## Core Product Concept

Aoi is a private relationship data platform for two people. The core data type is a **moment** — a timestamped piece of content (text note, image, video, milestone, inside joke) attributed to one partner. Everything else is a view over moments:

- **Timeline** — chronological feed of moments
- **Calendar** — moments that have a time range (events) displayed on a grid
- **Recaps/Wrapped** — periodic (monthly/yearly/anniversary) auto-generated summaries of moments
- **Resurface** — "on this day" re-display of past moments
- **Location** — optional live location sharing between partners, can create implicit moments ("arrived home")

Calendar events are a subtype of moment — they have start/end times but are otherwise the same entity.

## Data Model

### Core entity: Moment

```
Moment {
  id: string
  type: note | milestone | date | goal | media | event
  title: string
  body: string
  tags: Tag[]
  occurredAt: datetime
  endsAt?: datetime          // if type=event
  targetAt?: datetime        // if type=goal
  createdAt: datetime
  authorId: string
  authorRole: you | partner
  authorName: string
  isNSFW: boolean
  encryptionLevel: none | platform | client-only
  media?: MediaRef[]         // if type=media or if attached to any moment
}

Tag {
  name: string
  // No predefined list — free-form tags
}
```

### Partners / Space

```
Space {
  id: string
  name: string
  partnerNames: [string, string]
  relationshipStartDate: date
  createdAt: datetime
  // Encryption key is derived at space creation time if client-side encryption is used
}

Membership: exactly 2 users per space
```

## Encryption Model — Three Tiers

Presented to user at moment creation (or at space setup for default level).

### 1. Platform Backup (default)
- Key stored in expo-secure-store with iCloud/Google backup enabled
- Survives device replacement if user is logged into cloud account
- Key also held by partner's device as implicit backup
- Best for: everyday use, convenience-first users

### 2. Client-Only (opt-in per moment or space-wide)
- Key stored locally, cloud backup explicitly disabled
- If device is lost and partner's key is also lost, content is unrecoverable
- Users warned about this when selecting
- Best for: highly sensitive content, privacy-maximalist users

### 3. Recovery Phrase (optional add-on to either tier)
- 12-word phrase shown once during space creation
- Recovers the key independent of any device or cloud account
- Crypto-wallet UX — most ignore, grateful later
- Best for: belt-and-suspenders users

### Encryption affects which features can read content

| Feature | Unencrypted | Platform-encrypted | Client-encrypted |
|---|---|---|---|
| Timeline | Full preview | Preview (decrypts) | Preview (decrypts) |
| Recap / Wrapped | Full text analysis | Full | Counts only, no text |
| Resurface | Full preview | Full | "A memory from this date" |
| Search | Full | Full | Client-side only |
| Notifications | Title preview | Title preview | "Partner added a moment" |
| Server-side processing | Allowed | Blocked (encrypted blob) | Blocked (encrypted blob) |

## Key Storage & Recovery

| Scenario | Recovery path |
|---|---|
| One device lost (cloud backup on) | Key restored from iCloud / Google Play backup automatically |
| One device lost (cloud backup off) | Partner's device has the key, re-share via recovery flow |
| Both devices lost (cloud backup on) | Restored from cloud backup on new devices |
| Both devices lost (cloud backup off, phrase saved) | Recovery phrase |
| Both devices lost (cloud backup off, no phrase) | Content lost. Inform user at setup. |

## Sync Model

Offline-first from day one. Rationale: moments are captured in real life (dinner, trip, quiet evening), not in front of a computer. The app must function without connectivity.

- Local SQLite database mirrors server schema on the client
- Writes go to local DB instantly (optimistic), queued for server sync
- Background sync engine pushes local changes and pulls remote changes
- No conflict resolution for MVP — last-writer-wins with timestamp comparison
- Deferred: smarter merge for concurrent edits

## Privacy / NSFW

Two independent layers:

1. **Blur tag** (social layer) — client-side render flag. Blurs card in timeline, excludes from recaps/resurface by default, suppresses notification content preview, keeps blurred during screen share. User taps to reveal.

2. **Encryption** (security layer) — client-side encrypts content+media before upload. Server never sees plaintext. See Encryption Model above.

## Backend Architecture

### Stack
- **Language:** TypeScript (not Go — avoids type duplication with frontend, single language for solo dev)
- **Monorepo:** pnpm workspace (`packages/app`, `packages/api`, `packages/shared`)
- **Framework:** Hono (fastest TS framework, first-class RPC, runtime-agnostic)
- **Database layer:** Drizzle ORM (schema-first, type-safe queries, auto-migrations)
- **Database:** Postgres on Hetzner VPS (same box as app server for early stage)
- **Object storage:** Cloudflare R2 (for media uploads)
- **Auth:** Custom OAuth 2.0 with PKCE using jose for JWTs
- **Hosting:** Hetzner CX32 VPS (€10.49/mo)

### Why TypeScript over Go
- Shared types between frontend and backend (packages/shared)
- Single language reduces context-switching for solo developer
- pnpm workspaces handle monorepo cleanly
- Marginal cost per user is ~$0 — Go's performance advantage is irrelevant at Aoi's scale
- Hono performs comparably to Gin for REST CRUD workloads

## Auth Architecture

Security is high priority because of private media. Defense-in-depth, not convenience-first.

### OAuth 2.0 with PKCE
- **Google (iOS + Android):** Authorization Code + PKCE (`S256`). Already defined in frontend.
- **Apple iOS:** Native Sign in with Apple, then `oauth/native/callback` with idToken.
- **Apple Android:** Browser-based `start` + `callback` with `state` + `nonce`.

### Session Model

Two-token system, not cookie-based:

| Token | Lifetime | Storage (client) | Purpose |
|---|---|---|---|
| Access token | 15 minutes | expo-secure-store (memory) | Authorizes API requests |
| Refresh token | 30 days | expo-secure-store, rotated on use | Gets new access tokens |

- Access tokens are **stateless JWTs** (signed with jose, no DB lookup on request)
- Refresh tokens are **stateful** (stored in DB with device fingerprint, rotation invalidates old one)
- On app boot: frontend calls `GET /v1/auth/session` with access token. If expired, uses refresh token for new pair. This is the hot path — needs sub-100ms.
- Refresh token rotation: every use issues a new token. If an old (already rotated) token is presented, revoke all sessions for that user — indicates token theft.

### API Security

- All `v1/*` routes require valid JWT in `Authorization: Bearer` header (except OAuth start/callback)
- Auth middleware checks JWT signature + expiry on every request (~1ms, no DB call)
- Rate limiting on auth endpoints: 5 requests/minute per IP
- Rate limiting on session refresh: 10 requests/minute per user
- Refresh token bound to device fingerprint (hash of device ID + user agent)

### Encryption Key Chain

The encryption tiers depend on auth:
- Space encryption key derived from both users' auth state + a space secret
- Key is never transmitted over the wire — generated locally on each device
- Key recovery phrase is a BIP39-style mnemonic encoded from the space secret
- Auth compromise ≠ encryption key compromise (separate secret material)

### API Contract (from frontend, must implement)

```
POST /v1/auth/oauth/start
POST /v1/auth/oauth/callback
POST /v1/auth/oauth/native/callback
GET  /v1/auth/session
POST /v1/auth/logout

GET    /v1/spaces/current
POST   /v1/spaces
POST   /v1/spaces/join
PATCH  /v1/spaces/current

GET    /v1/spaces/current/imported-milestones
POST   /v1/spaces/current/imported-milestones

GET    /v1/spaces/current/moments?cursor=&limit=
POST   /v1/spaces/current/moments
PATCH  /v1/moments/:id
DELETE /v1/moments/:id

GET    /v1/spaces/current/calendar/events?from=&to=
GET    /v1/calendar/events/:id
POST   /v1/spaces/current/calendar/events
PATCH  /v1/calendar/events/:id
DELETE /v1/calendar/events/:id

GET    /v1/users/me/preferences
PATCH  /v1/users/me/preferences

GET    /healthz
GET    /readyz
```

## Monetization

### Model
- **Free app** on App Store and Google Play (no IAP)
- **Web checkout via Stripe** at aoiapp.com/pricing (or in-app via expo-web-browser)
- User logs into the app, server checks subscription status via API
- No IAP — Apple/Google take 15-30% for no value. Stripe keeps 97% (2.9% + $0.30/txn)

### Pricing
- $3.99 USD globally (~$5.49 CAD, ~€3.70, ~£3.20)
- Monthly subscription. Annual optional later (20% discount, ~$39.99/yr)
- Free tier: one space, text moments, basic calendar. No media, no recaps, no encryption.
- Premium tier ($3.99/mo): media uploads, NSFW encryption, recaps/Wrapped, resurface, live location. Partner full access included.

### Why no IAP
- Apple/Google take 15% ($0 under $1M/yr) to 30%
- Stripe is 2.9% + $0.30/txn (keep ~97%)
- Netflix, Spotify, Dropbox all use web-only checkout
- Apple Reader Rule exempts subscription apps from forced IAP
- Add IAP later only if conversion data proves web checkout is a bottleneck

### Unit economics
- Monthly burn: ~$28 CAD ($15.53 VPS + $11.33 Apple Dev + $1.33 domain)
- Break-even: 6 premium users at $4.99/mo CAD
- $10K gross revenue via Stripe = ~$9,410 net vs ~$7,000-8,500 via IAP
- Media storage cost per active couple: $0.004-$0.21 CAD/month (negligible)

## Couple Dynamics (Key Product Insight)

From user's lived experience:
- Most events are individual, not shared — one partner adds their schedule, the other consumes
- Asymmetry is the norm: one organizer, one consumer
- Calendar import from Apple/Google Calendar is essential (no-one inputs events twice)
- The timeline / recap is the emotional payoff (Spotify Wrapped for couples)
- The calendar is table-stakes utility

## Infrastructure Costs

| Item | Monthly Cost |
|---|---|
| Fly.io VM (1 shared CPU, 1GB RAM) | ~$7.74 |
| Fly.io storage (1GB) | ~$0.15 |
| Neon Postgres (free tier) | $0 |
| Cloudflare R2 (early, <10GB) | ~$0 |
| Apple Developer | ~$8.25 ($99/yr) |
| **Total** | **~$16/mo** |

Gross margins approach 100% at early scale.

## Open Questions (Deferred)
- Partial encryption vs full encryption (user chooses per moment)
- Calendar import from Apple/Google Calendar (one-way, read-only)
- Multi-relationship support (sequential, not concurrent — one space at a time)
- Screenshot detection for NSFW content
- Recap generation timing (monthly cron? trigger-based?)

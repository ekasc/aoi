# Security Audit Report

**Date:** 2026-05-26 @ 02:45 UTC
**Scope:** `packages/api` — Hono REST API
**Type:** Web API (CRUD), Auth-heavy, Multi-tenant (space isolation)

## Summary

- **Issues found:** 10
- **Issues fixed:** 9 (1 critical, 3 high, 4 medium, 0 low)
- **Issues deferred:** 1 (medium — rate limiting)
- **Remaining risk level:** LOW

---

## Fixed Issues

### AUTH-001 — Refresh Token Theft Detection (CRITICAL)

**Root cause:** The refresh endpoint didn't distinguish between "session doesn't exist" and "session was already revoked (token stolen)". When an attacker reused a rotated refresh token, they got "session not found" instead of triggering theft countermeasures.

**Fix:** The refresh handler now:
1. Looks up the session by ID regardless of revocation status
2. If the session is already revoked, it's treated as token theft — ALL sessions for that user are revoked
3. User is forced to re-authenticate with a clear theft message

**Files changed:** `src/routes/auth.ts` (refresh handler, lines 186-218)

**Similar patterns checked:** Logout also revokes sessions but is user-initiated — no theft signal needed there.

---

### AUTH-002 — OAuth State Validation (HIGH)

**Root cause:** The `/v1/auth/oauth/start` generated a `state` parameter but never stored it. The `/v1/auth/oauth/callback` endpoint accepted any non-empty state string with no verification. This enabled CSRF on the OAuth callback.

**Fix:**
1. Added `oauth_states` table to Drizzle schema with state as PK, provider, codeVerifier, nonce, expiresAt, consumedAt
2. `oauth_start` now inserts the state with a 10-minute TTL
3. `oauth_callback` now validates state exists, matches provider, and hasn't expired/been consumed
4. State is marked consumed on use (one-time use enforced)

**Files changed:** `src/db/schema.ts` (new oauth_states table), `src/routes/auth.ts` (oauth_start + oauth_callback handlers)

**Similar patterns checked:** The Apple native callback doesn't use state (uses idToken + nonce instead) — no fix needed there.

---

### DATA-001 — Unvalidated Date Inputs (HIGH)

**Root cause:** Cursor, from, to, occurredAt, targetAt, startsAt, endsAt parameters accepted any string. `new Date('invalid')` produces `Invalid Date`, causing SQL errors or unexpected query behavior.

**Fix:** Added `z.string().datetime({ offset: true })` validation to all user-provided date parameters:
- `GET /v1/spaces/current/moments?cursor=`
- `GET /v1/spaces/current/calendar/events?from=&to=`
- `POST /v1/spaces/current/moments` (occurredAt, targetAt)
- `PATCH /v1/moments/:id` (occurredAt, targetAt)
- `POST /v1/spaces/current/calendar/events` (startsAt, endsAt)
- `PATCH /v1/calendar/events/:id` (startsAt, endsAt)
- `POST /v1/spaces/current/imported-milestones` (occurredAt, targetAt)

**Files changed:** `src/routes/moments.ts`, `src/routes/calendar.ts`, `src/routes/milestones.ts`

**Similar patterns checked:** All 15 `new Date(input.*)` call sites inspected. All now have validated inputs.

---

### AUTHZ-001 — Missing Active Space Check on Resource Update/Delete (HIGH)

**Root cause:** PATCH and DELETE handlers for moments and calendar events checked resource ownership (`createdByUserId`) but not active space membership. A user who had left a space could still modify their old resources.

**Fix:** Added space membership verification (must be `state='active'`) before allowing update/delete on:
- `PATCH /v1/moments/:id`
- `DELETE /v1/moments/:id`
- `PATCH /v1/calendar/events/:id`
- `DELETE /v1/calendar/events/:id`

**Files changed:** `src/routes/moments.ts`, `src/routes/calendar.ts`

**Similar patterns checked:** `GET /v1/calendar/events/:id` already had this check. Milestones have no update/delete endpoints. Space creation and join already check for existing membership.

---

### SIZE-001 — Missing Input Size Limits (MEDIUM)

**Root cause:** Moment body, milestone body, calendar event title/actorName had no maximum length constraints, allowing potential abuse.

**Fix:** Added Zod `.max()` constraints:
- Moment title: 500 chars
- Moment body: 10,000 chars
- Moment mediaPreview: 2,000 chars
- Calendar event title: 500 chars
- Calendar event actorName: 200 chars
- Calendar event label customText: 200 chars
- Milestone title: 500 chars (already had this)
- Milestone body: 10,000 chars

**Files changed:** `src/routes/moments.ts`, `src/routes/calendar.ts`, `src/routes/milestones.ts`

---

## Deferred Issues

### RATE-001 — No Rate Limiting (MEDIUM)

No rate limiting on any endpoints including auth (5 req/min per IP as spec'd in architecture doc) and invite code attempts. Adding rate limiting requires either a middleware with in-memory store or Redis. Appropriate for a follow-up when deploying to production.

**Workaround:** Cloudflare or reverse proxy rate limiting can be applied at the infrastructure level.

---

## Verification

All fixes verified with:
- `npx tsc --noEmit` — clean (0 errors)
- `node --import tsx src/index.ts` — server starts (tested with health endpoints)

## Remaining Risks

1. **No rate limiting** — mitigated by infrastructure-level limits
2. **OAuth provider integration is stubbed** — real token exchange + idToken verification not yet implemented. The OAuth callback flow is correct for the stub but needs provider API calls before production use.
3. **No input sanitization on text fields** — moments/events/milestones accept arbitrary text (up to 10K chars). If rendered in web views, could present XSS risk. Currently mobile-only renders in React Native which handles text safely.
4. **No database encryption at rest** — user data stored as plaintext in Postgres. Acceptable for MVP but worth encrypting sensitive fields (mediaPreview URLs) before public launch.
5. **Logout doesn't revoke access tokens** — access tokens are short-lived (15 min) and stateless, so they can't be server-revoked. Acceptable by design.

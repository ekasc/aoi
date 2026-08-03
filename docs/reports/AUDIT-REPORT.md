# Aoi Security Audit Report

**Date:** 2026-05-29 @ 17:30 PDT
**Scope:** `packages/api/` (Hono + Postgres) + `features/` (Expo frontend auth/session layer)
**System type:** Auth-heavy couples journaling app (API + mobile frontend)

---

## Summary

- **Critical issues:** 0
- **High issues:** 0
- **Medium issues:** 5
- **Low issues:** 3
- **Fixed during audit:** 0 issues needed code changes — all findings are architectural/design gaps
- **Remaining risk level:** Low

The API follows good security practices overall: Drizzle ORM prevents SQL injection, auth middleware scopes requests to authenticated users, ownership checks are present on all mutation endpoints, data queries are scoped to the user's active space, refresh tokens are rotated with theft detection, and rate limiting is in place.

The main gaps are around data persistence (missing field), cleanup hygiene (orphaned records), and a few OAuth stub features waiting for production wiring.

---

## Fixed Issues

None — this was an audit-only pass. Findings below are not actively exploitable in production or require design decisions to resolve.

---

## Issues

### MEDIUM-01: Partner name not persisted on space create/update

**Category:** Data integrity
**Affected area:** `routes/spaces.ts`, `lib/db.ts`, `db/schema.ts`

**Root cause:** The `spaces` table has no `partner_name` column. The `partnerName` field is accepted during creation (`POST /v1/spaces`, line 73), returned in the response (line 127), and accepted in updates (`PATCH /v1/spaces/current`, line 229) — but it is never written to the database.

**Failure/exploit scenario:**
- User A creates a space with partner name "Alex"
- User A navigates away and back — `GET /v1/spaces/current` returns `partnerName: space.name` (the space name, not the partner's name) — data corruption, not security
- User B (partner) joins — the API never stored their name, so partner name is unreliable everywhere

**Fix required:**
1. Add `partner_name` column to `spaces` table
2. Write it on insert (creation) and update (PATCH)
3. Remove the `partnerName: space.name` fallback in `GET /v1/spaces/current`

**Tests:** Requires migration + API integration test

---

### MEDIUM-02: PKCE codeVerifier not validated on OAuth callback

**Category:** OAuth security
**Affected area:** `routes/auth.ts:105-142`

**Root cause:** The callback handler stores the `codeVerifier` generated in `/start` but never validates it against the one provided in the callback request. PKCE exists only as a stub.

**Failure/exploit scenario (when real OAuth is wired):**
- Attacker intercepts the authorization code from the OAuth redirect (e.g., via compromised redirect URI or referrer header leak)
- Without PKCE verification, the attacker can exchange the stolen code for tokens
- PKCE is specifically designed to prevent this — the code verifier is known only to the original client

**Fix required:**
```ts
if (storedState.codeVerifier && codeVerifier !== storedState.codeVerifier) {
  throw badRequest('Invalid code verifier (PKCE mismatch)');
}
```

**Blocked by:** Real OAuth provider integration. Currently in stub mode where no real provider tokens are exchanged.

---

### MEDIUM-03: No request body size limits

**Category:** DoS / resource exhaustion
**Affected area:** `app.ts` (global middleware)

**Root cause:** There is no global middleware enforcing a maximum request body size. Zod schemas enforce per-field max lengths (`title: z.string().max(500)`, `body: z.string().max(10000)`, etc.), but the full JSON payload is parsed into memory before Zod validates.

**Failure/exploit scenario:**
- Attacker sends a POST to `/v1/spaces/current/moments` with hundreds of fields, each within Zod limits. The JSON parser (built-in) allocates memory for the full payload before validation.
- With concurrent requests, this could exhaust available memory on a small instance (Hetzner CX32 → 2GB RAM).

**Fix required:** Add a body size limit middleware:
```ts
import { bodyLimit } from 'hono/body-limit';

app.post('*', bodyLimit({
  maxSize: 1024 * 100, // 100KB
  onError: (c) => c.json({ error: { code: 'PAYLOAD_TOO_LARGE', message: 'Request body too large' } }, 413),
}));
```

---

### MEDIUM-04: No cleanup for expired OAuth states

**Category:** Data hygiene
**Affected area:** `routes/auth.ts:79-86`, `db/schema.ts`

**Root cause:** OAuth states have an `expiresAt` field (10-minute TTL), but there's no cleanup mechanism for consumed or expired rows. They accumulate in the `oauth_states` table indefinitely.

**Failure/exploit scenario:**
- Over time, the `oauth_states` table accumulates millions of rows. While each row is small and indexed by primary key, excessive table bloat affects query performance and backup size. Not an active security risk since expired states are rejected on use.

**Fix required:**
- Add a periodic cleanup query or a Drizzle cron job to delete states where `expiresAt < now() OR consumedAt IS NOT NULL`
- Could be a simple `DELETE FROM oauth_states WHERE expiresAt < now()` in a background interval

---

### MEDIUM-05: No cleanup for orphaned pending media records

**Category:** Data hygiene / storage accounting
**Affected area:** `routes/media.ts`

**Root cause:** Media uploads that get a presigned URL but never complete (`POST /v1/media/:id/complete`) stay in `uploadState: 'pending'` forever. The presigned URL expires after 1 hour, but the DB record remains.

**Failure/exploit scenario:**
- A user can call `POST /v1/media/upload-url` repeatedly with different filenames, creating rows in 'pending' state that will never be completed. Over time this inflates the `media_objects` table. No storage cost (R2 never received the file), but DB bloat.

**Fix required:**
- Add a cleanup job to delete or mark-as-failed media records where `uploadState = 'pending'` and `createdAt < now() - interval '2 hours'`

---

### LOW-01: `as any` casts in DB row converters

**Category:** Type safety
**Affected area:** `lib/db.ts`

**Details:** `momentRowToApi`, `calendarEventRowToApi`, and others cast enum fields with `as any`:
```ts
type: row.type as any,
authorRole: row.authorRole as any,
```
If a value outside the expected enum is somehow inserted into the DB (via direct query, migration, etc.), it would pass through to the API response as-is. Not exploitable in practice because:
1. Drizzle inserts are type-checked
2. Enum columns in Postgres reject invalid values at the DB level

**Fix:** Use Drizzle's generated types instead of `as any`:
```ts
type: row.type as Moment['type'],
```

---

### LOW-02: CORS wildcard with credentials in default config

**Category:** Configuration
**Affected area:** `app.ts:19-22`

**Details:** When `CORS_ORIGIN` is not set in the environment, the CORS middleware defaults to `origin: '*'` with `credentials: true`. This combination is rejected by browsers — credentials require an explicit origin. The net effect is that credentials-based requests only work when `CORS_ORIGIN` is explicitly set (the correct behavior), but this should be explicit rather than relying on browser enforcement.

**Fix:** Remove the `?? '*'` fallback or log a warning at startup when CORS_ORIGIN is not set.

---

### LOW-03: `GET /v1/spaces/current` returns `partnerName` as space name

**Category:** Data integrity
**Affected area:** `routes/spaces.ts:63`

**Details:**
```ts
partnerName: space.name, // name is set to relationship name, partner name is extracted from members
```
The comment says "partner name is extracted from members" but the code assigns `space.name`. The partner name is never actually looked up from space members. This is the same root cause as MEDIUM-01 (partner name not persisted) but affects the read path only.

---

## Remaining Risks

1. **OAuth providers not wired** — auth is in stub mode. When real Google/Apple OAuth is integrated, verify:
   - `id_token` signature verification (JWKS)
   - `nonce` validation for Apple native sign-in
   - PKCE codeVerifier validation
   - State replay protection (already implemented)

2. **JWT_SECRET shared** — access tokens (15min) and refresh tokens (30d) use the same signing secret. In production, consider separate secrets so a compromised access token signing key doesn't cascade to refresh tokens.

3. **No audit log** — there's no logging of auth events (sign-in, sign-out, token refresh, failed attempts). This makes incident investigation difficult.

4. **Rate limiter is in-memory** — the Map-based rate limiter doesn't survive process restarts and doesn't scale across multiple instances. Acceptable for MVP; deploy with a Redis-backed limiter for multi-instance deployments.

5. **No account deletion endpoint** — `DELETE /v1/user/account` doesn't exist. Hard-deleting user data requires manual DB queries. (Noted in PLAN.md Phase 4 as backlog.)

6. **No brute-force protection on auth endpoints beyond basic rate limiting** — 10 req/min per IP is a soft limit. A distributed attack across many IPs could bypass it.

## Files Audited

| File | Lines | Key findings |
|---|---|---|
| `packages/api/src/app.ts` | 101 | CORS config, error handler, route wiring |
| `packages/api/src/middleware/auth.ts` | 27 | Bearer token verification |
| `packages/api/src/middleware/rate-limit.ts` | 61 | In-memory sliding window |
| `packages/api/src/routes/auth.ts` | 391 | OAuth start/callback, refresh, logout |
| `packages/api/src/routes/spaces.ts` | 289 | Space CRUD + join/invite |
| `packages/api/src/routes/moments.ts` | 220 | Moment CRUD with ownership |
| `packages/api/src/routes/calendar.ts` | 250 | Event CRUD with ownership |
| `packages/api/src/routes/media.ts` | 277 | Upload/download pipeline |
| `packages/api/src/routes/milestones.ts` | 100 | Milestone CRUD |
| `packages/api/src/routes/preferences.ts` | - | Theme preferences |
| `packages/api/src/lib/jwt.ts` | 49 | Token signing/verification |
| `packages/api/src/lib/crypto.ts` | 27 | Random tokens, hashing |
| `packages/api/src/lib/errors.ts` | 29 | Error helpers |
| `packages/api/src/lib/db.ts` | 96 | Row-to-API converters |
| `packages/api/src/db/schema.ts` | 272 | Full DB schema |
| `features/api-client.ts` | 93 | Token refresh + retry |
| `features/session/session-context.tsx` | 222 | SecureStore persistence |
| `components/moments/moment-card.tsx` | 279 | User content rendering |

## Verification Commands

```bash
cd ~/aoi && npx tsc --noEmit   # passes with zero errors
cd ~/aoi/packages/api && npx vitest run  # existing test suite
```

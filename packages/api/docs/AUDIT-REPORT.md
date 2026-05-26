# Security Audit Report — Round 2

**Date:** 2026-05-26 @ 21:15 UTC
**Scope:** Re-audit of round 1 fixes + test coverage
**Type:** API Codebase — Post-fix verification

## Summary

- **New issues found:** 3
- **Issues fixed:** 3
- **Tests added:** 51 (36 validation, 15 crypto)
- **Remaining risk level:** LOW

---

## Pass 5: Re-Audit Touched Areas

### Finding R2-01 — Fragile Error Message Matching (LOW → FIXED)

**Root cause:** The refresh handler's catch block used `err.message.includes('Session')` to distinguish between session errors (re-throw) and JWT errors (wrap as "Invalid refresh token"). This would falsely match any error containing "Session" from any library.

**Fix:** Changed to `err instanceof HTTPException` — only re-throw errors from our own error factories. All other errors (jose verification failures, etc.) get wrapped properly.

**Files changed:** `src/routes/auth.ts` (catch block)

---

### Finding R2-02 — `c: any` in handleOAuthUser (LOW → FIXED)

**Root cause:** `handleOAuthUser` used `c: any` as its first parameter, bypassing TypeScript type safety on the Hono context object.

**Fix:** Changed to `c: Context` (imported from `hono`).

**Files changed:** `src/routes/auth.ts` (function signature)

---

### Finding R2-03 — No Test Coverage for Validation (MEDIUM → FIXED)

**Root cause:** Round 1 fixes had zero test coverage. No tests existed for Zod schema validation, input size limits, or crypto utilities.

**Fix:** Added 51 tests across 2 test files:

| Test file | Tests | What's covered |
|---|---|---|
| `src/__tests__/validation.test.ts` | 36 | Date format validation (valid/invalid/boundary), input size limits (max lengths, empty strings), OAuth schema validation (providers, URLs, state), space schema (name lengths), moment schema (defaults, types, body limits), calendar event schema (labels, actors, date validation) |
| `src/__tests__/crypto.test.ts` | 15 | Token generation (length, uniqueness, hex), SHA-256 hashing (deterministic, length), invite codes (6-char, allowed chars only, no ambiguous chars, uniqueness), code normalization (uppercase, space removal) |

**Verification:** `npx vitest run` — 51/51 passing (400ms)

---

## Remaining Risks (unchanged)

1. **Rate limiting not implemented** — deferred to infrastructure level
2. **OAuth provider integration is stubbed** — real token exchange not wired
3. **No input sanitization** — React Native handles text safely in MVP
4. **No DB encryption at rest** — acceptable for MVP
5. **Stateless access tokens cannot be server-revoked** — by design (15min TTL)

---

## Stop Conditions Check

All stop conditions from the security skill are met:

| Condition | Status |
|---|---|
| Critical issues fixed or blocked | ✅ |
| High issues fixed or blocked | ✅ |
| Known correctness bugs fixed or blocked | ✅ |
| Relevant verification passes | ✅ (typecheck + 51 tests) |
| Touched areas re-audited | ✅ |
| Repeated bug patterns searched | ✅ (date validation in all routes, membership checks across all handlers) |
| Remaining risks documented | ✅ |

**Stopping audit loop.**

# Aoi — End-to-End Completion Plan

> Author: AI-assisted planning session (May 2026)
> Status: Living document — update as scope changes

## 0. Current State

### What works end-to-end

- **API** (`packages/api/`): Hono + Drizzle ORM + Postgres
  - Auth: OAuth start/callback/native-callback, session, refresh (with token theft detection), logout
  - Spaces: create, join by invite, get current, update metadata
  - Moments: keyset-paginated list, create, update, soft-delete (own only)
  - Calendar events: range query, get by id, create, update, soft-delete (own only)
  - Milestones: list, append
  - Preferences: get/update theme
  - Media: upload pipeline (presigned URLs, R2 storage)
  - Rate limiting middleware
  - Health/readiness checks
  - Tests: crypto, validation (51 tests)

- **Frontend** (Expo SDK 54, Expo Router):
  - Auth screens: sign-in, space setup, space join (invite code), theme select, milestone import
  - Tabs: timeline, calendar, profile, settings
  - Timeline: moment list with timeline rail, upcoming goals lane, scroll-to-bottom, context label
  - Calendar: month grid, day selection, event list, actor pills, create/edit/delete events
  - Moment creation: type selector, title/body, goal target date
  - Calendar event creation: title, date/time, actor, label preset
  - Profile: relationship editing, milestone import
  - Settings: theme picker, sign out
  - API client: token refresh with retry, auth adapter with stub/remote switching
  - Calendar context: stub/remote switch (wired)
  - Moments context: stub/remote switch (wired as of May 26)

- **Infrastructure**:
  - Postgres 17 running locally via systemd (`aoi` database)
  - pnpm workspace with `packages/api` and `packages/shared`
  - Expo router patch for build ctx

### What's partially done or missing

| Area | Status | Notes |
|------|--------|-------|
| Media upload frontend | Not started | API exists, no UI for attaching media to moments |
| Push notifications | Not started | No push token registration, no notification sending |
| Resurface ("On This Day") | Not started | No scheduled job or UI |
| Recaps / Wrapped | Not started | Deferred from MVP per PRD |
| E2E auth flow verification | Not verified | Stub mode works; real OAuth provider integration untested |
| E2E space + timeline + calendar | Needs smoke test | Need to run frontend against API in stub=off mode |
| Test coverage | Low | 51 API tests; no frontend tests |
| CI/CD | Partial | GitHub Actions (`ci.yml`): lint, typecheck, tests, API build. `eas.json` exists (dev/preview/production). No EAS Update or automated deploy yet |
| Deployment | None | No Dockerfile, no Fly.io/railway config |
| Error handling UX | Basic | Timeline has `isLoading`/`error`; calendar has `isLoading`/`error`; other screens may not |

---

## 1. Phase 1: Connect the Dots (MVP Completion)

### 1.1 Auth: Wire real OAuth providers

> Google done. Apple blocked — requires Apple Developer Program ($99/yr).

The API currently has stub OAuth handlers (prefixes provider subjects with `stub_`). When provider keys are configured:

- [x] **Google OAuth**: Exchange authorization code for tokens using Google's token endpoint, verify id_token with Google's JWKS, extract `sub`/`email`/`name`
- [ ] **Apple OAuth**: Verify Apple identity token (JWT signed by Apple's private key), extract `sub`/`email`
- [ ] **Native Apple sign-in**: Server-side verification of the `idToken` from `expo-apple-authentication`
- [x] **PKCE support**: Validate `codeVerifier` against stored challenge on callback
- [x] **Config via env**: Client IDs, secrets, redirect URIs all from environment

### 1.2 Media: Frontend upload UI

API has upload pipeline (presigned URL generation, R2 storage). Frontend needs:

- [x] Media picker in moment creation (camera roll / camera)
- [x] Upload progress indicator
- [x] Image preview in moment card
- [x] Media-only moment type
- [x] Strip EXIF location metadata before upload

### 1.3 End-to-end smoke test

- [ ] Run API, run frontend with `EXPO_PUBLIC_AUTH_STUB_MODE=false`
- [ ] Verify auth flow: sign-in → session restore → space create → theme select
- [ ] Verify timeline: create moments → see them in list → upcoming goals
- [ ] Verify calendar: create events → see on grid → edit → delete
- [ ] Verify profile: edit relationship → import milestones
- [ ] Verify settings: change theme → sign out → sign back in

### 1.4 Error handling gaps

- [x] Profile screen: loading/error states for fetching/updating space
- [x] Settings screen: loading/error for preference update
- [x] Calendar edit screen: loading/error for event update
- [x] Auth screens: network error handling, retry

---

## 2. Phase 2: Quality & Infrastructure

### 2.1 Testing

- [ ] API: Add route-level integration tests (moments, calendar, spaces, preferences)
- [ ] API: Rate limit middleware tests
- [ ] Frontend: Component tests for MomentCard, CalendarGrid, EventCard
- [ ] Frontend: Hook tests for moments-context, calendar-context
- [ ] E2E: Maestro smoke test for auth + space setup flow

### 2.2 CI/CD

- [ ] GitHub Actions: `pnpm install`, `pnpm run typecheck`, `pnpm run lint`, `pnpm run test:unit`
- [ ] Drizzle migrations checked on CI
- [x] EAS Build config (`eas.json`) for iOS/Android builds (dev/preview/production channels)
- [ ] EAS Submit for TestFlight/Play Store

### 2.3 Deployment

- [ ] Dockerfile for API (Node 24, tsx runner)
- [ ] Fly.io or Railway config
- [ ] Managed Postgres (Neon or Supabase)
- [ ] R2 bucket (already configured in code)
- [ ] CORS config for production domain
- [ ] Secrets management (env vars)

---

## 3. Phase 3: Notifications & Engagement

### 3.1 Push notifications

- [ ] Expo push token registration on sign-in
- [ ] `POST /v1/push/register` endpoint
- [ ] Notification on new moment from partner
- [ ] Notification on new calendar event from partner
- [ ] Calendar reminder notification (at configured `reminder_minutes`)
- [ ] NSFW content: generic notification text, blurred thumbnail

### 3.2 Resurface ("On This Day")

- [ ] Scheduled job (cron) checking for moments from 1+ years ago
- [ ] Daily push notification with resurfaced moment(s)
- [ ] In-app resurface feed or banner on timeline

---

## 4. Phase 4: Post-MVP Features

### 4.1 Recaps / Wrapped

- [ ] Monthly recap generation (auto-collect moments + media from month)
- [ ] Yearly/anniversary recap
- [ ] Recap share card (image export)
- [ ] Notification when recap is ready

### 4.2 Space lifecycle

- [ ] Leave space (delete authored content)
- [ ] Archive space (read-only, encrypted content locked)
- [ ] Full account deletion endpoint + workflow
- [ ] Data export (JSON + media download)

### 4.3 Location sharing

- [ ] Optional live location between partners
- [ ] Implicit moments ("arrived home", "left work")
- [ ] Location history view

### 4.4 Monetization

- [ ] Subscription tiers (monthly/yearly/lifetime)
- [ ] Receipt verification (Apple App Store + Google Play)
- [ ] Storage quota enforcement
- [ ] Feature gating (media storage limit, recap access)

---

## 5. Architecture Decisions Log

Key decisions made during implementation that should be preserved:

- **Separate moments and calendar events** (not subtypes) — enables independent lifecycle
- **Keyset pagination for timeline** — stable under writes, efficient at scale
- **Soft-delete for authored content** — partner's content survives until they delete
- **Hard-delete on user deletion** — media objects removed from R2 synchronously
- **Actor-aware events** — `you` vs `partner` tracked independently of creator
- **No auto-promotion** from event to moment — user must explicitly promote
- **Stub/remote pattern** — `isStubMode()` lets frontend work fully offline during development
- **Token theft detection** — refresh token rotation with mass-revocation on detected theft
- **Rate limiting** — 10 req/min for auth endpoints, 100 req/min for authenticated routes

---

## 6. Open Questions

- Should relationship edit permissions be both members or creator-only?
- Should timeline support hard delete in MVP, or keep soft delete only?
- Should imported milestones remain distinct server records or become first-class moments at write time?
- Should theme be per-user or per-space once backend sync is live?
- Expo SDK 54 vs SDK 56 migration timing?

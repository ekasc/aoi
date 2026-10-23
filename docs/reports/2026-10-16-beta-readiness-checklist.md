# Aoi beta readiness checklist — 2026-10-16

Audit of the repo at branch `feat/post-album-splash-e2e`, last commit `67efab1` (2026-10-08),
working tree dirty: 150 modified, 77 untracked, 31 deleted, 155 commits ahead of `main`.

**Verdict: not ready for external testers. Ready for a closed dogfood beta once every P0 is cleared.**

Line numbers are hints from the audited revision and will drift; treat the file and symbol as the source of truth.

Three read-only sweeps produced this: a release/ops sweep, a resilience sweep, and a backend/data-safety sweep,
plus the checks listed in [Verification runs](#verification-runs). Findings from the sweeps are cited by
location so they can be spot-checked. Nothing was executed against a deployed environment.

---

## Beta gate

External testers may be invited when all four are true:

- [ ] **G1 — Every P0 below is checked.**
- [x] **G2 — `pnpm run typecheck && pnpm run lint && pnpm run test:unit && pnpm run a11y:audit` is green on a committed revision.**
  Verified 2026-10-17 on `681f50a`: typecheck clean, lint 0 errors (13 pre-existing warnings),
  **2068 tests in 220 files pass**, a11y 0 findings across 143 files. Also run and passing:
  **integration project, 600 tests / 41 files** (real Hono routes + D1 shim + real crypto), which G2's
  command list above does not include. All local: CI has not run on this branch.
- [ ] **G3 — A tester can install without your laptop.** TestFlight, or an ad-hoc build whose profile does not expire in seven days.
- [ ] **G4 — A crash or failed request on a tester's phone reaches you.** Without this, a beta produces anecdotes instead of bug reports.

G2 and G4 are the two that carry the most information per unit of work. G3 is mostly procurement.

---

## P0 — blocks an external beta

### P0-1 — iOS distribution depends on a paid Apple Developer Program

- [ ] Enrol in the Apple Developer Program (or accept a closed dogfood beta instead of an external one).

A personal team cannot hold `aps-environment` (push) or `com.apple.developer.applesignin`, so it
cannot provision this app at all. Today's install is a stripped build: bundle id `com.ekasc.aoi.dev`
(installs beside the real app, separate keychain), **no push, stub sign-in, profile expiring
2026-10-24**, cap of 3 devices. No TestFlight path exists.

Evidence: `app.config.js:4-8`, `app.config.js:29-50`, `plugins/with-ios-personal-team.js:4-10`,
`eas.json:33-35` (`submit.production` is `{}`). EAS has no Apple credentials:
`npx eas-cli device:list` → "No Apple teams found for account aoi-app".

Acceptance: a tester installs from TestFlight or a build URL, with push and real sign-in working.

### P0-2 — The work exists only as an uncommitted working tree

- [x] Commit the current work in reviewable units.
- [ ] Push and open a PR so CI sees the code.
- [ ] Cut the beta from a tagged revision.

Nothing has been committed in 8 days. There is no revision a tester's build can be cut from, CI has
never run against this code, and one `git checkout` loses 150 files of work.

**Split done: 14 units, `67efab1..7192690`.** `chore(ci)` drop marketing-site + split the test jobs ·
`chore(config)` dev target/apk ignore/deps · `fix(notifications)` push-getter guard · `test(harness)`
mock stubs · `feat(splash)` · `feat(home)` · `feat(calendar)` · `feat(keepsake)` · `feat(collections)` ·
`feat(api)` · `feat(e2e)` · `feat(dev)` · `fix(app)` the UI audit sweep · `docs`. The tree is clean
apart from `films/aoi-launch`, deliberately left untracked (a separate Remotion project). On the
committed revision: `typecheck` clean, `lint` 0 errors (13 pre-existing warnings), `test:unit`
**243 files / 2515 tests, 0 failed**, `a11y:audit` 0 findings.

Push and tag are deliberately not done — they wait on an explicit go-ahead per push.

**Additional blocker found while preparing the split:** the tree cannot build from a clean clone.
`features/dev/local-stress-config.ts` statically imports `./local-stress-config.json`, and that file
is untracked *and* currently populated with a live config (a private-LAN URL and a synthetic but real
access token). So the committed revision would fail resolution in CI, and committing the file as-is
would violate the repo's own "never commit an active config" rule from `AGENTS.md`. It must become a
tracked `null` placeholder before the first commit. `artifacts/aoi-dev-android.apk` (400 MB) is
correctly covered by the new `*.apk` ignore rule.

Acceptance: `git status --porcelain` is empty apart from ignored paths, and CI is green on the commit
the beta was built from.

### P0-3 — Three test files are red

- [x] Fix the `expo-audio` mock: `useAudioPlayerStatus` is missing.
  - `tests/unit/media/audio-player.test.tsx` (2 failing tests)
- [x] Fix the `expo-secure-store` / `expo-modules-core` `EventEmitter` mock gap.
  - `tests/unit/dev/debug-capture.test.ts` (whole suite fails at import)
  - `tests/unit/moments/chapter-photo-stack.test.tsx` (1 failing test)

One root cause: the `expo-*` test mocks no longer match the modules the app uses. These pass on a
stashed tree, which proves the current tree broke them — not that they are unrelated to it.

**Resolved.** The mock gap was wider than `expo-*`: `tests/setup.ts` now stubs `expo-secure-store`
(in-memory), `expo-sharing`, and `react-native-view-shot` — the last because it resolves to its
untranspiled `src/index.tsx` under vitest, so any screen reaching the keepsake share sheet died at
import before a line of app code ran. `expo-audio` gained `useAudioPlayerStatus` and
`useAudioSampleListener` centrally, and the file-local mock in `audio-player.test.tsx` (which
shadows the central one) gained `useAudioPlayerStatus` too. Verified `18 passed (18)` on the three
files, then `pnpm run test:unit` → **243 passed (243), 2515 tests, 0 failed files.**

Acceptance: `pnpm run test:unit` reports 0 failed files.

---

## P1 — fix before strangers use it

### P1-1 — No crash or error reporting anywhere

- [ ] Add a crash/error reporter wired to a destination you actually read.

No sentry/bugsnag/crashlytics/instabug/datadog in the repo or in `package.json`. A production crash
is currently silent. The Worker has `observability.enabled: true` (`wrangler.jsonc:24-26`), which
covers the API only.

Acceptance: force an error on a test device and see it arrive.

### P1-2 — No error boundary in production

- [ ] Wrap the tree in an error boundary with a recover affordance.

Only dev preview routes use `DevErrorBoundary` (`features/dev/preview.tsx:239`). One render throw
blanks the entire app.

Evidence: `app/_layout.tsx:58-223`, `app/(app)/_layout.tsx:28-275`.

Acceptance: a thrown render error shows a recoverable screen rather than a blank app.

### P1-3 — A failed account deletion still ejects the user, with the error swallowed

- [x] Signed-out state must not be set when the delete call fails.
- [x] The failure must render on the account screen.

`deleteAccountFn` sets `status='signed_out'` in a `finally`, so it runs on rejection too
(`features/session/session-context.tsx:237-251`). The guard then redirects to landing
(`app/(app)/_layout.tsx:58`) before the message set at `app/(app)/account.tsx:234-235` can render.
Net effect: the server delete fails, the user is thrown out, the account still exists, nothing is said.

**Resolved.** The `finally` teardown now runs only on success, and the failure propagates so the
account screen's existing catch renders the error with a retry. Two notes this needed: the fix
inverted an *intentionally pinned* test — `session-delete-account.test.tsx` asserted "signs out
locally when the server delete fails / never trap the user in a half-deleted local session" — so the
behavior change was a decision, not a bug fix, and the test now asserts the new contract
(stays `signed_in`, storage not cleared, rejection reaches the caller). The screen-level half of the
acceptance was already covered by `ours-hub.test.tsx:409` ("keeps a failed deletion inside its
confirmation so it can be retried"), which mocks `useSession` and so could never have caught the
provider defect. Verified: `37 passed (37)` across the session, account, and subscription files, then
`pnpm run test:unit` → **243 files / 2515 tests, 0 failed**, `pnpm run typecheck` clean.

Acceptance: with the delete call failing, the user stays signed in and sees the error.

### P1-4 — Session tokens are plaintext at rest, and never rotate

- [ ] Hash `user_sessions.token` (or record the accepted risk in writing).
- [ ] Rotate on refresh, with theft detection, as the legacy path already does.

The deployed path stores the raw token (`packages/api/src/db/d1-schema.ts:88`, unique index in
`drizzle-d1/0000_round_xavin.sql:289`), looks it up raw (`domains/auth.ts:91`), and refresh extends
`expires_at` on the *same* token (`domains/auth.ts:133-162`) — a leaked token stays valid indefinitely
if it keeps refreshing. The legacy Postgres path hashes and rotates (`routes/auth.ts:155-165`,
`lib/crypto.ts:9-11`); the deployed path regressed on its own pattern.

Acceptance: a D1 dump yields no usable session token.

### P1-5 — Rate limiting fails open, with no boot assertion

- [ ] Fail closed (or document fail-open as accepted), and assert at boot that all five bindings exist.

A missing binding, a throwing provider, or a rejected `limit()` all return `{ success: true }`
(`services/rate-limit.ts:39-78,97-102`). The `ratelimits` block is added via an untyped cast in
`vite.config.ts:149`; if it fails to emit, every tier stops enforcing while requests keep succeeding.
Tiers: `vite.config.ts:80-86`.

Acceptance: remove a binding and watch requests get refused, or a deployed boot log that says so.

### P1-6 — Request-body bounds are unbounded, and the tests proving bounds test decoy schemas

- [ ] Add maxima to the shared schemas: `shared/src/moment.ts:110-111` (title, body),
  `shared/src/calendar.ts:120-127` (title, actorName, location, unbounded `reminderMinutesBefore` array),
  `shared/src/media.ts:87` (filename).
- [ ] Delete the locally redeclared schemas in `packages/api/src/__tests__/validation.test.ts:60-62`
  so the tests exercise the real contract.

The passing validation suite asserts maxima against schemas it declares itself. None of them is
`@aoi/shared`, so the green result is false assurance about production bounds.

Acceptance: a request with a 1 MB body field is refused, and the test that proves it imports the shared schema.

### P1-7 — Verify `AOI_E2E_MODE` is absent in production; prefer compile-time exclusion

- [ ] Confirm the var is not set on the production Worker.
- [ ] Exclude the route from the production build rather than gating it at runtime.

`POST /v1/auth/e2e/session` is mounted unconditionally (`create-app.ts:183`); the gate is
`config.get('AOI_E2E_MODE') !== 'true'` (`domains/e2e-auth.ts:40`). Because `effects/runtime.ts:24-30`
copies **every string-valued binding** into the config map, merely *present* is enough. With it, the
route mints a **1-year** session for any existing user by email (`domains/e2e-auth.ts:70-80`) and has
no rate limit (`routes/e2e-auth.ts:18`). Not exploitable without the secret; one mis-set variable from
account takeover.

Acceptance: the route 404s on production, and the check is a build fact rather than a deployment habit.

### P1-8 — No in-app privacy policy or terms

- [ ] Set `EXPO_PUBLIC_PRIVACY_URL`, `EXPO_PUBLIC_TERMS_URL`, `EXPO_PUBLIC_SUPPORT_URL`.
- [ ] Publish a hosted policy with a deletion-request path.

Both rows render nothing by design when unset (`features/legal/legal-links.ts:14-27`), and
`features/legal/release-config.ts:82-94` treats them as a release blocker that nothing currently enforces.
`marketing/` holds only markdown specs.

Acceptance: both rows open a real URL from the built app.

### P1-9 — Channels are declared but inert, so no tester build can be hotfixed

- [ ] Add `expo-updates` + `runtimeVersion`, or delete the `channel` keys as false affordances.

`eas.json` sets a channel for all three profiles (`eas.json:10,23,30`); there is no `expo-updates`
dependency and no `updates`/`runtimeVersion` key in `app.json`. Also empty: `submit.production`
(`eas.json:33-35`).

Acceptance: publish an update and see it land on a tester's installed build.

---

## P2 — next pass

- [ ] **Dependency drift.** 13 Expo packages behind SDK-expected patches: `expo-router` 57.0.19 vs ~57.0.28,
  `expo-notifications` 57.0.17 vs ~57.0.23, `expo-image-picker` 57.0.16 vs ~57.0.20, and 10 more.
  `npx expo install --check` warns the project "may not work correctly".
- [ ] **Letters shelf hides a failed refresh when rows exist.** The error branch requires
  `letters.length === 0` (`app/(app)/letters.tsx:183`), so a failed reload shows stale content with no error and no retry.
- [ ] **`Alert.alert` in a production flow**, inconsistent with the app's own ActionSheet pattern for
  destructive actions (`app/(app)/collection/[id]/item/[itemId].tsx:210` vs `:205-208`).
- [ ] **No localization layer.** English-only strings, `en-US` pinned in five places, no RTL.
  Decide whether the beta audience requires it (`app/(app)/(tabs)/plans.tsx:383-384`,
  `features/calendar/calendar-date-utils.ts:3-6`, `components/calendar/year-section.tsx:36`,
  `components/calendar/day-timeline.tsx:89`).
- [ ] **Offline sends require a manual retry.** No connectivity listener anywhere; `canAutoRetry` only
  resumes `queued` records while active (`features/composer/composer-machine.ts:80-82`,
  `composer-context.tsx:397-399,459`). The retry affordance exists (`components/moments/pending-memory-row.tsx:108-124`).
- [ ] **CI never deploys.** `build-api` runs a non-publishing build (`ci.yml:85-88`); no `wrangler deploy`
  step exists in `.github`.
- [ ] **`marketing-site/` in CI does not exist in this checkout** (`ci.yml:104-110`, `tsconfig.json:21`)
  — the job fails at `npm ci`.
- [ ] **E2E workflow does not gate anything.** `e2e-android.yml:18-21` runs on `workflow_dispatch` and one
  feature branch only.
- [ ] **Production CORS is a placeholder**: `https://aoi.example` (`vite.config.ts:51`). Web-only; mobile
  sends no Origin.
- [ ] **`deploy:preview` is documented but throws**: `wrangler.jsonc:13-15` promises it,
  `vite.config.ts:30-64,72-74` has no `preview` bindings and throws on unknown envs.
- [ ] **Better Auth provider credentials default to placeholders** (`auth/better-auth.ts:86-88,96-98`), so a
  missing secret surfaces as a user-facing sign-in failure rather than a boot error.
- [ ] **No `PrivacyInfo.xcprivacy` and no `NSPrivacy*` keys** in source.
- [ ] **Two backends live in one package.** The deployed Worker (Effect + D1) and a legacy Node/Postgres
  app (`index.ts` → `app.ts`, `routes/auth.ts`, `routes/moments.ts`, …), each with its own implementation
  of every domain. Only the Worker is deployed. Decide and cut.
- [ ] **OpenAPI spec drift**: `/docs` describes ~3 of ~50 routes (`openapi.ts:141-154` vs `create-app.ts:182-200`).
- [ ] **App icon and splash are Expo-template era** (`docs/product/store-checklist.md`, store listing section).

---

## P3 — polish

- [ ] `TODOREMOVE(splash-diagnosis)` with a `console.log` — `app/_layout.tsx:102,105`. The only marker in app code.
- [ ] Dead catch on sign-out: `signOut` swallows its internals, making `app/(app)/account.tsx:200-202` unreachable.
- [ ] Year view says "Could not load plans" with the retry only on the parent screen
  (`components/calendar/year-section.tsx:188-192` vs `app/(app)/(tabs)/plans.tsx:1384-1407`).
- [ ] Voice playback failures are unspoken: seek is `catch`-swallowed (`hooks/use-voice-playback.ts:83`).
- [ ] Plus-status refresh silently dropped: `void refreshServerPlus().catch(() => {})`
  (`components/moments/inline-memory-composer.tsx:323`).
- [ ] Token duplication: `components/ui/screen-header.tsx:46-47` hardcodes `#FFF8FA`/`#F6EDF3`, which are
  dark-half tokens (`textPrimary` in both palettes). 31 hex literals across 7 component files otherwise
  sit in the sky renderer, which computes its own palette by design.
- [ ] Album recovery-key rotation is generation-1 only (`domains/album-protocol.ts:737-744`).
- [ ] Unused `recipientClaim` read (`domains/album-protocol.ts:652-659`).
- [ ] Tablet claim: `supportsTablet: true` with no tablet pass, no breakpoint token, and no iPad evidence in `docs/design/`.

---

## Deliberately deferred

Decided 2026-10-17. Not defects — decisions, recorded so they are not rediscovered as surprises.

- [ ] **Monetisation route: deferred until ~$50k ARR.** No web checkout, no link-out entitlement work, no
  per-jurisdiction payment branching until then. Rationale: the saving is roughly 5–10 percentage points,
  not the headline 30% — a small subscription app pays **15%** through Apple's Small Business Program and
  Google's first-$1M tier, not 30%. Below ~$50k/year that difference is under $5k/year, less than the
  engineering, VAT/GST registration, dunning and refunds a self-serve web checkout costs. Revisit at ~$50k
  ARR, at ~$100k ARR where it clearly pays for itself, or if the US App Store link-out rate is decided and
  stays at zero.
- [ ] **Enrol in the App Store Small Business Program.** 30% → 15% for one form, no engineering.
  Google's 15% tier applies automatically under $1M. Enrolment is still open as of the beta.
- [ ] **Preserve the architectural door.** The entitlement must stay server-authoritative (the RevenueCat
  webhook at `packages/api/src/domains/plus.ts` → `refreshServerPlus`) and purchases must stay behind
  RevenueCat, which abstracts store-versus-web. Concretely: no store-specific purchase copy or flow
  assumptions in the paywall, so a second purchase channel is additive rather than a rewrite.
- [ ] **The real decision point is the first store submission**, not now. The EU's unified terms (effective
  2026-10-01) lock a developer into their chosen payment mix for 12 months, and no submission has been
  made yet, so nothing is locked. Decide the mix before submitting, not after.
- [ ] **If that day comes, use a merchant of record** (Paddle / Lemon Squeezy, ~5%) rather than raw Stripe,
  unless VAT registration in every selling jurisdiction is something you actually want to own.

Context for whenever this is picked back up — the numbers move, so re-check before acting: US App Store
link-outs are permitted with **no commission collected**, under court order, with Apple's proposed 5–15%
rate still undecided and the retroactivity question open. Google's US External Content Links program
charges **10% on subscriptions** and requires monthly transaction reporting. EU App Store rates under the
2026-10-01 terms are 15% for link-outs, 20% for in-app alternative payments, 26% for Apple IAP, and a 5%
Core Technology Commission for distribution outside the App Store. None of this is legal advice, and both
stores rewrote their guidelines on 2026-10-01.

## Closed and verified — keep this

Do not re-open these. Each was reproduced as broken in the 2026-09-06 implementation audit and is now
fixed with adversarial tests.

- [x] **Partner-replacement leak (was P1).** `spaces.ts:432` refuses a second partner with
  "This space already had its partner — start a new space together". `session-pairing-isolation.test.ts`:
  **15 passing** A/B/C-over-HTTP tests — C cannot join the historical space via fresh or rotated code, and
  cannot read B's notes, media objects, media display variants, letters, plans, goals, Someday, chapters,
  metadata, reflection answers, imported milestones or activity. A retains full history.
- [x] **Invite rotation (was P2).** `revoked_at` semantics; tests cover old-code revocation, double rotation
  leaving exactly one live code, concurrent rotation vs redemption with one deterministic winner, and
  archived spaces not being resurrectable.
- [x] **Billing webhook atomicity (was P1).** Dedupe insert and entitlement writes commit in one D1 batch,
  and a conflict rolls the dedupe row back so the provider retry re-applies (`domains/plus.ts:163-187`).
- [x] **Stale renewal overwriting an expired entitlement (was P1).** An ordering watermark survives
  expiry and revocation (`domains/plus.ts:140,328-334`). `session-plus.test.ts`: **28 passing**, including
  "older event cannot overwrite newer state", duplicate idempotency, and TRANSFER "never both".
- [x] **Account deletion (was P1).** Now purges identity and leaves an unlinked tombstone
  (`id` + `deleted_at` only), version-committed with the last-member space archive
  (`domains/auth.ts:198-260`). Note: the resilience sweep flagged this as still-soft-delete; it was
  citing the stale audit doc, not the code.
- [x] **No IDOR found** in any session-scoped route traced: moments, collections, media, calendar, letters,
  responses, album protocol, partner-details, preferences, push, squeezes, location all scope from
  `getActiveSpaceId(userId)` and re-check membership.
- [x] **Error hygiene.** Canonical `{ error: { code, message } }`; unknown failures collapse to a fixed 500;
  `zValidator` messages are word-gated so request content never reaches the wire; request ids minted;
  logger redacts token/secret/location keys (`domains/errors.ts:233-236`, `create-app.ts:107-179`,
  `effects/logger.ts:11-49`).
- [x] **Feed pagination is indexed.** `idx_moments_space_occurred_id` on `(space_id, occurred_at, id)`
  matching the keyset query (`db/d1-schema.ts:244-246`, `domains/moments.ts:451-452`).
- [x] **Media pipeline limits are real.** 100 MB cap, MIME allow-list, per-space quota enforced in-statement,
  head-verify on complete, membership-gated serve with `nosniff`, EXIF/GPS stripped on re-encode
  (`shared/src/media.ts:29,55-62`, `domains/media.ts:141-153,170-197,258-276,533-541`,
  `services/media-processing.ts:15-46`).
- [x] **RevenueCat webhook is secret-authenticated** with a timing-safe compare and fail-closed on a missing
  secret (`domains/plus.ts:240-248`, `lib/crypto.ts:33-40`).
- [x] **Contrast is enforced by tests** across both palettes, both modes, frosted cards, accent-washed
  surfaces and fills (`tests/unit/theme/after-hours.test.ts`, 14 tests).
- [x] **The four-state rule holds** (loading / empty / failed read / filtered-empty) across Story, Plans,
  Lists, Collection detail, Moment, Us, Album, Chapter, Letters, Letter reader, Question, Paywall,
  Partner, Someday.
- [x] **No dynamic-type opt-outs.** No `allowFontScaling={false}` or `maxFontSizeMultiplier` anywhere;
  17 files respect reduced motion.

---

## Open questions and unknowns

- [ ] **What is `AOI_E2E_MODE` on the production Worker?** The one P1 I cannot check from a repository.
- [ ] **Does generated D1 SQL match the TS schema for every table and index?** Only ~320 of ~1100 lines of
  `db/d1-schema.ts` and one migration were read; migrations were not confirmed applied anywhere.
- [ ] **What does the cron actually purge?** `programs/cron.ts` was read only in part; prod runs `0 3 * * *`,
  dev runs `crons: []`.
- [ ] **Album-protocol media page clamping** relies on a route schema (`wireAlbumMediaPageQuerySchema`)
  that was not read.
- [ ] **Is the legacy Postgres backend deployed anywhere?** `package.json:9` suggests it is runnable; no
  deploy config was found.

### Performance, measured but not explained

Recorded in `docs/performance-audit.md` from a **development build** with foreground continuity verified
(`initialState: active`, `valid: true`), 20,000-memory archive, 2,000 loaded on the phone. These failed the
project's own diagnostic budgets:

| Step | Worst observed |
|---|---|
| Pagination, 19 pages | 45.8 s total, **6.40 s** slowest page |
| Refresh | 1.35 s JS callback gap |
| Feed scroll-to-top | **2.66 s** (a later repeat: 249 ms, so not constant) |
| Switch to Lists | 2.51 s |
| Open 1,000 letters | 2.42 s |
| Open the year view | 293 ms |

- [ ] Attribute the gaps with a differential experiment, then measure a release build before treating any of
  them as user-visible. Per `AGENTS.md`, the profile path is unavailable on this Hermes target and the
  instrumented render spans exclude JSX construction, reconciliation and commit — so the remainder cannot
  be blamed on native view creation.

Evidence: `.expo/aoi-debug/performance/prodlike-heavy-1791875659040/report.json`.

---

## Verification runs

What was actually executed for this audit:

| Check | Result |
|---|---|
| `pnpm run typecheck` | clean |
| `npx eslint` on touched files | clean |
| `npx vitest run tests/unit` | 2063 passed, **3 failed** (see P0-3) |
| `npx vitest run packages/api/src/__tests__/routes/session-pairing-isolation.test.ts` | 15 passed |
| `npx vitest run packages/api/src/__tests__/routes/session-plus.test.ts` | 28 passed |
| `pnpm run a11y:audit` | 0 findings across 143 files |
| `npx expo install --check` | 13 packages behind |
| `xcrun devicectl list devices` | iPhone 17 paired |
| `npx eas-cli device:list` | no Apple teams on the EAS account |

Two caveats on the green marks. The a11y scanner is credible for what it checks — accessible name and role
on pressables, media labels, input labels, and RN `Modal` trapping — and blind to `accessibilityState`,
`accessibilityHint`, heading roles, focus order, 44 pt targets and contrast (`scripts/a11y-audit.mjs:30,152-195`).
It also does not scan `features/**` and does not recognise `BottomSheetModal` (`components/ui/native-sheet.tsx:1,55`),
so a sheet missing `accessibilityViewIsModal` would pass silently. The 0-finding result is not a clean bill of health.

Nothing was run against a deployed environment, no runtime repro of any finding was performed, and the three
sweeps were delegated reads whose locations are cited for spot-checking rather than re-verified line by line.

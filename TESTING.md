# Aoi automated testing

Three layers, three commands, three promises. A test lives in exactly one layer. `vitest.config.mts` enforces this with explicit project include-lists.

| Command | What runs | Promise |
| --- | --- | --- |
| `pnpm test:unit` | `unit-app` + `unit-shared` + `unit-api` | Deterministic, fast, isolated. No network, no Hono app, no D1, no workerd. |
| `pnpm test:integration` | `integration` + `workers` | Real client→server boundary (HTTP + Hono + D1 + real crypto) or a real workerd isolate. |
| `pnpm test:e2e` | `scripts/run-e2e.mjs` | Real native app + real UI + isolated backend. Fails loudly without a runtime; never passes on a compile alone. |

## Classification rule

A test is a **unit** test only when it is deterministic, fast, and isolated: no real persistence, no Hono app, no workerd isolate. Anything that boots Hono routes, the better-sqlite3 D1 shim, or the workerd pool is an **integration** test, even when Vitest runs it. A **E2E** test drives the real installed app against a real backend.

When adding a test, put it in exactly one project. The integration project lists every harness-backed file explicitly, so a new test cannot silently land in the wrong suite.

## 1. Unit (`pnpm test:unit`)

- `tests/unit/**` (`happy-dom` + the React Native mocks in `tests/setup.ts`): app behavior, album protocol crypto/trust/read/recovery pure units, component interaction states including error/retry.
- `packages/shared/src/**/*.test.ts`: wire-schema and encoding pins.
- `packages/api` unit subset (listed explicitly in the config): handler logic against the mocked drizzle app in `__tests__/helpers/test-app.ts` and pure helpers. These prove logic, never the database.

Album protocol coverage (requirement → file):

- Cryptography + serialization → `tests/unit/album/protocol-layers.test.ts` plus base64/crypto/protocol-crypto suites.
- Signatures + fingerprints → `protocol-layers`; fingerprint symmetry is what both phones compare in Flow B.
- Trust anchors + provenance → `protocol-layers` + `protocol-trust.test.ts`.
- Enrollment + recovery transitions → `protocol-layers` + `protocol-recovery.test.ts`, `restore.test.ts`.
- Bootstrap interruption + resumption → `protocol-layers` (pinned anchor, monotonic deletions, upload journal resume/drop).
- Manifest + tombstone validation → `protocol-layers` + `protocol-read.test.ts`.
- UI error + retry → `tests/unit/album/album-error-retry.test.tsx`.

Mocked at this level: `expo-secure-store` (in-memory map), AsyncStorage, the archive boundary in screen tests. A mocked transport test is never cited as proof the real API works; that proof lives in layer 2.

## 2. Integration (`pnpm test:integration`)

- `tests/integration/album-protocol-boundary.test.ts`: the real `AlbumProtocolClient` over real HTTP (ephemeral port, `@hono/node-server`) against real Hono routes + session auth + D1 (better-sqlite3 over the exact baseline SQL) with real signing/sealing/verification. Covers archive creation and reload, claim→approve→accept, enrollment rejection, media publish→retrieve→decrypt, deletion and server-restart persistence, recovery with a replacement identity, conflicting claims, interrupted writes, and concurrent-request invariants.
- `tests/integration/r2-conditional-put.test.ts`: presigned conditional PUTs against a disposable real Cloudflare bucket. Requires `AOI_TEST_R2_ACCOUNT_ID`, `AOI_TEST_R2_ACCESS_KEY_ID`, `AOI_TEST_R2_SECRET_ACCESS_KEY`, `AOI_TEST_R2_BUCKET`. Without them the suite reports **SKIPPED, not passed**.
- `packages/api` harness tests (real routes + D1, listed explicitly) and the `workers` workerd-isolate project.
- `packages/api/src/__tests__/routes/e2e-auth.test.ts`: gates the one test-only API seam (404 without `AOI_E2E_MODE=true`, 401 without the per-run secret, real session row when both hold).
- `tests/integration/session-lifecycle-boundary.test.ts`: real app API client over HTTP and D1. Existing sessions survive old expiry dates; global sign-out revokes every device and push registration for the caller, preserves the partner's session, and retains membership for the next login.

Integration serializes inside its project so D1 files are never shared across files. Every server-in-a-test uses an ephemeral port and an isolated database (memory or temp file).

## 3. E2E (`pnpm test:e2e`)

`scripts/run-e2e.mjs` supervises:

1. Maestro binary check.
2. Device check (two instances for Flow B).
3. Isolated backend (`packages/api/src/e2e-server.ts`): per-run D1 file, per-run secret, seeded Alice/Bob and a shared space, uploads terminating locally with HMAC-signed URLs and enforced `If-None-Match`.
4. Metro E2E-bundle check.
5. App-installed check.
6. Maestro flows with per-flow env.
7. Cross-device comparisons (fingerprints, media ids, phrase extraction).
8. Unauthorized-identity HTTP checks.
9. Matrix + artifacts.
10. Cleanup.

Any missing runtime is a nonzero exit, never a pass.

Flows (`e2e/maestro/`, appId `com.ekasc.aoi`):

- **Album A** (`album-a-creation`): Alice signs in through the E2E console, first album open mints the archive, phrase view and confirm, restart, reopen.
- **Album B** (`album-b1/b2/b2b/b3`): Bob requests, Alice sees the request and fingerprints match, Alice approves, Bob accepts and enters the archive.
- **Album C** (`album-c-media`): Alice uploads the bundled fixture through the real sealing pipeline, both devices list and decrypt it, restart keeps it, unknown identities get 404/401.
- **Album E** (`album-e0-show-phrase`, `album-e-recovery`): phrase extracted from the real screen, device wiped, restore from the typed phrase, shared photo decrypts.
- **Album D** (`album-d-deletion`): signed tombstone, both archives empty, restart keeps it deleted.
- **Other flows:** auth stub smoke, create space story, lifecycle, memory note, plans, plus boundaries, together.

The app affordances are fenced: `app/dev-e2e.tsx` (`__DEV__` + `EXPO_PUBLIC_E2E_MODE`, never linked from UI), `features/e2e/e2e-session.ts` (identity bootstrap only), the `AOI_E2E_MODE`-gated `/v1/auth/e2e/session` endpoint (404 in production), and the E2E branch in `app/index.tsx`. Album crypto, transport, enrollment, SecureStore, and decryption are never stubbed.

First-device calibration checklist: `aoi://` deep-link format, `maestro hierarchy` output shape for fingerprint/phrase/media-id regexes, wizard-free landing after setup, and second-emulator serials in CI. Selectors are source-grounded but unproven until the first green hardware run.

## 4. Accessibility

`pnpm run a11y:audit` checks the static contract across `app/` and `components/`. The same check runs in `tests/unit/components/a11y-audit.test.ts`, so the unit suite fails when a new element breaks it.

The audit is conservative: every tappable control has a role and a name, every image is labelled or decorative, every input has a label, every modal traps the screen reader. Conventions it cannot see (headings, 44×44 targets, state, live regions, contrast, Dynamic Type, reduced motion) are listed in [AGENTS.md](AGENTS.md).

Contrast is enforced separately by `tests/unit/theme/after-hours.test.ts` for every theme and mode. Fix the token in `constants/theme-presets.ts`, never the test.

## 5. Behavior coverage map

Use this to decide where a new test belongs. Full flow IDs and states are no longer stored separately; keep the behaviors below covered.

| Area | Must stay covered |
| --- | --- |
| Launch, auth, session | Signed-out landing; Apple/Google success, cancel, provider error; existing sessions survive old expiry dates and offline startup; unreadable storage is not deleted; renewed credentials persist across restart; transient refresh failures and stale account responses cannot sign out the current account; confirmed revocation removes access; sign-out clears tokens and push token; delete account keeps shared history for the partner. |
| Onboarding, pairing | Create vs join; optional relationship date; invite mint/share/expiry; manual status check; join with valid, wrong, expired, used, own, or full-partner code; creator saves before partner joins and attribution is correct. |
| Capturing and saving | Empty feed to first memory; note/photo/video/voice; permissions; attachment limit and order; draft survival; offline pending vs failed vs saved; retry produces exactly one memory; overlong content rejected by client and server. |
| Reading and editing | Oldest-first keyset paging with no duplicates; seen cursor; open detail; photo viewer; voice/video playback; edit is author-only; delete is a tombstone; stale edit returns 409; future-dated memory stays archived. |
| Us and album | Empty sky; add/choose photos; encryption and upload; read/decrypt on the second device; focused photo; Sky History gating; device enrollment/approval; recovery phrase restore; deletion tombstone. |
| Plans | Month, agenda, year, day drill; create/edit/delete; all-day; together; reminders; weekly recurrence; anniversaries; goals; Someday check-off and undo; empty vs failed month. |
| Lists | Create/edit/reorder lists; items with note/link/cover/status/score; shared visibility; empty and failed states; removal. |
| Account and Plus | Appearance; relationship edits; raw data export; album devices; Plus active/inactive; purchase, restore, pending activation; leave space; delete account; session sign-out everywhere. |
| Question, responses, partner details | Weekly answer upsert and reveal gate; partner content hidden until both answer; responses tap/word/photo/voice; author attribution; private partner details stay private. |
| Notifications and push | Calendar `event_*`, moment changes, question, and Plus kinds; foreground banner without sound; dead token pruning; no content in payloads. |
| Reliability | App background/foreground refresh; failed reads keep retry; pending/failed work survives; no duplicate rows on replay; no stale account data. |

Auth race regressions cover late successful JSON and media responses after account switches, same-session renewal, A-B-A switches during a pending leave, same-space edits during a leave, stale push cleanup after a new registration, and keychain deletion failures during offline sign-out or confirmed revocation.

Push mutations serialize server requests and reject queued work after an account switch. Real client-module tests verify credential capture, unregister-before-logout ordering, renewal during cleanup, and forwarding the attempted device token after an unregister failure. Worker route tests verify that logout atomically removes that device's push registration and cannot remove another account's registration.

The MiroFish auth subject in `tools/mirofish-lab/src/auth-subject.mjs` exposes allowlisted source reads, regression checks, and an isolated Hono/D1 fixture. `run-auth-swarm.mjs` pins DeepSeek V4.1 Flash and requires actions and discussion from every cohort against unchanged source. Keys come from `OPENCODE_GO_API_KEY` or a privately supplied `MIROFISH_KEY_FILE`; the runner does not load project environment files. Raw runs and source fingerprints stay in the configured output directory. Persona comments remain hypotheses until reproduced or verified against source. Native OAuth and device keychain behavior remain outside this fixture.

## 6. Performance and stress

- `node scripts/perf-audit.mjs` — navigation and frame audit. `--extended` adds secondary routes and feed scrolling; `--media` adds video lifecycle checks. Results land under `.expo/aoi-debug/performance/`.
- `node scripts/stress-prodlike.mjs --profile established|heavy` — isolated populated D1 databases plus mixed authenticated API reads/writes. `--host <private-LAN-IP> --device` runs the real app against remote repositories. `--ui-only` skips the API ramp.
- `scripts/stress-assess.mjs` evaluates the diagnostic budgets. Functional success alone is not a pass.
- Native reports must include `foreground.valid=true`. The runner records AppState transitions and invalidates timings if the app starts inactive or leaves the foreground.
- Run benchmarks against the max, not the mean. A dev build is slower than production.
- The Hermes sampling profile path is unavailable on iOS. Attribute a stall with differential experiments: one arm per candidate cause, several samples per arm, compare distributions.

## 7. CI

- `.github/workflows/ci.yml`: `lint-and-typecheck`, `test-unit`, `test-integration`, and a non-publishing Worker build (`build:cloudflare`).
- `.github/workflows/e2e-android.yml`: debug APK on two API-34 emulators, host backend, Metro E2E bundle, `scripts/run-e2e.mjs`, artifact upload, cleanup, nonzero exit on failure.
- `.github/workflows/android-cloud-device.yml`: an interactive Android emulator for device work. Needs `TS_AUTHKEY`; without it the job stops rather than exposing an unauthenticated adb port.

## 8. Flaky-test policy

- Keep full-suite-load failures visible: no deletions, no suppressions, no silent retries.
- Suspects are shared-state leakage (singleton mocks across files), timeout pressure, and parallel execution. The integration project already runs serially for this reason.
- Prefer isolation and deterministic synchronization over raising timeouts.
- If a test goes red because the design changed, delete the test. Never re-add the UI to satisfy it.

## 9. What automated tests cannot prove

These need a device, a store, a service, or a person:

- Native sheet and keyboard layout, VoiceOver behavior, Dynamic Type reflow.
- Real push delivery, notification permission behavior, and background execution.
- Store purchases, restore, pending activation, and store price rendering.
- Physical-device sky performance and gesture feel.
- Real media transfer through R2 in production.
- Server-side PDF keepsake generation against the live backend.
- Whether a person understands the product.

Do not cite a mocked or browser-only run as proof of those.

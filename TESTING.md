# AOI automated testing: unit · integration · E2E

Three layers, three commands, three different promises. A test lives in
exactly one layer (see the classification rule); the Vitest workspace
enforces it by project include-lists in `vitest.config.mts`.

| Command | What runs | Promise |
|---|---|---|
| `pnpm test:unit` | `unit-app` + `unit-shared` + `unit-api` | Deterministic, fast, isolated. No network, no Hono app, no D1, no workerd. |
| `pnpm test:integration` | `integration` + `workers` | Real client→server boundary (HTTP + Hono + D1 + real crypto), or real workerd isolate. |
| `pnpm test:e2e` | `scripts/run-e2e.mjs` | Real native app + real UI + isolated backend. Fails loudly without a runtime; never passes on a compile alone. |

## 1. Unit (`pnpm test:unit`)

- `tests/unit/**` (happy-dom + the RN mocks in `tests/setup.ts`): app
  behavior, album protocol crypto/trust/read/recovery pure units, component
  interaction states including error/retry.
- `packages/shared/src/**/*.test.ts`: wire-schema and encoding pins.
- `packages/api` unit subset (listed explicitly in the config): handler
  logic against the **mocked** drizzle app in `__tests__/helpers/test-app.ts`
  and pure helpers. These prove logic, never the database.

Album protocol coverage (requirement → file):

- Cryptography + serialization → `tests/unit/album/protocol-layers.test.ts`
  ("unit: protocol serialization") + `base64`/`crypto`/`protocol-crypto` suites.
- Signatures + fingerprints → `protocol-layers` ("unit: signatures and
  fingerprints"); fingerprint symmetry is what both phones compare in Flow B.
- Trust anchors + provenance → `protocol-layers` ("unit: trust anchors and
  device provenance") + `protocol-trust.test.ts`.
- Enrollment + recovery transitions → `protocol-layers` ("unit: enrollment
  and recovery transitions") + `protocol-recovery.test.ts`, `restore.test.ts`.
- Bootstrap interruption + resumption → `protocol-layers` ("unit: bootstrap
  interruption and resumption"): pinned anchor, monotonic deletions, upload
  journal resume/drop, recovery entropy + creation bootstrap round-trips.
- Manifest + tombstone validation → `protocol-layers` ("unit: manifest and
  tombstone validation") + `protocol-read.test.ts`.
- UI error + retry → `tests/unit/album/album-error-retry.test.tsx`
  (enroll transport failure → retry recovers; restore invalid-phrase and
  transport failures keep the typed phrase).

Mocked at this level: `expo-secure-store` (in-memory map — native module),
`MockAsyncStorage`, the archive boundary in screen tests. **A mocked
transport test is never cited as proof the real API works** — that proof
lives in layer 2.

## 2. Integration (`pnpm test:integration`)

- `tests/integration/album-protocol-boundary.test.ts`: the real
  `AlbumProtocolClient` over real HTTP (ephemeral port, `@hono/node-server`)
  against the real Hono routes + session auth + D1 (better-sqlite3 over the
  exact baseline SQL) with real signing/sealing/verification. Covers archive
  creation + reload, claim→approve→accept, enrollment rejection (wrong keys,
  unauthorized devices), media publish→retrieve→decrypt, deletion + server
  restart persistence (file-backed D1 reboot), recovery with a replacement
  identity, conflicting claims / duplicates / interrupted writes, and
  concurrent-request transactional invariants. Only the Expo token-plumbing
  module is stubbed (it cannot load outside Expo); the stub sets a real
  `Authorization: Bearer` header on a real fetch. The device-upload leg
  (ciphertext PUT after a real reservation) is simulated by writing the
  R2 shim directly; the signed PUT itself is proven in the R2 suite.
- `tests/integration/r2-conditional-put.test.ts`: presigned conditional
  PUTs against a **disposable real Cloudflare bucket**. Proves a second
  conditional PUT is refused (412) while an unconditional one would
  overwrite. Requires `AOI_TEST_R2_ACCOUNT_ID`,
  `AOI_TEST_R2_ACCESS_KEY_ID`, `AOI_TEST_R2_SECRET_ACCESS_KEY`,
  `AOI_TEST_R2_BUCKET`. Without them the suite reports **SKIPPED, not
  passed**.
- `packages/api` harness tests (real routes + D1, listed explicitly in the
  config) and the `workers` workerd-isolate project.
- `packages/api/src/__tests__/routes/e2e-auth.test.ts`: gates the one
  test-only API seam (404 without `AOI_E2E_MODE=true`, 401 without the
  per-run secret, real session row when both hold).

Integration serializes inside its project (`pool.forks.singleFork`) so D1
files are never shared across files; every server-in-a-test uses an
ephemeral port and an isolated (memory or temp-file) database.

## 3. E2E (`pnpm test:e2e`)

`scripts/run-e2e.mjs` supervises: Maestro binary check → device check (two
instances for Flow B) → isolated backend (`packages/api/src/e2e-server.ts`:
per-run D1 file, per-run secret, seeded Alice/Bob + shared Space, uploads
terminating locally with HMAC-signed URLs and enforced `If-None-Match`) →
Metro E2E-bundle check → app-installed check → Maestro flows with per-flow
env → cross-device comparisons (fingerprints, media ids, phrase extraction)
→ unauthorized-identity HTTP checks → matrix + artifacts → cleanup. Any
missing runtime is a nonzero exit, never a pass.

Flows (`e2e/maestro/album-*.yaml`, appId `com.ekasc.aoi`):

- A (`album-a-creation`): Alice signs in (E2E console), first album open
  mints the archive, phrase view + confirm, restart, reopen. Space-row
  creation UI stays covered by `create-space-story.yaml`.
- B (`album-b1/b2/b2b/b3`): Bob requests, Alice sees + fingerprints match
  (runner compares hierarchy dumps; approval is refused on mismatch), Alice
  approves, Bob accepts and enters the archive.
- C (`album-c-media`): Alice uploads the bundled fixture through the real
  sealing pipeline, both devices list + decrypt it (listing requires
  verification + AEAD open), restart keeps it, unknown/bad identities get
  404/401 over HTTP.
- E (`album-e0-show-phrase` + `album-e-recovery`): phrase extracted from the
  real phrase screen, device wiped (fresh id + empty storage), restore from
  the typed phrase, shared photo decrypts. Runs before D.
- D (`album-d-deletion`): signed tombstone, both archives empty, restart
  keeps it deleted.

The app affordances are minimal and fenced: `app/dev-e2e.tsx` (`__DEV__` +
`EXPO_PUBLIC_E2E_MODE`, never linked from UI), `features/e2e/e2e-session.ts`
(identity bootstrap only), the `AOI_E2E_MODE`-gated `/v1/auth/e2e/session`
endpoint (404 in production), and the E2E branch in `app/index.tsx`.
Album crypto, transport, enrollment, SecureStore, and decryption are never
stubbed. The console's media buttons drive `uploadProtocolPhoto` /
`readProtocolArchive` / `removeProtocolPhoto` directly because the archive
gallery has no product UI yet — re-point flows C/D at it when it ships.

First-device calibration checklist (selectors are source-grounded but
unproven on hardware): `aoi://` deep-link format (fallback
`exp://HOST:8081/--/...`), `maestro hierarchy` output shape for the
fingerprint/phrase/media-id regexes, wizard-free Story landing after
"Continue to the app", and second-emulator serials in CI.

## CI

- `.github/workflows/ci.yml`: `test-unit` and `test-integration` run
  independently (plus lint-and-typecheck, build-api, marketing-site).
- `.github/workflows/e2e-android.yml`: debug APK (`expo prebuild` +
  `assembleDebug`) on two API-34 emulators, host backend with
  `AOI_E2E_PUBLIC_BASE_URL=http://10.0.2.2:8787`, Metro E2E bundle,
  `scripts/run-e2e.mjs`, artifact upload (flow logs, matrix, backend +
  Metro logs), per-run data cleanup, nonzero exit on failure.

## Flaky-test policy

The 11 full-suite-load failures stay visible: no deletions, no suppressions,
no silent retries. Suspects under investigation are shared-state leakage
(singleton mocks across files), timeout pressure, and parallel execution —
the integration project already runs serially for this reason. If a test
goes red because the design changed, delete the test, never re-add the UI
to satisfy it (repo rule). Prefer isolation + deterministic synchronization
over raising timeouts.

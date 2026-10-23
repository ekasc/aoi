# Test matrix — three-layer album testing (feature/shared-album-encryption)

Date: 2026-10-09. Branch: `feature/shared-album-encryption` (no remote
configured; commits are local — see SHA below). Base commit `67efab1` does
not exist in this checkout (no git history; worktree was unborn `master`),
so the work starts from the current tree. PR #12 was not touched.

## Results

| Layer | Command | Files | Executed | Passed | Failed | Skipped |
|---|---|---|---|---|---|---|
| Unit | `pnpm test:unit` | 223 | 2324 | 2324 | 0 | 0 |
| Integration | `pnpm test:integration` | 40 | 587 | 587 | 0 | 3 (R2 suite) |
| E2E | `pnpm test:e2e` | 9 flows | 0 | 0 | 0 | NOT RUN (no runtime) |

Environments: unit → happy-dom + node on Linux (this machine); integration →
node + real HTTP (ephemeral localhost) + better-sqlite3 D1 shim + workerd
pool, same machine; E2E → NOT RUN here (no Maestro, no emulator; Mac
installs require explicit approval, so none was installed).

Mocked dependencies per level:

- Unit: RN surface + Expo modules (`tests/setup.ts`), `expo-secure-store`
  (in-memory map), `MockAsyncStorage`, archive boundary in screen tests,
  mocked drizzle app in `unit-api`. No transport test here proves the API.
- Integration: only the Expo token-plumbing module (real Bearer header on
  real fetch); the device-upload PUT leg is simulated via the R2 shim after
  a real reservation (the signed PUT itself is the R2 suite's job).
- E2E: identity bootstrap only (per-run secret → real session row); album
  transport, SecureStore, enrollment, decryption never mocked.

Skipped + prerequisites:

- `tests/integration/r2-conditional-put.test.ts`: 3 skipped without
  `AOI_TEST_R2_ACCOUNT_ID` / `AOI_TEST_R2_ACCESS_KEY_ID` /
  `AOI_TEST_R2_SECRET_ACCESS_KEY` / `AOI_TEST_R2_BUCKET` (disposable bucket).
- E2E native runs: need Maestro + booted emulator(s) + `expo run:android`
  dev build + Metro E2E bundle. `pnpm test:e2e` exits 2 with the exact
  missing piece (verified: `FATAL: Maestro is not installed…`, exit 2).

GitHub Actions: `ci.yml` runs `test-unit` and `test-integration`
independently; `e2e-android.yml` adds the emulator + Maestro pipeline.
Workflows were not executed here (no runners); first CI run calibrates
deep-link format, hierarchy parsing, and APK timing (see TESTING.md).

## Flaky tests

The 11 full-suite-load failures did not reproduce in this environment
(unit 2324/2324, integration 587/587 green). Nothing was deleted,
suppressed, or retried. Structural mitigation landed anyway: the
integration project runs files serially (`fileParallelism: false`,
ephemeral ports, isolated D1 per file), and every test file is pinned to
exactly one Vitest project (263/263 classified, none orphaned). Missing
dependencies found during this work (`@noble/*`, `@scure/*` absent before
`pnpm install`) are recorded as a possible contributor.

## Coverage: implemented vs executed

- Implemented: unit areas 1–7 (36 new tests), boundary integration (21),
  R2 suite (3, skipped here), e2e-auth gate (3), Maestro flows A–E (9
  files), E2E backend + runner + CI.
- Executed: unit 2324, integration 587, R2 skipped (no creds), E2E NOT RUN
  natively; E2E backend proven live (boot → mint → snapshot over HTTP),
  runner proven to fail explicitly, flows validated structurally only.

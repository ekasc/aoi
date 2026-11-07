# Aoi (Expo / React Native) — Agent Instructions

This repo is an Expo SDK 58 + Expo Router app in TypeScript, a Cloudflare Worker API, and a shared contract package.

Documentation is deliberately limited to four files:

- [README.md](README.md) — what the app is, quickstart, stack, deploy.
- [PRODUCT.md](PRODUCT.md) — product behavior, design system, scope, gaps.
- [AGENTS.md](AGENTS.md) — this file: build, code rules, accessibility, security, dev tooling.
- [TESTING.md](TESTING.md) — test layers, commands, coverage, CI.

Do not add new top-level docs. Put durable information in one of these four.

## Build / Run / Lint / Test

### Install

```sh
pnpm install
```

### Dev server

- Start Metro: `pnpm run start` (`scripts/start-dev.mjs` sets the dev Worker defaults).
- Clear the cache when stuck: `npx expo start -c`.

### Run on platforms

- iOS (native build + run): `pnpm run ios`
- Android (native build + run): `pnpm run android`
- Web: `pnpm run web`

### Simulators / native builds — ask first

- Never boot simulators or emulators, run `expo run:*`, `xcodebuild`, `pod install`, or trigger native app builds unless the user explicitly asks. These boot devices and take minutes.
- `npx expo prebuild` and `pod install` alone do not boot anything and are fine when needed for setup.
- If a command accidentally boots a simulator, shut it down (`xcrun simctl shutdown all`).

### Lint

- All: `pnpm run lint`
- One file: `pnpm run lint -- 'app/(app)/(tabs)/(memories)/index.tsx'`

### Typecheck

```sh
pnpm run typecheck
```

TypeScript is strict. Tests are excluded from `tsconfig.json`; typecheck does not see test files.

### Tests

- All unit: `pnpm run test:unit`
- Watch: `pnpm run test:unit:watch`
- All integration: `pnpm run test:integration`
- One file: `npx vitest run tests/path/to/file.test.ts`
- One test name: `npx vitest run -t "renders empty state"`

See [TESTING.md](TESTING.md) for the layer classification and what each suite proves.

### Accessibility audit

- Static contract check across `app/` and `components/`:
  `pnpm run a11y:audit` (`--json` for machines, `--strict` exits 1).
- The same check runs as `tests/unit/components/a11y-audit.test.ts`, so `pnpm run test:unit` fails if a new element breaks the contract.

### Seeded session (real app tree)

Run the real app against the mock world:

```sh
EXPO_PUBLIC_DEV_SEED=full pnpm run start --go
```

The app boots signed in as Maya with June's space and the rich media seeds. No preview route and no navigation bypass: the tab bar and back buttons behave as in production.

Variants: `full` · `empty` · `pending` · `failed` · `setup` (signed in, no space). `features/dev/dev-seed.ts` writes a real session and space through SecureStore/AsyncStorage before the providers hydrate. `__DEV__`- and flag-gated; unset leaves dev and production untouched.

### Visual debugging (dev preview routes)

Authenticated screens are unreachable on web because SecureStore has no web implementation. Use the committed dev preview routes on the normal dev server:

- `/dev-story` — Story/Memories feed (`?variant=empty|pending|failed`)
- `/dev-together` — Us sky (`full|empty|sky-free|sky-today|sky-six-months-ago|sky-relationship-start|sky-with-content|sky-empty`)
- `/dev-plans`, `/dev-calendar`, `/dev-new-event`
- `/dev-ours` — Lists
- `/dev-chapter?id=month:YYYY-MM`
- `/dev-composer`, `/dev-keepsake`, `/dev-response`, `/dev-little-things`
- `/dev-paywall` (`?state=plus`), `/dev-question`, `/dev-setup`, `/dev-space`, `/dev-splash`
- `/dev-foundations` — token and type gallery
- `/dev-notify` — notification triggers for E2E
- `/dev-e2e` — E2E console, gated by `EXPO_PUBLIC_E2E_MODE`

The mock world is Maya & June, signed in, space ready (`features/dev/preview.tsx`): real screens through the real provider tree; the stub data layer swaps seeds. All seed media is remote and catalogued in `features/dev/preview-media.ts`. `__DEV__`-gated; redirects home in production. Never link to `/dev-*` from app UI.

Inspect with agent-browser (Chrome needs `--no-sandbox` here):

```sh
agent-browser --session <name> --args "--no-sandbox" open 'http://127.0.0.1:8081/dev-story'
agent-browser --session <name> snapshot
agent-browser --session <name> screenshot
```

RN lists scroll their own container, not the window. Long-press via pointerdown (buttons:1) + delay + pointerup.

Drive the iOS simulator headlessly: `pnpm run sim-nav <route> --shot <path>` (`(memories)` | `together` | `plans`), then screenshots; `xcrun simctl io booted screenshot <path>`. Never `simctl openurl` a route: the SpringBoard “Open in aoi?” prompt survives relaunches and only a device shutdown clears it.

### Debug on a real phone (Expo Go / dev client)

Agents attach to the running app over Metro's Hermes CDP bridge. With `expo start` running and Expo Go in the foreground, phone unlocked:

- `pnpm run dev:targets` — list connected devices/apps (`--target <index|substring>`).
- `pnpm run dev:logs` — stream `console.log/warn/error` and uncaught exceptions as NDJSON (`--timeout 5000` to sample).
- `pnpm run dev:eval -- "<javascript>"` — evaluate inside the app. Promises are awaited. For multi-line scripts, pipe via `--stdin`.
- `pnpm run dev:screenshot` — capture the screen. The image lands in `.expo/aoi-debug/screenshots/<id>.jpg` with a sibling `.json` accessibility inventory.
- `pnpm run dev:select` — tap-to-select mode; needs `DebugHarness`.
- `pnpm run dev:reload` — reload the app.

`__aoiDebug` (`features/dev/device-automation.ts`) exposes a dev-only control surface:

- `inventory()` — every labelled element with role/testID and whether it is pressable.
- `press(labelOrRegex)` / `pressAndMeasure` / `press(label, { long: true })`.
- `navigate('/plans')`, `measure(name, fn, settleMs)`, `frameStats(ms)`, `sleep`, `screenshot`.
- `phases()` / `resetPhases()` — phase timer roll-up.

Frame stats are the JS thread's `requestAnimationFrame` cadence. Read a long gap as a JS-thread stall, not GPU frame rate. Run benchmarks against the max, not the mean; a dev build is slower than production.

On a physical phone, a floating dev-only copy button copies a text outline of the current screen's live element tree to the clipboard.

### Reporting a device bug

When the user says “X is broken on my phone”:

1. `pnpm run dev:report --note "<short summary>"`, then have the user reproduce during the capture window. Read `.expo/aoi-debug/reports/<ts>/report.md`.
2. Read the screenshot image directly.
3. `pnpm run dev:select`, ask the user to tap the element; use the printed component path, frame, and props.
4. Use `pnpm run dev:logs -- --timeout 8000` and `pnpm run dev:eval` to probe live state.
5. Search the codebase for the component/path.

The app must be foregrounded and the phone unlocked.

### Performance and stress tooling

- `node scripts/perf-audit.mjs` — app navigation/frame audit. Add `--extended` for secondary routes and feed scrolling; `--media` for video lifecycle.
- `node scripts/stress-prodlike.mjs --profile established|heavy` — isolated populated databases and mixed authenticated API reads/writes. `--host <LAN-IP> --device` runs the real app's remote repositories. `--ui-only` skips the API ramp.
- `scripts/stress-assess.mjs` evaluates diagnostic budgets. Functional success alone is not a pass.
- Native stress reports must include `foreground.valid=true`; the runner invalidates timings if the app starts inactive or leaves the foreground.
- Results and databases go under gitignored `.expo/aoi-debug/performance/`.
- The Hermes profile path (`pnpm run dev:profile`) is unavailable on iOS (`Profiler.enable` unsupported). Attribute a stall with differential experiments: one arm per candidate cause, several samples per arm.

### Build

- EAS profiles exist in `eas.json` (`development`, `preview`, `production`). There is no EAS Update or CI-driven store release.
- Web static export: `npx expo export --platform web`.

## Repo map

```
app/                  Expo Router routes
  (public)/           landing
  (auth)/             sign-in, space-setup
  (app)/(tabs)/       (memories), together (Us), plans, ours (Lists)
  (app)/              account, moment, calendar, chapter, collection, album,
                      question, partner, paywall, goal, profile/settings redirects
components/           reusable UI (kebab-case)
features/             state, repositories, API clients, pure logic
constants/            theme, presets, typography
hooks/                shared hooks
packages/api/         Cloudflare Worker + legacy Node app
packages/shared/      shared Zod contracts
tests/                unit and integration
e2e/maestro/          device flows
scripts/              dev, E2E, perf, stress, release checks
```

Key paths:

- Tabs: `app/(app)/(tabs)/_layout.tsx`
- Providers: `app/_layout.tsx` and `app/(app)/_layout.tsx`
- Theme tokens: `constants/theme.ts`, `constants/theme-presets.ts`, `constants/typography.ts`
- API shell: `packages/api/src/worker.ts`, `create-app.ts`
- Contracts: `packages/shared/src/*`

## Provider tree

```
RootLayout
  SessionProvider
    SpaceProvider
      AoiThemeProvider
        SubscriptionProvider
          MomentsProvider
            Stack: (public) | (auth) | (app)

(app)/_layout.tsx adds:
  CalendarProvider
    PartnerDetailsProvider
      CollectionsProvider
        SomedayProvider
          QuestionProvider
            PushProvider
              ResponsesProvider
                ComposerProvider
                  Stack
```

`SubscriptionProvider` sits above `MomentsProvider` because screens read Plus state. Do not move providers without tracing every consumer.

## Code style

### General

- Be conservative with diffs. Do not reformat unrelated code.
- Formatting is split by directory: `app/**` uses tabs + double quotes; `components/`, `features/`, `packages/` use 2 spaces + single quotes. Match the file you edit. Do not reformat a whole file.
- No formatter is configured. If you add one, run it only on touched files.

### Imports

Order in groups with a blank line:

1. platform/external packages
2. absolute internal imports via `@/...`
3. relative imports

Use type-only imports (`import type { Foo }`, `import { Bar, type BarProps }`).

### Naming and files

- Files: kebab-case (`components/haptic-tab.tsx`, `moment-form.tsx`).
- Components: PascalCase. Hooks: `useX`.
- Screens: explicit names (`OursScreen`, `UsScreen`), not `TabTwoScreen`.

### TypeScript

- Keep `strict` happy; avoid `any`.
- Prefer `unknown` for untrusted input and narrow with checks.
- Prefer discriminated unions for state machines and async states.
- Avoid `as` casts unless bridging third-party types; document why.
- Parse external data at boundaries with the shared Zod schemas.

### React / Expo Router

- Route components are default exports in `app/**`.
- Reusable UI lives in `components/`, logic in `features/`.
- Use `@/` imports for cross-folder refactors.
- Use `process.env.EXPO_OS` for platform branching when Expo provides it.
- Keep route params typed; typed routes are enabled. Prefer `Href`-typed paths.
- Use `expo-image` over the legacy React Native `Image`.
- Use `expo-video` for video.

### Styling

- Prefer `StyleSheet.create` for reusable styles; inline styles for one-off values.
- Avoid creating objects/functions inside render for list rows and other hot paths.
- Colors and spacing come from the tokens in `constants/`.
- Prefer themed wrappers (`ThemedText`, `ThemedView`) so light/dark stays consistent.
- For long lists, virtualize and memoize rows; keep props stable.

## Accessibility

Every element must be reachable and understandable by a screen reader. This is enforced statically.

**Contract (checked by `pnpm run a11y:audit`):**

- Every `Pressable` / `Touchable*` has an `accessibilityRole` and an accessible name (`accessibilityLabel` or visible text). `accessible={false}` is the exemption for gesture-only wrappers and decorative layers.
- Every image (`Image`, `expo-image`) is labelled or explicitly decorative. A photo inside an already-labelled press target is decorative.
- Every `TextInput` and `Switch` / `Slider` has an `accessibilityLabel`.
- Every `Modal` contains an element marked `accessibilityViewIsModal`.

**Conventions the audit cannot see:**

- Headings: `ThemedText` sets `accessibilityRole="header"` for `type="display"`, `type="title"`, and `type="subheading"`. Use those for headings; pass an explicit role to opt out.
- Touch targets: at least 44×44 dp. Shared `Button` / `IconButton` meet it; custom chips and rows set `minHeight: 44` or add `hitSlop`.
- State: give controls `accessibilityState` (`selected`, `disabled`, `expanded`, `busy`) and a short hint when the action is not obvious from the label.
- Live updates: announce async status and errors with `accessibilityLiveRegion="polite"` or `accessibilityRole="alert"`.
- Contrast: body text must hold ≥4.5:1 on every surface it can appear on. `tests/unit/theme/after-hours.test.ts` enforces this for `textPrimary` / `textSecondary` / `textMuted` on all surfaces, plus `primaryText` / `onAccent` / `onDanger` on their fills, for every theme and mode. Fix the token in `constants/theme-presets.ts`, never the test.
- Dynamic Type: never set `allowFontScaling={false}` or cap `maxFontSizeMultiplier`.
- Reduced motion: gate animation with `useReducedMotion()`.

When the audit flags something, fix the element rather than the rule. For a genuine false positive, add a narrow exemption in `scripts/a11y-audit.mjs` with a comment explaining why.

## Error handling

- Every user-facing collection or section must name an empty result and retain a next action. Do not rely on a blank list, zero counter, or decorative graphic.
- Keep successful empty reads, loading, failed reads, and filtered no-results distinct. Never seed content to hide an empty state.
- Do not leave `alert(...)` in production flows.
- For async actions, handle loading and error states explicitly. Do not swallow errors silently unless the flow is intentionally tender (see below).
- Surface user-safe messages; log detailed context only in dev.
- Prefer a small shared error shape (`{ code, message }`) and never leak stack traces to the UI.
- **Tender-error policy:** failures in intimate flows (trace save retries, notification scheduling, album upload) are swallowed or gently messaged. They must never crash the screen or show a stack trace.

## Security and privacy

- Never commit secrets. Tokens and keys live in env or `wrangler secret`. `.env`, `.env*.local`, `packages/api/.dev.vars`, and `google-services.json` values stay out of source.
- Treat user media and location as sensitive. Do not log object keys, URLs, coordinates, or content.
- Album photos are encrypted on device before upload. Moment text and media are server-visible. Do not describe the whole product as end-to-end encrypted.
- EXIF is stripped server-side from images; picker calls use `exif: false`. Audio is not EXIF-processed.
- Tokens persist in SecureStore, not plain AsyncStorage.
- Push payloads carry kind-only data and fixed vague copy. Never put moment text, event titles, locations, or coordinates in a push.
- API errors use the canonical `{ error: { code, message } }` envelope with word-only messages.
- The legacy Node app and its Postgres schema remain as migration reference. Do not add new product behavior there.

## Environment and config

- App config lives in `app.json`; local overrides live in `app.config.js`. Do not hand-edit generated `ios/` or `android/`.
- `EXPO_PUBLIC_*` values are inlined at build time. Auth config fails fast when a required value is missing.
- `EXPO_PUBLIC_AUTH_STUB_MODE` must be explicitly `true` or `false`; unset throws at startup.
- When adding an env dependency, fail fast with a clear error if it is required, and document it in README.
- Never read or modify `.env` files in agent sessions; use `.env.example` / `.dev.vars.example` for structure or pass values inline.

## Animations

- Prefer `moti` (`MotiView`, `MotiPressable`, `AnimatePresence`) for declarative animation.
- Raw Reanimated is fine for gesture-driven or scroll-driven animation.
- Animate `transform` and `opacity`; avoid layout thrash.
- Respect reduced motion via `useReducedMotion()` from Reanimated.
- Keep durations in the `Motion` vocabulary; do not hand-type new ones.

## Performance

- Avoid expensive work in render. Memoize list rows and keep props stable.
- Be careful with inline style objects in frequently re-rendered components.
- Heavy native modules load lazily (for example RevenueCat is imported only when the store is read).
- Do not block the JS thread on startup. Album crypto and sky work happen off the render path where possible.
- Measure with the device tooling before attributing a stall; a dev build is slower than production.

## Backend rules

The Cloudflare Worker is the current API:

- `packages/api/src/worker.ts` — fetch / queue / scheduled entry.
- `packages/api/src/create-app.ts` — Hono shell, request id, CORS, error envelope, OpenAPI.
- `packages/api/src/domains/*` — Effect programs per domain.
- `packages/api/src/routes/session-*.ts` — thin transport.
- `packages/api/src/effects/*` — clock, id, D1, config, logger, runtime, test harness.
- `packages/api/src/programs/*` — queue consumer, cron retention/purge.

Rules:

- D1 atomicity belongs to the domain layer: `batch()` for multi-statement writes, `guardedUpdate` for conditional transitions, unique/check constraints for invariants, client-generated ids for idempotency.
- Space-scoped durable entities carry `id`, `space_id`, `version`, `created_at`, `updated_at`, and `deleted_at` where applicable. User-owned tables carry `user_id` instead of `space_id`.
- Media is stored as stable R2 keys and served through membership-gated `/v1/media/:id/object`; never store durable signed URLs.
- Push jobs carry kind-only data. The queue consumer delivers vague copy and prunes dead tokens.
- Rate limits use Worker bindings, not in-memory maps.
- When a wire shape changes, update in this order: shared type → API Zod schema → serializer → client feature types.

## Git hygiene

- Do not commit `node_modules/`, `.expo/`, or generated native folders.
- Keep changes scoped; avoid drive-by formatting.
- Before committing, run `pnpm run lint` and `pnpm run typecheck`.
- Do not commit unless the user asks. Never `git push` without asking first, every time.

## Testing rules

The full test map lives in [TESTING.md](TESTING.md). Two rules matter in every change:

- Test behavior and durable rules, never the presence of UI. A tap navigates, saves, or removes; a failed write keeps the draft and shows the error; an empty result is distinguishable from a failed read. Do not assert that a section or string is on screen.
- When a presence test goes red because you changed the design, delete the test. Do not re-add the UI to make it pass.

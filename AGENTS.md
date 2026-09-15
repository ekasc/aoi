# Aoi (Expo / React Native) — Agent Instructions

This repo is currently an Expo + Expo Router app written in TypeScript.

## Build / Run / Lint / Test

### Install
- `pnpm install`

### Dev server
- Start Metro: `pnpm run start` (alias: `expo start`)
- Start with cache clear (when stuck): `npx expo start -c`

### Run on platforms
- iOS (native build + run): `pnpm run ios` (alias: `expo run:ios`)
- Android (native build + run): `pnpm run android` (alias: `expo run:android`)
- Web: `pnpm run web` (alias: `expo start --web`)

### Simulators / native builds — ask first
- Never boot simulators/emulators, run `expo run:*`, `xcodebuild`, `pod install`, or trigger native app builds unless the user explicitly asks. These boot devices and take minutes.
- `npx expo prebuild` (config-plugin sync) and `pod install` alone do NOT boot anything and are fine to run when needed for setup.
- If a command accidentally boots a simulator, shut it down (`xcrun simctl shutdown all`).

### Lint
- Lint all: `pnpm run lint`
- Lint a single file (forward args to eslint via expo):
  - `pnpm run lint -- app/(tabs)/index.tsx`

### Typecheck
- `pnpm run typecheck`

### Tests
- Run all unit tests: `pnpm run test:unit`
- Watch mode: `pnpm run test:unit:watch`
- Run one file: `npx vitest run tests/path/to/file.test.ts`
- Run one test name: `npx vitest run -t "renders empty state"`

### Accessibility audit
- Static contract check across `app/` and `components/`:
  `pnpm run a11y:audit` (add `--json` for machines, `--strict` to exit 1
  on findings). The same check runs as
  `tests/unit/components/a11y-audit.test.ts`, so `pnpm run test:unit` fails
  if a new element breaks the contract. See "Accessibility" below for the
  rules it enforces and what to do when it flags something.

### Seeded session (real app tree)
- Run the REAL app (tabs, navigation, every screen) against the mock world:
  `EXPO_PUBLIC_DEV_SEED=full pnpm run start --go`. The app boots signed in as
  Maya with June's space and the rich media seeds — no preview route, no
  navigation bypassed, so the tab bar and back buttons behave as in
  production. Variants: `full` · `empty` · `pending` · `failed`.
- How: `features/dev/dev-seed.ts` writes a real session (SecureStore) and
  space (AsyncStorage) before the providers hydrate, so they restore through
  their normal paths; `useDevSeed` in `app/(app)/_layout.tsx` publishes the
  variant so the moments stub swaps its fixtures. `__DEV__`- and flag-gated;
  unset means normal dev and production are untouched.

### Visual debugging (dev preview routes)
- Authenticated screens are unreachable on web (SecureStore has no web
  implementation, so sessions never persist) — use the committed dev
  preview routes on the normal dev server instead of throwaway harnesses:
  - `/dev-story` (Story feed, full mock world) · `?variant=empty` (blank
    slate) · `?variant=pending` (unsent memory pinned) · `?variant=failed`
    (failed send with Retry/Edit/Remove). Single-screen preview: it renders
    the feed directly, so it has no bottom tab bar — use the seeded session
    above when you need real navigation.
  - `/dev-chapter?id=month:YYYY-MM` (chapter detail over stub range data)
  - `/dev-composer` (memory editor layout/structure; keyboard needs a device)
  - `/dev-foundations` (design tokens gallery)
- The mock world is Maya & June, signed in, space ready
  (`features/dev/preview.tsx`): real screens through the real provider tree;
  stub data layer swaps seeds. Saving a text memory runs the real composer
  pipeline against stub storage, so keeps and failed-send retries land in the
  feed. All seed media is remote and catalogued in
  `features/dev/preview-media.ts` (Lorem Picsum photos, Open Speech voice
  notes, test-videos/remotion MP4s) — images, audio, and video from both
  members, nothing bundled. Video renders through
  `components/media/video-player.tsx` (`expo-video`, included in Expo Go; a
  dev build needs a rebuild after the dependency is added). `__DEV__`-gated,
  redirect home in production. Never link to `/dev-*` from app UI.
- Inspect with agent-browser (Chrome needs `--no-sandbox` here):
  `agent-browser --session <name> --args "--no-sandbox" open
  'http://127.0.0.1:8081/dev-story'`, then `snapshot`, `eval`, `screenshot`.
  RN lists scroll their own container, not the window; long-press via
  pointerdown (buttons:1) + delay + pointerup.
- Debug on a real phone (Expo Go / dev client): agents attach to the running
  app over Metro's Hermes CDP bridge — no simulator needed. With `expo start`
  running and Expo Go in the foreground, phone unlocked:
  - `pnpm run dev:targets` — list connected devices/apps
    (`--target <index|substring>` to disambiguate).
  - `pnpm run dev:logs` — stream `console.log/warn/error` + uncaught
    exceptions as NDJSON (runs until Ctrl-C; `--timeout 5000` to sample).
  - `pnpm run dev:eval -- "<javascript>"` — evaluate inside the app (inspect
    state, read context, poke functions; promises are awaited).
  - `pnpm run dev:screenshot` — capture the phone screen. The image lands in
    `.expo/aoi-debug/screenshots/<id>.jpg` (read it directly to see the UI) with
    a sibling `<id>.json` holding the **accessibility inventory**: every
    labelled/actionable element with role, label, hint, state, testID, and
    visible text, in render order. Read the image and the JSON together.
  - `pnpm run dev:select` — puts the app in tap-to-select mode. Ask the user
    to tap an element, then the command resolves with its component path,
    frame, readable props, and a screenshot. Needs `DebugHarness`
    (`components/dev/debug-harness.tsx`, `__DEV__`-gated in `app/_layout.tsx`).
  - `pnpm run dev:reload` — reload the app.
  - On the phone, a floating dev-only copy button (bottom-left) copies a text
    outline of the current screen's live element tree to the clipboard
    (`features/dev/element-tree.ts`, walked from the fiber tree). Use this
    when the agent can't attach — the user just pastes the outline into chat.
  If the app is backgrounded/locked the device stays registered but stops
  answering; `dev-agent` says so instead of hanging. Implementation:
  `scripts/dev-agent.mjs` (websocket CDP client, Origin pinned to
  `127.0.0.1` because Metro's inspector proxy 401s other origins). The
  capture sink is middleware in `metro.config.js` (`/__aoi_debug/*`), writing
  to the gitignored `.expo/aoi-debug/`; screenshots use `react-native-view-shot`
  and element picking uses RN's private element inspector, both available in
  Expo Go. Element picking depends on the React DevTools hook, so it degrades
  to coordinates-only if the hook is absent — worth re-checking on a device.
- Reporting and fixing a device bug (when the user says "X is broken on my
  phone"): the user performs the gesture on the device; the agent captures.
  The loop:
  1. `pnpm run dev:report --note "<short bug summary>"` — then have the user
     reproduce the bug during the capture window. Read
     `.expo/aoi-debug/reports/<ts>/report.md`: it contains `screenshot.jpg`,
      the warnings/errors, and the full console window.
  2. Read the screenshot image directly to see what the user sees.
  3. `pnpm run dev:select` — ask the user to tap the element of interest; the
     printed JSON gives its component path, frame, and readable props. Use
     `pnpm run dev:logs -- --timeout 8000` for a longer live trace while the
     user navigates, and `pnpm run dev:eval -- "<js>"` to probe live state.
  4. Then search the codebase for the component/path from the report.
  App must be foregrounded and the phone unlocked for any of these to answer.
- Expected preview artifacts (not bugs): Plus-gated export shows the status
  error (needs a backend session, unreachable headless). Seed media is remote,
  so unit tests assert HTTPS URLs directly (no injected asset URIs).
- Adding a screen: copy `app/dev-story.tsx` (gate + `useApplyPreviewVariant`
  + the providers its tree needs + `DevErrorBoundary`), add seeds to
  `getPreviewSeedMoments` if the stub moments should cover it.

### Build
- EAS config exists (`eas.json`) with development/preview/production profiles; no EAS Update or CI-driven builds yet.
- For web-only static output, Expo supports exports; if/when needed:
  - `npx expo export --platform web`

## Repo Facts (from codebase)
- Expo Router routes live in `app/` with `_layout.tsx` and route groups like `app/(tabs)/...`.
- TypeScript is `strict` with a path alias `@/* -> ./*` (see `tsconfig.json`).
- Expo config enables `experiments.typedRoutes` and `experiments.reactCompiler` (see `app.json`).
- Native folders `ios/` and `android/` exist locally but are gitignored; treat as generated.

### Key paths
- Routes/screens: `app/**` (Expo Router)
- Reusable UI: `components/**`
- Hooks: `hooks/**`
- Theme/tokens: `constants/theme.ts`
- Assets: `assets/**`

### Generated / local-only
- `ios/` and `android/` are generated by `expo run:*` / prebuild; avoid hand-editing unless you are intentionally doing native work.
- `expo-env.d.ts` exists locally but is currently gitignored (see `.gitignore`). If you need to change it, confirm whether it should be committed first.

## Code Style Guidelines

### General
- Be conservative with diffs: do not reformat unrelated code.
- Formatting is currently mixed (tabs/double-quotes in `app/_layout.tsx`, 2-spaces/single-quotes elsewhere).
  - For edits: match the existing file's style.
  - For new files: prefer 2-space indent + single quotes.
- No formatter is configured (no Prettier/Biome). If you add one, run it only on touched files.

### Imports
- Order imports in groups with a blank line between groups:
  1) platform/external packages
  2) absolute internal imports via `@/…`
  3) relative imports
- Use type-only imports when possible:
  - `import type { Foo } from '...'`
  - `import { Bar, type BarProps } from '...'`

### Naming + files
- File names: use kebab-case (matches `components/haptic-tab.tsx`, `parallax-scroll-view.tsx`).
- Components: PascalCase; hooks: `useX`.
- Prefer explicit names for screens: `HomeScreen`, `ExploreScreen` (avoid `TabTwoScreen`).

### TypeScript
- Keep `strict` happy; avoid `any`.
- Prefer `unknown` for untrusted input and narrow with checks.
- Prefer discriminated unions for state machines and async states.
- Avoid `as` casts unless bridging third-party types; document why when necessary.

### React / Expo Router conventions
- Keep route components as default exports in `app/**`.
- Put reusable UI in `components/` (not in `app/`).
- Use `@/` imports for cross-folder refactors.
- Prefer `process.env.EXPO_OS` for platform branching when Expo provides it (already used in `components/external-link.tsx`).
- Keep route params typed (typed routes are enabled). Avoid `string`ly-typed path building when `Href` types can help.
- Prefer `expo-image` for images (already in use) over the legacy `Image` from `react-native` when possible.

### Styling
- Prefer `StyleSheet.create` for reusable styles; inline styles are acceptable for one-off values.
- Avoid creating new objects/functions inside render for list rows and other hot paths.
- Keep colors/tokens centralized (currently `constants/theme.ts` + themed components).
- Prefer themed wrappers (`ThemedText`, `ThemedView`) for app UI so light/dark behavior stays consistent.
- For lists, prefer virtualization; if/when lists become large, consider FlashList and memoized row components.

### Accessibility
Every element in the app must be reachable and understandable by a screen
reader. This is enforced statically — do not treat it as optional polish.

**The contract (what `pnpm run a11y:audit` checks):**
- Every `Pressable` / `Touchable*` has an `accessibilityRole` and an
  accessible name (`accessibilityLabel` or visible text). An element that is
  intentionally hidden from the tree with `accessible={false}` is exempt —
  that is how gesture-only wrappers and decorative layers are expressed.
- Every image (`Image`, `expo-image`) is either labelled
  (`accessibilityLabel`) or explicitly decorative (`accessible={false}`).
  A photo inside an already-labelled press target is decorative: mark it
  `accessible={false}` so it is not announced twice.
- Every `TextInput` and `Switch` / `Slider` has an `accessibilityLabel`.
- Every `Modal` contains an element marked `accessibilityViewIsModal` so
  VoiceOver cannot wander into the screen behind it.

**Conventions the audit cannot see — follow them by hand:**
- Headings: `ThemedText` sets `accessibilityRole="header"` automatically for
  `type="display"`, `type="title"`, and `type="subheading"`. Use those types
  for headings; pass an explicit `accessibilityRole` to opt out.
- Touch targets: 44x44dp minimum. The shared `Button` / `IconButton` meet it;
  custom chips and rows must set `minHeight: 44` (or add `hitSlop`).
- State: give controls `accessibilityState` (`selected`, `disabled`,
  `expanded`, `busy`) and a short `accessibilityHint` when the action is not
  obvious from the label.
- Live updates: announce async status and errors with
  `accessibilityLiveRegion="polite"` or `accessibilityRole="alert"`.
- Contrast: body text must hold ≥4.5:1 on every surface it can appear on.
  A test enforces this for `textPrimary` / `textSecondary` / `textMuted` on
  all surfaces, plus `primaryText`/`onAccent`/`onDanger` on their fills, for
  every theme and mode (`tests/unit/theme/after-hours.test.ts`). Fix the
  token in `constants/theme-presets.ts`, never the test.
- Dynamic Type: never set `allowFontScaling={false}` or cap
  `maxFontSizeMultiplier`; let text reflow.
- Reduced motion: gate animation with `useReducedMotion()`.

When the audit flags something, fix the element rather than the rule. If a
finding is a genuine false positive, extend `scripts/a11y-audit.mjs` with a
narrow exemption and a comment explaining why.

### Error handling
- Don't leave `alert(...)` in production flows (starter templates use it in examples).
- For async actions, handle loading + error states explicitly (don't swallow errors).
- When adding API calls, surface user-safe messages and log detailed context only in dev.
- Prefer a small shared error shape for API failures (e.g. `{ code, message }`) and avoid leaking stack traces to UI.

### Security / privacy (project goals)
- Never commit secrets; keep tokens/keys in env and ensure `.env*.local` stays untracked.
- Treat user media + location as sensitive:
  - Don't log object keys, URLs, or location coordinates.
  - If you add uploads later, ensure EXIF/location metadata is stripped unless explicitly opted-in.
- Avoid persisting sensitive tokens in plain AsyncStorage; prefer platform-secure storage (e.g. `expo-secure-store`) when you implement auth.

### Git hygiene
- Do not commit `node_modules/`, `.expo/`, or generated native folders.
- Keep changes scoped; avoid drive-by formatting.
- Before committing, run: `pnpm run lint` and `pnpm run typecheck`.

### Environment & configuration
- App config lives in `app.json`; prefer `expo.extra` for non-secret runtime config.
- Never commit secrets; prefer EAS/CI secrets or local `.env*.local` files (already gitignored).
- When adding env access in code, fail fast with clear errors if required values are missing.

### Animations
- Prefer `moti` (from `moti` package) over raw Reanimated for declarative animations — `Moti.View`, `MotiPressable`, `AnimatePresence`.
- Raw Reanimated (`useSharedValue`, `useAnimatedStyle`, `withTiming`) is fine for continuous gesture-driven or scroll-driven animations where Moti doesn't fit.
- Respect reduced motion via `useReducedMotion()` from Reanimated.

### Performance (mobile)
- Avoid expensive work in render; memoize list rows and keep props stable.
- Prefer animating `transform`/`opacity` with Reanimated; avoid layout thrash.
- Be careful with inline style objects in frequently re-rendered components.

## Cursor / Copilot rules
- No Cursor rules found (`.cursor/rules/` or `.cursorrules`).
- No Copilot instructions found (`.github/copilot-instructions.md`).

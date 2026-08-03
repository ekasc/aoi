# Aoi — Context for Agents

> Read this before touching any code. For build/test/lint commands and code
> style rules, see `AGENTS.md`. For product scope history, see `PLAN.md` and
> `aoi-prd-engineering.md` (both partially stale — this file wins on
> conflicts).

---

## 1. What Aoi is

Aoi is a **private relationship app for exactly two people**. It is a shared
space for moments (memories), calendar planning, and small intimacies —
deliberately calm: no feeds, no streaks, no badges, no AI, no public sharing.

**Product principles** (enforced in design reviews):

- Private by default, joyful in expression
- Moments deserve ceremony — capture feels like journaling, not forms
- Two people, not one — authorship is always visible (`you` vs `partner`,
  colored `accent` vs `partnerAccent`)
- Calm over engagement — nothing demands attention; surprises over streaks
- Native-first — platform affordances (iOS sheets, glass, SF-style icons,
  haptics)

**Intimacy direction** (current north star): the app should become the place
that pops into your head when you think of your partner. That drives four
loops: capture in the moment (**Traces**), memories surfacing back
(**Resurface**), sensory artifacts (**voice traces**), and wordless presence
(**Squeeze**). See glossary below.

---

## 2. Repo layout

```
app/                  Expo Router routes (route groups below)
  (public)/           Landing
  (auth)/             sign-in, space-setup, space-import, theme-select, verify-code
  (app)/(tabs)/       index (timeline), calendar, profile, settings
  (app)/moment/       new.tsx (full form), trace.tsx (5-second capture)
  (app)/calendar/     new-event.tsx, edit/[id].tsx
  (app)/profile/      edit-relationship, import-milestones, little-things
components/           Reusable UI (kebab-case files)
  ui/                 Primitives: button, icon-button, surface, divider,
                      glass-surface, android-glass-surface
  moments/            moment-card, resurface-card
  media/              media-picker, upload-progress, voice-recorder, audio-player
  squeeze/            squeeze-overlay
features/             Feature modules (state, repos, API clients — NOT React-router stuff)
  api-client.ts       Authenticated fetch + token refresh/retry
  auth/               AuthApi interface, remote (WorkOS) + mock impls, config
  session/            SessionProvider (SecureStore persistence)
  space/              Space context + local/remote repositories, invite codes
  moments/            Moments context, resurface engine, notification hook
  calendar/           Calendar context + local (SQLite) / remote repositories
  theme/              Theme context (beach-inspired presets, light + dark)
  media/              useMediaUpload (presigned R2 flow)
  partner-details/    "The little things" (device-local for now)
  squeeze/            Wordless signal (stub-simulated delivery)
hooks/                use-theme-color, use-color-scheme, use-aoi-fonts
constants/            theme.ts (Spacing/Radii/Motion), theme-presets.ts, typography.ts
packages/api/         Hono + Drizzle + Postgres backend (own package.json, vitest, tsconfig)
packages/shared/      @aoi/shared — API contract types (moment, calendar, space, auth, api)
tests/unit/           Frontend vitest tests (RN mocked to DOM — see tests/setup.ts)
e2e/maestro/          auth-stub-smoke.yaml
patches/              pnpm patches: expo-router (ctx ignore), @expo/metro-runtime (exports)
```

pnpm workspace: root app + `packages/*`. The app consumes `@aoi/shared` via
`workspace:*`.

---

## 3. Domain glossary

### Moment
A timestamped relationship artifact. Types: `note | milestone | date | goal |
media | trace`. Has title (may be empty for traces), body, authorRole
(`you`/`partner`), optional `mediaPreview` (image URL) and `audioUri` (voice
trace URL). Shown on the timeline rail.

### Trace ⚡ (new)
A zero-decision capture: text, photo, and/or ≤30s voice — no type picker, no
title. Stored as a moment with `type: 'trace'`. Entry point: flash button in
timeline hero → `app/(app)/moment/trace.tsx`. Design intent: capture must
happen *in the instant* you think of your partner.

### Resurface ("On this day")
Moments whose month/day matches today and are ≥1 year old. Computed by pure
fn `features/moments/resurface.ts` → `findResurfaces(moments, now)` (max 3,
closest year first). Rendered as `ResurfaceCard` atop the timeline; also
schedules **one local notification per day** (9:30 or 14:30, silent, quoted
excerpt) via `use-resurface-notification.ts`. No sound ever.

### Voice trace
Audio recorded with expo-audio (`VoiceRecorder`, 30s cap, HIGH_QUALITY preset
→ m4a), played via `AudioPlayer` inside any MomentCard with `audioUri`.
Uploads through the same presigned media pipeline (audio MIME types allowed;
EXIF stripping skips non-images).

### Squeeze ❤ (new)
A wordless "thinking of you" signal. Send: heart button in timeline hero →
haptic + `POST /v1/squeezes` (remote) or simulated delivery (stub). Receive:
full-screen partner-accent pulse overlay (`SqueezeOverlay`) + success haptic.
**Delivery is stub-simulated** (partner replies ~4s after you send) until
push notifications exist. The receive path is fully built and real.

### Partner details / "The little things"
Small concrete facts about the partner (coffee order, their song, the way
they laugh). Categories: `favorite | habit | quirk | words | other`. Screen:
`app/(app)/profile/little-things.tsx`. **Device-local** (AsyncStorage) — no
API surface yet.

### Calendar Event
Scheduling block with start/end, actor (`you`/`partner`), label preset.
Separate entity from Moment (see promotion rules in earlier docs; promotion
UI not built). Stored locally in expo-sqlite (stub) or remote.

### Space
Container for exactly two members (`you`/`partner` roles, no hierarchy).
Joined via invite code. Holds relationship metadata, theme, milestones.

### Encryption tiers (PLANNED — not implemented)
Platform Backup / Client-Only / Recovery Phrase key storage models for E2E
encryption. Documented design only; no content encryption exists in code yet.
If you build features storing sensitive content, assume encryption is a
future requirement.

### Space lifecycle (design intent, partially unimplemented)
Archive = read-only + encrypted content locked. Deletion = hard-delete of the
deleter's authored content only. See `CONTEXT` history / PRD for details.

---

## 4. App architecture

### Stub vs remote mode — the central switch

`features/auth/auth-config.ts` reads `EXPO_PUBLIC_AUTH_STUB_MODE`:

- **Must be explicitly set** (`"true"` or `"false"`) — the app throws at
  startup if unset (fail-fast policy).
- `true` → mock auth, local moments/calendar/space data, no network.
- `false` → requires `EXPO_PUBLIC_AUTH_API_BASE_URL`; real API via
  `features/api-client.ts`.

Every feature context (`useMoments`, `useCalendar`, auth) branches on
`isStubMode()` with a local and a remote implementation. **When adding
features that touch data, implement both paths or explicitly note the gap.**

### Provider tree

```
RootLayout (app/_layout.tsx)
  SessionProvider            → SecureStore-backed session restore
    SpaceProvider            → space load/join/create
      AoiThemeProvider       → presets + light/dark
        MomentsProvider      → timeline data (stub or remote)
          Stack: (public) | (auth) | (app)

(app)/_layout.tsx adds, when authenticated:
  CalendarProvider
    PartnerDetailsProvider
      SqueezeProvider        (+ <SqueezeOverlay/> mounted here)
```

Navigation redirects: signed out → `(public)`; no space → `(auth)/space-setup`;
no theme selection → `(auth)/theme-select`.

### Auth flow (remote)

WorkOS-only: `workosAuthorize` (build URL) → `workosCallback` (web code) or
`workosAppleNative` (idToken + nonce). Server issues JWT access (15m, HS256)
+ JWT refresh (30d, `jti` = session id). `apiFetch` auto-refreshes on 401 and
retries once. Tokens persist in SecureStore (`aoi.session.v1`).

**Server-side session security** (packages/api): refresh tokens rotate every
use; the issued JWT's hash is stored per session and compared on refresh —
mismatch or reuse of a revoked session revokes ALL user sessions (theft
detection). Don't "simplify" this without understanding it.

---

## 5. Backend API (packages/api)

Hono app (`src/app.ts`). Global: CORS (`CORS_ORIGIN` env), auth middleware
on `/v1/*`, per-user rate limit 100/min (in-memory Map — single instance
only). Errors use `ApiError { error: { code, message } }` from @aoi/shared.

| Route | Notes |
|---|---|
| `/v1/auth/workos/{authorize,callback,apple}` | rate limited 10/min |
| `/v1/auth/{session,refresh,logout,account}` | refresh rotates + theft detection |
| `/v1/spaces/...` | create, join by invite, current, update |
| `/v1/spaces/current/moments` | keyset pagination (cursor = occurredAt), create incl. `type:'trace'`, `audioUri` |
| `/v1/moments/:id` | PATCH/DELETE (own only, soft-delete) |
| `/v1/spaces/current/calendar`, `/v1/calendar-events/:id` | range query, CRUD |
| `/v1/spaces/current/milestones`, preferences | list/append, theme prefs |
| `/v1/media/upload-url`, `/v1/media/:id/complete`, `/download-url` | presigned R2; images + audio; EXIF stripped server-side via sharp (images only) |
| `/v1/squeezes` | **NOT IMPLEMENTED** — client calls it in remote mode; add it when building push |

DB: Postgres + Drizzle (`src/db/schema.ts`), migrations in `drizzle/`.
Latest: `0002_*` adds moments.type `'trace'` + `audio_uri`. Run
`pnpm --filter @aoi/api run db:migrate` after schema changes. JWT via
`jose`, token hashing in `src/lib/crypto.ts`.

**Type contract rule:** shared request/response types live in
`packages/shared/src/*`. API zod schemas and frontend types must mirror
them. When changing an API shape, update: shared type → zod schema →
row-to-API serializer (`src/lib/db.ts`) → frontend feature types.

---

## 6. Design system

- Colors come exclusively from theme presets (`constants/theme-presets.ts`):
  `background, surface, surface2, border, text, muted, accent, onAccent,
  partnerAccent, thread, warning, danger, onDanger`. Always via
  `useThemeColor({}, 'name')` — never hardcode hex in components (white
  on-accent text is a tolerated exception).
- Spacing: `Spacing[0|4|8|12|16|24|32|40|56]` only — other values are
  typecheck errors. Radii and Motion durations in `constants/theme.ts`.
- Typography: `constants/typography.ts` — display serif (personality marker),
  body, mono meta. ThemedText types: `display | title | body | caption | meta
  | link`.
- Primitives: `Surface` (variants `page|card|raised|glass`), `Button`
  (variants primary/secondary/ghost/destructive; **no `style` prop** — wrap
  in a View), `IconButton` (variants accent/secondary/ghost/accentSecondary),
  `Divider` (style/inset only, no color prop), `ThemedText`, `ThemedView`.
- Animations: Reanimated entering animations with `ReduceMotion.System`;
  `moti` is available but current screens use raw Reanimated — match the file
  you're editing.
- Haptics: `expo-haptics` for physical feedback (squeeze, recording states).

---

## 7. Conventions that matter

- **Formatting is split by directory**: `app/**` uses tabs + double quotes;
  `components/`, `features/`, `packages/` use 2-space + single quotes.
  Match the file you're editing. (Both exist; do not reformat.)
- Kebab-case filenames; PascalCase components; `useX` hooks.
- Type-only imports; no `any` (one tolerated legacy); strict TS.
- Routes are default exports; reusable UI lives in `components/`, logic in
  `features/`. Typed routes are enabled — use `Href`-typed paths.
- **Env vars must fail fast**: never default silently. `auth-config.ts` is
  the model.
- Secrets: never in git. `.env` and `.env*.local` are gitignored;
  `packages/api/.env` was untracked on purpose (2026-08) — keep it that way.
  Templates live in `.env.example` files.
- Media privacy: picker calls use `exif: false`; server strips EXIF from
  images via sharp. Never log media URLs, keys, or location.
- Notifications are always silent (`shouldPlaySound: false`) and at most one
  per day per category. Memories must never become noise.
- Tender-error policy: failures in intimate flows (squeeze send, trace save
  retries, notification scheduling) are swallowed or gently messaged — never
  alert()/stack traces.

---

## 8. Testing

- Root: `pnpm run test:unit` (vitest, happy-dom). RN is mocked to DOM
  elements in `tests/setup.ts`; `expo-audio`, `expo-notifications`,
  `expo-haptics`, `@expo/vector-icons`, expo-sqlite, etc. are mocked there —
  **add new native-module mocks there** when importing new Expo modules in
  tested component trees. Vitest env sets `EXPO_PUBLIC_AUTH_STUB_MODE=true`
  (config-level `env` — not `test.env`, removed in Vitest 4).
- API: `packages/api` has its own vitest config (`src/**/*.test.ts`) — route
  tests use in-memory DB helpers (`__tests__/helpers`).
- `tests/` is excluded from tsconfig — **typecheck does not see test files**.
  Run tests after API/feature renames.
- E2E: Maestro stub smoke test (`e2e/maestro/auth-stub-smoke.yaml`).

---

## 9. Environment variables

App (`.env`, `EXPO_PUBLIC_*` are inlined at build):

| Var | Required | Notes |
|---|---|---|
| `EXPO_PUBLIC_AUTH_STUB_MODE` | **yes** | `true`=mock auth, `false`=real API; unset = crash |
| `EXPO_PUBLIC_AUTH_API_BASE_URL` | when stub=false | API origin |
| `EXPO_PUBLIC_GOOGLE_IOS_CLIENT_ID` | optional | OAuth |
| `EXPO_PUBLIC_GOOGLE_ANDROID_CLIENT_ID` | optional | currently empty in local `.env` |

API (`packages/api/.env`): `DATABASE_URL`, `JWT_SECRET`, `PORT`,
`CORS_ORIGIN`, `WORKOS_API_KEY`, `WORKOS_CLIENT_ID`, and `R2_*` vars for
media (`R2_ACCOUNT_ID`, `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`,
`R2_BUCKET`). Local Postgres 17 (`aoi` db).

---

## 10. Current state & known seams (as of 2026-08)

**Working end-to-end (stub):** auth screens, space onboarding, timeline with
traces + resurface + goals lane, calendar CRUD, profile, settings, the little
things, squeeze loop (simulated reply), voice traces (local), media picking.

**Working (remote):** auth (WorkOS), moments, calendar, spaces, preferences,
media upload pipeline — against packages/api.

**Known gaps / seams:**

- Push notifications: none. Squeeze delivery + true resurface delivery need
  expo-notifications push + `/v1/squeezes` endpoint + token registration.
- Partner details are device-local — no API table yet.
- E2E encryption tiers: designed, not built.
- No deployment target for the API (no Dockerfile/hosting config). CI exists
  (`.github/workflows/ci.yml`: lint, typecheck, tests, API build). `eas.json`
  exists (dev/preview/production) but no EAS Update/CD.
- Calendar event ⇄ moment promotion: designed, not built.
- Rate limiting is in-memory and keys on proxy headers — fine behind
  Cloudflare (`cf-connecting-ip`), not horizontally scalable.

**Recent infra fixes (don't regress):** watchman must only watch the project
dir (never `~/`); always run expo via project-local CLI (`pnpm run start`),
never global/`pnpm dlx` expo; `expo-env.d.ts` must contain the
`expo/types` reference; `packages/api/.env` is gitignored and untracked.

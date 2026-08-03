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
  (app)/someday.tsx   the shared Someday list
  (app)/memory-wall.tsx  the memory wall (photo + voice album)
  (app)/question.tsx  "one question this week" ritual
  (app)/location.tsx  location consent + sharing controls (default OFF)
  (app)/partner-map.tsx  single-pin partner map (no trails, no history)
components/           Reusable UI (kebab-case files)
  ui/                 Primitives: button, icon-button, surface, divider,
                      glass-surface, android-glass-surface
  moments/            moment-card, resurface-card
  media/              media-picker, upload-progress, voice-recorder, audio-player
  squeeze/            squeeze-overlay
  location/           partner-map (single pin), location-request-prompt
features/             Feature modules (state, repos, API clients — NOT React-router stuff)
  api-client.ts       Authenticated fetch + token refresh/retry
  auth/               AuthApi interface, remote (WorkOS) + mock impls, config
  session/            SessionProvider (SecureStore persistence)
  space/              Space context + local/remote repositories, invite codes
  moments/            Moments context, resurface engine, notification hook
  calendar/           Calendar context + local (SQLite) / remote repositories,
                      event-reminders.ts (pure builders) + use-event-reminders.ts
                      (silent local-notification scheduling hook)
  theme/              Theme context (beach-inspired presets, light + dark)
  media/              useMediaUpload (presigned R2 flow)
  partner-details/    "The little things" (device-local for now)
  someday/            Someday list context + local (AsyncStorage) / remote
                      repositories, shared ordering (someday-order.ts)
  question/           "One question this week" context + local (AsyncStorage) /
                      remote repositories, ISO-week mapping (question-of-the-week.ts)
  time-together/      Pure derivations (days together, moments kept) for the
                      quiet profile line — no state, no storage
  squeeze/            Wordless signal (real push in remote, simulated in stub)
  push/               Push backbone: token registration (register-push-token,
                      push-api) + PushProvider receive routing (push-context)
  location/           Bounded location sharing: context, stub (local-location-
                      repository) + remote repos, pure rules (location-state),
                      approval state machine (approval), background-task
                      (Live-mode-only OS task; registered in app/_layout.tsx)
hooks/                use-theme-color, use-color-scheme, use-aoi-fonts
constants/            theme.ts (Spacing/Radii/Motion), theme-presets.ts, typography.ts
packages/api/         Hono + Drizzle + Postgres backend (own package.json, vitest, tsconfig)
packages/shared/      @aoi/shared — API contract types (moment, calendar, space, auth, api,
                      question incl. ISO-week helpers + the 20-question bank,
                      push kinds, location sharing incl. shared freshness rules)
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
trace URL). Shown on the timeline rail. Full CRUD: long-press your own moment
→ action sheet (Edit / Delete). Edit screen `app/(app)/moment/edit/[id].tsx`
shares `MomentForm` (`components/moments/moment-form.tsx`) with the new-moment
screen. Cards show a quiet "Edited" meta tag when `updatedAt > createdAt`
(+1s tolerance). Delete is a soft-delete behind a confirmation sheet.

### Space activity / Tombstone
Generic per-space change log (`space_activity` table): kind
(`moment_deleted | moment_edited`), actor, occurredAt — **never content**
(privacy: fact + who only). Rows are written in the same transaction as the
moment change. `GET /v1/spaces/current/activity` returns at most the last
7 days (capped 50, newest first). The timeline merges `moment_deleted` items
into the rail as **tombstones** — a muted, non-interactive marker "{Name}
removed a moment", shown for 7 days, so deletions are honest without drama.
Remote mode re-fetches moments + activity on app focus (AppState listener,
no polling); stub mode synthesizes tombstones from local deletes.

### Trace ⚡ (new)
A zero-decision capture: text, photo, and/or ≤30s voice — no type picker, no
title. Stored as a moment with `type: 'trace'`. Entry point: the single "+"
compose button in the timeline hero opens a sheet (*Trace* / *Moment*); Trace
→ `app/(app)/moment/trace.tsx`. Design intent: capture must happen *in the
instant* you think of your partner.

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
A wordless "thinking of you" signal. Send: quiet heart button beside the
partner's name on the profile tab (moved here from the timeline hero in the
"Calm the UI" pass) → haptic + `POST /v1/squeezes` (remote) or simulated
delivery (stub). Receive: full-screen partner-accent pulse overlay
(`SqueezeOverlay`) + success haptic.
**Delivery is real push in remote mode**: the API pushes to the partner's
device and `PushProvider` lights up the overlay via `useSqueeze().receiveSqueeze`.
The route is fire-and-forget and stores nothing (a squeeze leaves no
record; an offline partner simply misses it). Stub mode keeps the simulated
reply loop (~4s) for offline dev.

### Push notifications
The delivery backbone. Devices register Expo tokens once per session
(`POST /v1/push/tokens`, upsert; token re-registered by another user is
reassigned — tokens are device-scoped; `DELETE` on sign-out, no existence
leaks). `sendPushToUser` batches to the Expo endpoint (injectable via
`EXPO_PUSH_ENDPOINT`/`setPushEndpoint`), removes tokens whose tickets report
`DeviceNotRegistered`/`InvalidPushToken`, and swallows ALL failures — push
must never break a request. `notifyPartnerInSpace(spaceId, fromUserId, kind, data, fromName?)`
is the reusable hook for partner-facing features. Payloads carry
`data.kind` + fixed vague copy only — NEVER moment text, locations, or any
content (location pushes may carry the sender's display name in the copy —
never coordinates).
Kinds: `squeeze | moment_added | moment_edited | moment_deleted |
location_request | location_granted | location_stopped`. Client
receive routing lives in `features/push/push-context.tsx`; the foreground
handler (banner visible, never sound) is set globally in `app/_layout.tsx`.

### Location sharing ("they'll be home soon", never tracking)
Optional, consensual, BOUNDED sharing — default OFF. **Both partners must
explicitly opt in before anything flows** (consent stored as
`space_members.location_consent_at`; revoking deletes any live row); either
can pause/stop in ONE tap, no confirmation dialogs, no guilt copy. Three
modes: `live` (the ONLY mode using background location), `until_arrive`
(foreground watch that auto-stops inside the destination geofence), and
`on_request_granted` (partner asks → gentle approval prompt
(`LocationRequestPrompt`) → ONE-time share, consumed on first read, 5-minute
window). The server keeps ONLY the single latest position per user
(`location_shares`, `userId` unique, upsert-on-report, purged on
stop/expiry/revoke — no history, no trails), and coordinates NEVER appear in
logs or error strings (word-only validation messages; payloads carry kind +
names only). GET serves the partner's row only under both-consent + freshness
(15 min live/until_arrive, 5 min grant); everything else is a calm
`{ location: null }` — no existence leaks. Request route is rate-limited
3/min and mutuality-gated. Entry point: ONE quiet row on the profile tab →
`app/(app)/location.tsx`; partner view is `app/(app)/partner-map.tsx`
(single pin, no trails). Archived/locked spaces: hard-off. Stub mode
simulates the partner (consents ~2.5 s after you opt in, grants a fixed
place ~3 s after a request) via `features/location/local-location-repository.ts`
— plainly documented as simulated, never touches GPS or network. Tender-error
policy applies throughout: a location that fails to send is silently absorbed.

### Partner details / "The little things"
Small concrete facts about the partner (coffee order, their song, the way
they laugh). Categories: `favorite | habit | quirk | words | other`. Screen:
`app/(app)/profile/little-things.tsx`. **Device-local** (AsyncStorage) — no
API surface yet.

### Someday list
The couple's shared wish list: places to go, restaurants to try, films to
watch. Items have a title, optional note, and category
(`place | food | film | other`). Check-off is **soft and shared**: EITHER
partner can check off an item (sets `checkedAt` + `checkedByUserId`), and
undo clears them — no hard deletes, no DELETE route. Canonical order (API
and both repos): open items first (newest first), then checked items (most
recently checked first). Screen `app/(app)/someday.tsx`, entered from a
button on the profile tab; sections "Someday" and "Done together" (shows who
checked + when). Stub mode is AsyncStorage-local; remote mode uses
`GET/POST /v1/spaces/current/someday` + `PATCH /v1/someday/:id` and
re-fetches on app focus so partner changes appear. Stub storage is keyed
`aoi.someday.v1.{userId}` (per-user, single-author) — an accepted divergence
from remote's shared-per-space list since stub mode implies one device.

### Time together
A quiet remembrance line on the profile tab: "N days together" plus
"M moments kept" (only when >0). Pure derivations in
`features/time-together/time-together.ts` (`getDaysTogether`,
`formatDaysTogether`, `formatMomentsKept`) — no storage, no API. **Semantics:
the start day itself is day 1** (inclusive); days roll over at local midnight
(calendar-date arithmetic via `Date.UTC`, so leap years and DST stay exact).
Future/invalid start dates return `null` and the block hides itself. Days come
from `space.relationshipStartDate`; the moment count from the loaded moments
list. Deliberately NOT engagement metrics: no graphs, rankings, streak framing,
or notifications.

### Memory wall
All kept media gathered like a printed album — screen `app/(app)/memory-wall.tsx`,
entered from ONE quiet button on the profile tab. One wall item per moment: its
photo (`mediaPreview`, expo-image) when it has one, otherwise its voice trace
(`audioUri` rendered as a full-width row reusing `AudioPlayer`). Sorted
`occurredAt` desc (newest first); nothing ranked, nothing counted. Rows are
memoized (`MemoryWallRow`) so tapping a photo never re-renders the list; a tap
opens a full-screen Modal viewer with a "{date} · Kept by you/them" caption.
Image rows pair two cells side by side (author dot colored accent /
partnerAccent); a one-line empty state covers the blank wall. Pure UI over
existing moment data — no new API.

### One question this week
An optional, never-nagging ritual: one handcrafted question per ISO week, both
partners answer privately, and **the answers reveal only when both are in**
(the reveal gate). 20 seeded questions live in `packages/shared/src/question.ts`
(mirrored to `features/question/question-of-the-week.ts` for stub mode); the
week→question mapping is deterministic and identical for both partners
(`(isoYear * 52 + isoWeek) % 20`, week keys `YYYY-Www`, ISO-8601 Thursday rule).
Server authority: `GET /v1/spaces/current/question` returns the week's question
plus both answer states (partner's content only when revealed);
`PUT /v1/spaces/current/question/answer` upserts the viewer's answer for the
server-computed week (membership-gated, 404-style non-leaks like someday).
Answers live in `weekly_answers` (migration 0006), unique per
(space, user, week). Frontend: `features/question/` (context + AsyncStorage
stub + remote repo) and screen `app/(app)/question.tsx`, entered from ONE quiet
button on the profile tab. **Stub mode deliberately does NOT simulate a partner
answer** — the reveal only means anything with their real words, so the stub
shows only your own answer plus a soft "unlocks when they've written too" note.
No badges, no notifications, no pressure. Never log answer content.

### Calendar Event
Scheduling block with start/end, actor (`you`/`partner`), label preset.
Separate entity from Moment (see promotion rules in earlier docs; promotion
UI not built). Stored locally in expo-sqlite (stub) or remote. Optional
fields: `allDay?: boolean` (no time-of-day; stored as flag with
startsAt=00:00 / endsAt=next midnight, UI shows "All day"), `together?:
boolean` (the couple is jointly involved — powers the countdown lane), and
`reminderMinutesBefore?: number[]` (quiet local-notification offsets in
minutes before start; empty/absent = no reminders).

### Event reminders
Local notifications scheduled per (event, offset) on create/update and
cancelled on update/delete by `features/calendar/use-event-reminders.ts`
(pattern mirrors `use-resurface-notification.ts`). Pure logic lives in
`features/calendar/event-reminders.ts` (unit-tested). expo-notifications
returns its own system ids, so cancellation scans scheduled notifications
for `content.data.eventId` / identifier prefix
`aoi.cal.reminder.{eventId}.{offset}`. Only future fire dates are
scheduled; permission denial silently skips; failures are swallowed
(tender-error policy). Always silent — `sound: false`.

### Countdown lane
One quiet muted line atop the calendar tab: "You see each other in N days."
Derived by pure fn `findCountdownEvent(upcomingEvents, now)`: nearest
upcoming event with `together === true`, falling back to the nearest
upcoming `Date`-labeled event. No card, no banner.

### Anniversaries
`space.relationshipStartDate` → monthly "monthiversary" markers on the same
day-of-month, **clamped to the month's last day** when the start day doesn't
exist (e.g. Jan 31 → Feb 28/29). Whole-year anniversaries (months % 12 === 0)
are `kind: 'yearly'` and emphasized (accent dot vs muted). Pure fns in
`calendar-date-utils.ts` (`getAnniversaryMarkers`, `getAnniversaryForDate`,
`formatAnniversaryLabel`); rendered as a tiny dot in the month grid + a quiet
one-liner when today is one.

### Agenda view
Calendar tab toggle under the month grid: upcoming events grouped by day
("Today" / "Tomorrow" / "Mon, Aug 10"), each row = time (or "All day") +
title + actor dot. Fed by `groupAgendaEvents(events, now, horizonDays=30)`.

### Upcoming window
`CalendarProvider` exposes `upcomingEvents` — events overlapping today →
30 days ahead via `listEventsInRange` (implemented in BOTH the SQLite and
remote repositories), independent of the visible month. Feeds the countdown
lane and agenda view; reloaded after every add/update/delete.

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
      SomedayProvider
        QuestionProvider
          SqueezeProvider
            LocationProvider (consent/sharing state; stub vs remote repo)
              PushProvider   (token registration + push receive routing;
                              + <SqueezeOverlay/> + <LocationRequestPrompt/>
                              mounted here)
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
| `/v1/moments/:id` | PATCH/DELETE (own only, soft-delete); writes `space_activity` row in the same transaction |
| `/v1/spaces/current/activity` | change log (tombstones): last 7 days, cap 50, desc; optional `since` ISO param; fact + actor only, never content |
| `/v1/spaces/current/calendar/events`, `/v1/calendar/events/:id` | range query (overlaps from/to), CRUD; events carry optional `reminderMinutesBefore` (jsonb, ≤8 ints 0–2880; empty array on PATCH clears), `allDay`, `together` |
| `/v1/spaces/current/someday`, `/v1/someday/:id` | shared Someday list: list/create; PATCH checks off (`checked: true`), undoes (`checked: false`), or edits title/note/category — either member may do all of it; only meaningful transitions write |
| `/v1/spaces/current/question` (+ `/answer`) | one question this week: GET returns the ISO week's question + both answer states (partner's answer content only when BOTH answered — the reveal gate; partner timing never surfaced); PUT upserts the viewer's answer for the server-computed week (≤500 chars) |
| `/v1/spaces/current/milestones`, preferences | list/append, theme prefs |
| `/v1/media/upload-url`, `/v1/media/:id/complete`, `/download-url` | presigned R2; images + audio; EXIF stripped server-side via sharp (images only) |
| `/v1/push/tokens` | POST registers (upsert) the caller's Expo push token (format-validated, reassigns on device hand-off); DELETE unregisters it (sign-out); identical responses whether or not a row existed — no existence leaks |
| `/v1/squeezes` | fire-and-forget push to the other space member via `notifyPartnerInSpace`; stores nothing; rate limited 10/min per sender |
| `/v1/spaces/current/location` | GET returns the PARTNER's latest share only when both consented AND fresh (15 min live/until_arrive, 5 min grant — grants are consumed on first read); otherwise a calm `{ location: null }`; stale rows purged on read |
| `/v1/spaces/current/location/share` | POST upserts the caller's single row (server-assigned `reportedAt`); notifies `location_granted` for one-time grants; word-only 400s (coordinates never echoed) |
| `/v1/spaces/current/location/stop` | DELETE idempotent — same calm 200 whether or not a row existed; notifies `location_stopped` only when one did |
| `/v1/spaces/current/location/consent` | POST `{ consented }` — opting out deletes any live row + notifies; response carries both consent flags (mutuality is the feature) |
| `/v1/spaces/current/location/request` | POST asks the partner for a one-time share (notifies `location_request` with sender name only); mutuality-gated; rate limited 3/min |

DB: Postgres + Drizzle (`src/db/schema.ts`), migrations in `drizzle/`.
Latest: `0008_*` adds the `location_shares` table (`user_id` unique — at
most ONE ephemeral row per user, `mode` check constraint, nullable
`destination` jsonb, `consumed_at` for one-time grants, latitude/longitude
range checks) and `space_members.location_consent_at` (the both-consent
gate); `0007_*` adds the `push_tokens` table (user-owned,
`expo_push_token` unique, `platform`, `last_seen_at`; user FK cascades —
tokens are ephemeral device artifacts, removed outright when dead);
`0006_*` adds the `weekly_answers` table (spaceId/userId/weekKey/
questionId/answer + timestamps; unique per (space, user, week) for upsert,
indexed by (space, week)) backing the "one question this week" reveal gate;
`0005_*` adds the `someday_items` table (title/note/category + nullable
`checked_at` / `checked_by_user_id` for soft check-off and undo; category
check constraint `place | food | film | other`); `0004_*` adds
calendar_events `reminder_minutes_before` (jsonb) + `all_day` / `together`
booleans (default false); `0003_*` added the `space_activity` change-log
table (kind check constraint: `moment_deleted | moment_edited`). Run
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
  `expo-haptics`, `expo-location`, `expo-task-manager`, `react-native-maps`,
  `@expo/vector-icons`, expo-sqlite, etc. are mocked there —
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
traces + resurface + goals lane, calendar CRUD + reminders (local
notifications) + countdown lane + anniversaries + agenda view + all-day
events, profile, settings, the little things, the Someday list
(device-local), squeeze loop (simulated reply), voice traces (local), media
picking, moments edit/delete + tombstones (local synthesis), time-together
profile line, memory wall, "one question this week" (device-local answers;
no simulated partner — the reveal waits for a real second voice), and
location sharing — honestly simulated: the pretend partner consents a couple
of seconds after you opt in and grants a fixed, plainly-simulated place when
asked (no real GPS, nothing leaves the device).

**Working (remote):** auth (WorkOS), moments (incl. edit/delete + activity
provenance), calendar, the Someday list, spaces, preferences, media upload
pipeline, push backbone (token registration, squeeze delivery, moment-change
and location-request/granted/stopped notifications), the weekly-question
reveal gate (`weekly_answers`), and bounded location sharing (both-consent
gate, three modes, one-time grants, freshness-purged single row) —
against packages/api.

**Known gaps / seams:**

- Push backbone exists but delivery is best-effort: squeezes are
  fire-and-forget (offline partner misses them — no replay), and
  notifications only reach devices that registered a token with permission
  granted.
- Resurface delivery is still local-notification-only; the push backbone is
  the hook to make it server-driven.
- Calendar reminders are device-scoped: `reminderMinutesBefore` schedules
  silent local notifications only on the device that saved the event.
  Partner-created events, reinstalls, and second devices get no reminders
  until reminders are delivered through the push backbone.
- Partner details are device-local — no API table yet.
- Location sharing depends on device-level OS permission grants: Live asks
  for background ("always") permission and falls back to a foreground watch
  if declined; simulators/Expo Go may not deliver background fixes, so real
  verification needs a physical device.
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

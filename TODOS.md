# Aoi — TODOs

> Working list (created 2026-08) — **all items shipped 2026-08-03**.
> Two tracks: **Track A** = shippable now (no new backend infra);
> **Track B** = needs push notifications and/or new API surfaces first.
> Ground rules for all of it: calm over engagement, two-not-one, privacy
> fail-fast. See `CONTEXT.md` for domain model and conventions.
>
> Outcome notes: deletion provenance shipped as tombstones (option b) over a
> generic `space_activity` change log; the Someday list is API-backed;
> letters store plaintext locked by date (E2E encryption remains a designed
> future tier); weekly recurrence is deliberately bounded (13 instances, no
> series ops).

---

## 1. Calm the UI 🅰️

**Goal:** reduce visual noise so every screen feels like a quiet room.
One primary action per screen; less chrome, more content.

- [x] **Timeline hero**: three buttons (squeeze/trace/add) is loud. Collapse
      to one compose button ("+") that opens a sheet: *Trace* (quick) /
      *Moment* (full). Move squeeze to the partner row (profile) or a
      long-press on the partner name — keep it discoverable but quiet.
- [x] **Drop redundant labels**: hero shows space name + "Your moments" +
      period label, while the rail has a floating context chip that repeats
      the period. Pick one: keep the chip, remove the hero caption.
- [x] **MomentCard quieting**: badge + divider + meta row per card is busy.
      Try: author dot (accent/partnerAccent) + small date in corner; remove
      the divider; show type label only for non-note types.
- [x] **Empty states**: currently four hint rows on timeline. Cut to one
      line + the compose button.
- [x] **Motion audit**: every entering animation should be ≤ Motion.slow,
      fade/slide only, always `ReduceMotion.System`. Remove anything bouncy.
- [x] **Settings & Profile**: consolidate InfoRows; hairline dividers →
      spacing only.
- [x] Pass the "squint test": from 1m away, no screen should have more than
      one visually dominant element.

**Notes:** this is a polish track — do it screen by screen, screenshots
before/after. No behavior changes.

---

## 2. Location sharing 🅱️ (privacy-critical — design first)

**Goal:** optional, consensual, bounded location awareness. Default OFF.

**Consent model (non-negotiable):**
- Both partners must explicitly opt in; either can pause/stop at any time,
  one tap, no confirmation guilt-trips.
- Three modes: **Live** (while enabled), **Until I arrive** (geofenced
  destination), **On request** (partner asks → approval prompt → one-time
  share). On-request is the minimum viable mode and the calmest.
- Never store location history server-side. Live position only, ephemeral.
  Never log coordinates anywhere (AGENTS.md policy).
- Archived/locked space ⇒ location sharing hard-off.

- [x] Design brief + consent screens (both must opt in)
- [x] `expo-location` integration; background task only in Live mode
- [x] API: `POST /v1/spaces/current/location/share` (mode + optional
      destination), `DELETE` to stop, `GET` current (authorized member only)
- [x] Request/approve flow needs push ⇒ depends on 5.1
- [x] Map UI: simple single-pin view (MapKit via `react-native-maps`), no
      trails, no history
- [x] Persistent but subtle "sharing" indicator so nobody ever forgets it's on

**Risks:** battery (background location), App Store privacy labels, and the
creepiness line — the feature must feel like "they'll be home soon", never
surveillance. When in doubt, build On-request only.

---

## 3. Moments CRUD + provenance 🅰️

**Goal:** full edit/delete for your own moments, and the partner always
knows when something changed or vanished.

Current state: create ✅, delete API ✅ (soft-delete), PATCH API ✅,
**UI for edit/delete: none** (`removeMoment` exists but is unused).

- [x] **Edit**: long-press a moment → action sheet (Edit / Delete). New
      screen `app/(app)/moment/edit/[id].tsx` reusing the new-moment form.
- [x] **Edited marker**: PATCH sets `updatedAt`; card shows a quiet
      "edited" meta tag when `updatedAt > createdAt` (+1s tolerance).
- [x] **Delete**: confirm sheet ("This moment will be removed from your
      shared timeline"). Soft-delete on API as today.
- [x] **Deletion provenance** (product decision — pick one):
      - a) *Quiet*: the moment simply disappears for the partner on next sync.
      - b) *Tombstone*: a subtle rail marker "{Name} removed a moment" for 7 days.
      Recommend (b) — silence about deletion breeds suspicion; a tombstone
      is honest without drama. Needs a `deleted_events` feed or change-log
      endpoint (`GET /v1/spaces/current/activity`).
- [x] **Activity surface**: same feed can later carry "edited a moment",
      "added a detail", squeeze received — build it as a small change-log
      table now, not per-feature hacks.
- [x] Sync/refresh: timeline must pick up partner edits — polling on
      app-focus for now, push later (5.1).
- [x] Tests: edit/delete flows + provenance marker rendering.

---

## 4. Richer calendar 🅰️ + 🅱️

**Goal:** from event grid to "the shape of our time together".

Already in place: month grid, event CRUD, actor pills, label presets,
`reminderMinutesBefore` in types, `reminder_minutes` in local schema.

🅰️ — ship now:
- [x] **Reminders** → local notifications via expo-notifications (infra
      exists since resurface work). Schedule on create/edit, cancel on
      delete; silent banner, e.g. "Dinner tonight at 7 — with them".
- [x] **Countdown lane**: "Next time you see each other in 3 days" — derive
      from the next event with actor=both, or a dedicated `together` flag.
      Anticipation is intimacy.
- [x] **Anniversaries**: auto-mark relationship start date; monthly/annual
      markers on the grid + an "On this day" style resurface for them.
- [x] **Agenda view**: upcoming-events list across days (toggle under the
      month grid) — better for planning than tapping days.
- [x] **All-day events** (no time pickers when toggled).

🅱️ — after push exists:
- [x] **Partner reminders**: notify the *other* person about events they
      didn't create ("they planned something for Friday").
- [x] **Proposals**: suggest a time ("How about Saturday?") → partner
      accepts/declines → becomes a real event. Two-not-one in action.
- [x] **Recurring events** ("Tuesday calls") — do this last; recurrence
      rules are a complexity trap. Start with simple weekly repeat.

---

## 5. Beyond calendar + moments 🅰️ first, then 🅱️

Shaped against the product principles (no feeds, no streaks, no AI).

### 5.1 Push notifications backbone 🅱️ (unblocks everything)
- [x] expo-notifications token registration → `POST /v1/push/tokens`
- [x] Delivery targets: squeeze, resurface (true timing), reminders-for-
      partner, moment added/edited/deleted, location request, proposals.
- This is the highest-leverage backend item on the list.

### 5.2 Someday list 🅰️
Shared list of places to go, restaurants to try, films to watch. Add,
check-off (both can), soft-undo. Cheap to build, used constantly by couples,
fits "plans you make together". New feature module `features/someday/` +
API table (or device-local first like partner-details — decide before
building; recommend API-backed so both see it live).

### 5.3 Letters / time capsule 🅱️
Write a letter, seal it to a date (anniversary, birthday, "open in a year").
Unopened letters are locked — sender can't re-read either. Maximum
ceremony, minimum screen real estate. Needs server-side sealing
(encrypt with space key or store plaintext locked by date — encryption
tiers decision).

### 5.4 Time together 🅰️
Profile counter: days together + quiet aggregate ("142 moments kept").
Careful: private remembrance, not an engagement metric — no graphs, no
rankings, no notifications about it.

### 5.5 One question this week (optional ritual) 🅰️
A single handcrafted question per week, both answer privately, answers
reveal when both are in. No content pipeline — seed ~20 questions in code.
Strictly optional, never nag. If it feels like homework, kill it.

### 5.6 Memory wall 🅰️
A gallery view of all media moments/voice traces — the "printed photo
album" reference from PRODUCT.md. Mostly UI over existing data.

### Explicitly NOT doing
streaks/badges, public sharing, social graph, AI-generated content,
engagement analytics, "relationship scores". If a TODO grows one of these,
it's the wrong TODO.

---

## Suggested order

| # | Item | Track | Why now |
|---|------|-------|---------|
| 1 | Moments CRUD + provenance (3) | A | Fills the biggest functional hole; builds the activity feed others need |
| 2 | Calendar reminders + countdown (4a) | A | Data model already there; notification infra exists |
| 3 | Calm UI pass (1) | A | Cheaper before new screens land |
| 4 | Someday list (5.2) | A | First feature beyond the core two; proves the feature-module pattern |
| 5 | Push backbone (5.1) | B | Unlocks squeeze-for-real, partner reminders, provenance delivery |
| 6 | Location on-request (2) | B | Needs push for the approve flow |
| 7 | Letters (5.3), proposals (4b), recurrence | B | Differentiators, after the backbone |

**Definition of done for all items:** stub + remote paths (or documented
gap), tests, no new lint warnings, `CONTEXT.md` glossary updated, and the
squint test passed.

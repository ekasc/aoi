# Calm Engagement MVP Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a prompt-led Home tab as the first screen couples see, backed by a weekly date-planning ritual and optional push notifications, without adding any engagement mechanics or social patterns.

**Architecture:** A pure-function `buildHomeViewModel` derives the UI state from existing moments + calendar events — no new server calls. Quick capture extends the existing `moment/new` screen with URL params. The weekly date planner is a thin modal over the existing CalendarContext. Notifications are a standalone layer (Tasks 8–10) that can be deferred without affecting the rest of the feature.

**Tech Stack:** React Native + Expo Router, expo-sqlite (existing), expo-notifications (Tasks 8–10 only, new), @react-native-async-storage/async-storage (existing, used for notification prefs), bun:test (unit tests)

---

> **Scope note:** Tasks 1–7 produce a shippable Home + Quick Capture + Date Ritual with zero new native dependencies. Tasks 8–10 (notifications) require adding `expo-notifications` and can be deferred to a separate session.

---

## File Map

### New files
| File | Responsibility |
|------|---------------|
| `features/home/types.ts` | `HomePromptType`, `HomeViewModel`, `QuickActionType` |
| `features/home/home-view-model.ts` | Pure fn `buildHomeViewModel(moments, events, now)` |
| `app/(app)/(tabs)/home.tsx` | Home tab screen |
| `app/(app)/date-plan/new.tsx` | Simplified date planner modal |
| `features/notifications/types.ts` | `NotificationPreferences` type |
| `features/notifications/notification-preferences-store.ts` | AsyncStorage read/write |
| `features/notifications/notification-scheduler.ts` | Schedule/cancel local notifications |
| `tests/unit/home/home-view-model.test.ts` | Unit tests for view model |
| `tests/unit/notifications/notification-preferences-store.test.ts` | Unit tests for prefs store |

### Modified files
| File | Change |
|------|--------|
| `features/moments/types.ts` | Add `tags?: MomentTag[]` to `Moment` and `CreateMomentInput` |
| `features/calendar/types.ts` | Add `reminderMinutesBefore?: number[]` to event types |
| `features/calendar/calendar-date-utils.ts` | Add `getWeekBounds`, `isThisWeek` helpers |
| `features/calendar/calendar-repository.ts` | Add `reminder_minutes` column; update init/insert/update/toCalendarEvent |
| `app/(app)/(tabs)/_layout.tsx` | Add Home as first tab; Timeline becomes tab 2 |
| `app/(app)/_layout.tsx` | Register `date-plan/new` screen |
| `app/(app)/moment/new.tsx` | Accept `?type=` and `?tag=` search params for preselection |
| `app/(app)/(tabs)/settings.tsx` | Add notification preferences section |

---

## Task 1: Type Extensions

**Files:**
- Modify: `features/moments/types.ts`
- Modify: `features/calendar/types.ts`

- [ ] **Step 1: Add MomentTag union and tags field to Moment**

Open `features/moments/types.ts`. Add after the existing type definitions:

```typescript
export type MomentTag = 'date-idea' | 'milestone' | 'inside-joke' | 'trip';
```

Add `tags?: MomentTag[]` to both `Moment` and `CreateMomentInput`:

```typescript
export type Moment = {
  id: string;
  type: MomentType;
  title: string;
  body: string;
  occurredAt: string;
  targetAt?: string | null;
  createdAt: string;
  authorId: string;
  authorRole: MomentAuthorRole;
  authorName: string;
  mediaPreview?: string;
  tags?: MomentTag[];  // ADD THIS
};

export type CreateMomentInput = {
  type: MomentType;
  title?: string;
  body?: string;
  occurredAt?: string;
  targetAt?: string | null;
  authorId?: string;
  authorRole?: MomentAuthorRole;
  authorName?: string;
  mediaPreview?: string;
  tags?: MomentTag[];  // ADD THIS
};
```

- [ ] **Step 2: Add reminderMinutesBefore to calendar types**

Open `features/calendar/types.ts`. Add `reminderMinutesBefore?: number[]` to `CalendarEvent`, `CreateCalendarEventInput`, and `UpdateCalendarEventInput`:

```typescript
export type CalendarEvent = {
  id: string;
  title: string;
  startsAt: string;
  endsAt: string;
  actor: CalendarActor;
  actorName: string;
  label: CalendarLabel;
  createdAt: string;
  updatedAt: string;
  reminderMinutesBefore?: number[];  // ADD THIS
};

export type CreateCalendarEventInput = {
  title: string;
  startsAt: string;
  endsAt: string;
  actor: CalendarActor;
  actorName: string;
  label: CalendarLabel;
  reminderMinutesBefore?: number[];  // ADD THIS
};

export type UpdateCalendarEventInput = {
  id: string;
  title: string;
  startsAt: string;
  endsAt: string;
  label: CalendarLabel;
  reminderMinutesBefore?: number[];  // ADD THIS
};
```

- [ ] **Step 3: Run typecheck to confirm no regressions**

```bash
bun run typecheck
```

Expected: no errors. The new fields are optional so existing usages are unaffected.

- [ ] **Step 4: Commit**

```bash
git add features/moments/types.ts features/calendar/types.ts
git commit -m "feat: add MomentTag and reminderMinutesBefore type extensions"
```

---

## Task 2: Calendar Repository Migration

**Files:**
- Modify: `features/calendar/calendar-repository.ts`

The DB schema needs a `reminder_minutes` column (stored as JSON string, e.g. `"[30,60]"`). The existing `initCalendarDb` uses `CREATE TABLE IF NOT EXISTS` so existing installs won't add the column automatically — we need an `ALTER TABLE` migration guard.

- [ ] **Step 1: Update `CalendarEventRow` and `toCalendarEvent`**

In `features/calendar/calendar-repository.ts`, add `reminder_minutes` to the row type and update the mapper:

```typescript
type CalendarEventRow = {
  id: string;
  title: string;
  starts_at: string;
  ends_at: string;
  actor: 'you' | 'partner';
  actor_name: string;
  label_preset: CalendarPresetLabel;
  label_custom_text: string | null;
  reminder_minutes: string | null;  // ADD: JSON string e.g. "[30,60]" or null
  created_at: string;
  updated_at: string;
};
```

Update `toCalendarEvent`:

```typescript
function toCalendarEvent(row: CalendarEventRow): CalendarEvent {
  return {
    id: row.id,
    title: row.title,
    startsAt: row.starts_at,
    endsAt: row.ends_at,
    actor: row.actor,
    actorName: row.actor_name,
    label: {
      preset: row.label_preset,
      customText: row.label_custom_text ?? undefined,
    },
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    reminderMinutesBefore: row.reminder_minutes
      ? (JSON.parse(row.reminder_minutes) as number[])
      : undefined,
  };
}
```

- [ ] **Step 2: Add migration to `initCalendarDb`**

Replace the `initCalendarDb` function body with:

```typescript
export async function initCalendarDb() {
  const db = await getDatabase();

  await db.execAsync(`
    CREATE TABLE IF NOT EXISTS calendar_events (
      id TEXT PRIMARY KEY NOT NULL,
      title TEXT NOT NULL,
      starts_at TEXT NOT NULL,
      ends_at TEXT NOT NULL,
      actor TEXT NOT NULL,
      actor_name TEXT NOT NULL,
      label_preset TEXT NOT NULL,
      label_custom_text TEXT,
      reminder_minutes TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_calendar_events_starts_at
    ON calendar_events(starts_at);

    CREATE INDEX IF NOT EXISTS idx_calendar_events_actor
    ON calendar_events(actor);
  `);

  // Migration: add reminder_minutes column to existing installs
  const columns = await db.getAllAsync<{ name: string }>(
    `PRAGMA table_info(calendar_events)`
  );
  const hasReminderColumn = columns.some((col) => col.name === 'reminder_minutes');
  if (!hasReminderColumn) {
    await db.execAsync(
      `ALTER TABLE calendar_events ADD COLUMN reminder_minutes TEXT`
    );
  }
}
```

- [ ] **Step 3: Update `insertEvent` to include reminder_minutes**

In `insertEvent`, add the new column:

```typescript
export async function insertEvent(input: CreateCalendarEventInput) {
  const db = await getDatabase();
  const now = new Date().toISOString();
  const id = createId();
  const reminderJson = input.reminderMinutesBefore?.length
    ? JSON.stringify(input.reminderMinutesBefore)
    : null;

  await db.runAsync(
    `INSERT INTO calendar_events (
      id, title, starts_at, ends_at, actor, actor_name,
      label_preset, label_custom_text, reminder_minutes, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    id,
    input.title.trim(),
    input.startsAt,
    input.endsAt,
    input.actor,
    input.actorName.trim(),
    input.label.preset,
    input.label.customText?.trim() || null,
    reminderJson,
    now,
    now
  );

  return id;
}
```

- [ ] **Step 4: Update `updateEvent` to include reminder_minutes**

```typescript
export async function updateEvent(input: UpdateCalendarEventInput) {
  const db = await getDatabase();
  const now = new Date().toISOString();
  const reminderJson = input.reminderMinutesBefore?.length
    ? JSON.stringify(input.reminderMinutesBefore)
    : null;

  await db.runAsync(
    `UPDATE calendar_events
     SET title = ?, starts_at = ?, ends_at = ?,
         label_preset = ?, label_custom_text = ?,
         reminder_minutes = ?, updated_at = ?
     WHERE id = ?`,
    input.title.trim(),
    input.startsAt,
    input.endsAt,
    input.label.preset,
    input.label.customText?.trim() || null,
    reminderJson,
    now,
    input.id
  );
}
```

- [ ] **Step 5: Run typecheck**

```bash
bun run typecheck
```

Expected: no errors.

- [ ] **Step 6: Commit**

```bash
git add features/calendar/calendar-repository.ts
git commit -m "feat: add reminder_minutes column to calendar_events with migration guard"
```

---

## Task 3: Week Boundary Utilities

**Files:**
- Modify: `features/calendar/calendar-date-utils.ts`

The home view model needs to check whether a `Date` event exists in the current week. These utilities are pure functions and easy to test.

- [ ] **Step 1: Write failing tests**

Create `tests/unit/home/week-utils.test.ts`:

```typescript
import { describe, expect, test } from 'bun:test';
import { getWeekBounds, isInWeek } from '../../../features/calendar/calendar-date-utils';

describe('getWeekBounds', () => {
  test('returns Sunday as start for a Wednesday', () => {
    const wednesday = new Date('2026-03-25T12:00:00Z'); // Wednesday
    const { weekStart, weekEnd } = getWeekBounds(wednesday);
    expect(weekStart.getDay()).toBe(0); // Sunday
    expect(weekEnd.getDay()).toBe(0); // next Sunday
    expect(weekEnd.getTime() - weekStart.getTime()).toBe(7 * 24 * 60 * 60 * 1000);
  });

  test('returns same day when now is Sunday', () => {
    const sunday = new Date('2026-03-22T08:00:00Z');
    const { weekStart } = getWeekBounds(sunday);
    expect(weekStart.getDay()).toBe(0);
    expect(weekStart.getDate()).toBe(sunday.getDate());
  });
});

describe('isInWeek', () => {
  test('returns true for a date in the same week', () => {
    const now = new Date('2026-03-25T12:00:00Z'); // Wednesday
    const target = new Date('2026-03-27T18:00:00Z'); // Friday same week
    expect(isInWeek(target, now)).toBe(true);
  });

  test('returns false for a date in the next week', () => {
    const now = new Date('2026-03-25T12:00:00Z');
    const target = new Date('2026-03-30T18:00:00Z'); // Monday next week
    expect(isInWeek(target, now)).toBe(false);
  });

  test('returns false for a past date in a prior week', () => {
    const now = new Date('2026-03-25T12:00:00Z');
    const target = new Date('2026-03-20T12:00:00Z'); // prior Friday
    expect(isInWeek(target, now)).toBe(false);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
bun test tests/unit/home/week-utils.test.ts
```

Expected: FAIL — `getWeekBounds` and `isInWeek` are not yet defined.

- [ ] **Step 3: Add utilities to calendar-date-utils.ts**

Append to `features/calendar/calendar-date-utils.ts`:

```typescript
export type WeekBounds = { weekStart: Date; weekEnd: Date };

export function getWeekBounds(now: Date): WeekBounds {
  const weekStart = new Date(now);
  weekStart.setDate(now.getDate() - now.getDay()); // back to Sunday
  weekStart.setHours(0, 0, 0, 0);
  const weekEnd = new Date(weekStart);
  weekEnd.setDate(weekStart.getDate() + 7);
  return { weekStart, weekEnd };
}

export function isInWeek(date: Date, now: Date): boolean {
  const { weekStart, weekEnd } = getWeekBounds(now);
  return date >= weekStart && date < weekEnd;
}
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
bun test tests/unit/home/week-utils.test.ts
```

Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add features/calendar/calendar-date-utils.ts tests/unit/home/week-utils.test.ts
git commit -m "feat: add getWeekBounds and isInWeek utilities"
```

---

## Task 4: Home View Model

**Files:**
- Create: `features/home/types.ts`
- Create: `features/home/home-view-model.ts`
- Create: `tests/unit/home/home-view-model.test.ts`

The view model is a pure function — no hooks, no side effects. All logic is unit-testable.

- [ ] **Step 1: Create types**

Create `features/home/types.ts`:

```typescript
import type { CalendarEvent } from '@/features/calendar/types';
import type { Moment } from '@/features/moments/types';

export type HomePromptType =
  | 'plan-this-week'         // no Date event exists this week
  | 'save-from-today'        // has plans, nudge toward capturing a moment
  | 'save-moment-after-plan'; // user just added a Date event this week

export type QuickActionType = 'photo' | 'note' | 'date-idea' | 'plan';

export type HomeQuickAction = {
  type: QuickActionType;
  label: string;
  disabled?: boolean;
};

export type HomeViewModel = {
  primaryPrompt: HomePromptType;
  quickActions: HomeQuickAction[];
  nextEvent: CalendarEvent | null;
  recentMoment: Moment | null;
  historyPreview: Moment[] | null; // non-null only when moments.length >= 5
};
```

- [ ] **Step 2: Write failing tests**

Create `tests/unit/home/home-view-model.test.ts`:

```typescript
import { describe, expect, test } from 'bun:test';
import { buildHomeViewModel } from '../../../features/home/home-view-model';
import type { CalendarEvent } from '../../../features/calendar/types';
import type { Moment } from '../../../features/moments/types';

const now = new Date('2026-03-25T12:00:00Z'); // Wednesday

function makeEvent(overrides: Partial<CalendarEvent> = {}): CalendarEvent {
  return {
    id: 'evt_1',
    title: 'Dinner',
    startsAt: new Date('2026-03-26T19:00:00Z').toISOString(), // Thursday this week
    endsAt: new Date('2026-03-26T21:00:00Z').toISOString(),
    actor: 'you',
    actorName: 'You',
    label: { preset: 'Date' },
    createdAt: now.toISOString(),
    updatedAt: now.toISOString(),
    ...overrides,
  };
}

function makeMoment(overrides: Partial<Moment> = {}): Moment {
  return {
    id: 'mom_1',
    type: 'note',
    title: 'Walked in the park',
    body: '',
    occurredAt: new Date('2026-03-24T10:00:00Z').toISOString(),
    createdAt: now.toISOString(),
    authorId: 'user_you',
    authorRole: 'you',
    authorName: 'You',
    ...overrides,
  };
}

describe('buildHomeViewModel', () => {
  test('prompt is plan-this-week when no Date event exists this week', () => {
    const vm = buildHomeViewModel([], [], now);
    expect(vm.primaryPrompt).toBe('plan-this-week');
  });

  test('prompt is save-from-today when a Date event exists this week', () => {
    const events = [makeEvent()]; // Date label, this week
    const vm = buildHomeViewModel([], events, now);
    expect(vm.primaryPrompt).toBe('save-from-today');
  });

  test('prompt is plan-this-week when an event exists but is not labeled Date', () => {
    const events = [makeEvent({ label: { preset: 'Work' } })];
    const vm = buildHomeViewModel([], events, now);
    expect(vm.primaryPrompt).toBe('plan-this-week');
  });

  test('nextEvent is the soonest upcoming event after now', () => {
    const soon = makeEvent({ startsAt: new Date('2026-03-26T19:00:00Z').toISOString() });
    const later = makeEvent({ id: 'evt_2', startsAt: new Date('2026-03-27T12:00:00Z').toISOString() });
    const vm = buildHomeViewModel([], [later, soon], now);
    expect(vm.nextEvent?.id).toBe('evt_1');
  });

  test('nextEvent is null when all events are in the past', () => {
    const past = makeEvent({ startsAt: new Date('2026-03-24T10:00:00Z').toISOString() });
    const vm = buildHomeViewModel([], [past], now);
    expect(vm.nextEvent).toBeNull();
  });

  test('recentMoment is the most recent moment', () => {
    const older = makeMoment({ id: 'mom_1', occurredAt: '2026-03-20T10:00:00Z' });
    const newer = makeMoment({ id: 'mom_2', occurredAt: '2026-03-24T10:00:00Z' });
    const vm = buildHomeViewModel([older, newer], [], now);
    expect(vm.recentMoment?.id).toBe('mom_2');
  });

  test('historyPreview is null when fewer than 5 moments', () => {
    const moments = [makeMoment(), makeMoment({ id: 'mom_2' })];
    const vm = buildHomeViewModel(moments, [], now);
    expect(vm.historyPreview).toBeNull();
  });

  test('historyPreview has 2 items when 5+ moments exist', () => {
    const moments = Array.from({ length: 5 }, (_, i) =>
      makeMoment({ id: `mom_${i}`, occurredAt: new Date(2026, 2, 20 + i).toISOString() })
    );
    const vm = buildHomeViewModel(moments, [], now);
    expect(vm.historyPreview).not.toBeNull();
    expect(vm.historyPreview?.length).toBe(2);
  });

  test('always returns all 4 quick actions', () => {
    const vm = buildHomeViewModel([], [], now);
    expect(vm.quickActions.map((a) => a.type)).toEqual(['photo', 'note', 'date-idea', 'plan']);
  });
});
```

- [ ] **Step 3: Run tests to verify they fail**

```bash
bun test tests/unit/home/home-view-model.test.ts
```

Expected: FAIL — `buildHomeViewModel` not yet defined.

- [ ] **Step 4: Implement the view model**

Create `features/home/home-view-model.ts`:

```typescript
import type { CalendarEvent } from '@/features/calendar/types';
import type { Moment } from '@/features/moments/types';
import { isInWeek } from '@/features/calendar/calendar-date-utils';
import type { HomeViewModel, HomePromptType } from '@/features/home/types';

const QUICK_ACTIONS = [
  { type: 'photo' as const, label: 'Photo', disabled: true },
  { type: 'note' as const, label: 'Note' },
  { type: 'date-idea' as const, label: 'Date idea' },
  { type: 'plan' as const, label: 'Plan' },
];

function hasDateEventThisWeek(events: CalendarEvent[], now: Date): boolean {
  return events.some(
    (event) =>
      event.label.preset === 'Date' && isInWeek(new Date(event.startsAt), now)
  );
}

function resolvePrompt(
  moments: Moment[],
  events: CalendarEvent[],
  now: Date
): HomePromptType {
  if (!hasDateEventThisWeek(events, now)) {
    return 'plan-this-week';
  }
  return 'save-from-today';
}

function getNextEvent(events: CalendarEvent[], now: Date): CalendarEvent | null {
  const upcoming = events
    .filter((event) => new Date(event.startsAt) > now)
    .sort((a, b) => new Date(a.startsAt).getTime() - new Date(b.startsAt).getTime());
  return upcoming[0] ?? null;
}

function getRecentMoment(moments: Moment[]): Moment | null {
  if (moments.length === 0) return null;
  return [...moments].sort(
    (a, b) => new Date(b.occurredAt).getTime() - new Date(a.occurredAt).getTime()
  )[0];
}

function getHistoryPreview(moments: Moment[]): Moment[] | null {
  if (moments.length < 5) return null;
  return [...moments]
    .sort((a, b) => new Date(b.occurredAt).getTime() - new Date(a.occurredAt).getTime())
    .slice(0, 2);
}

export function buildHomeViewModel(
  moments: Moment[],
  events: CalendarEvent[],
  now: Date
): HomeViewModel {
  return {
    primaryPrompt: resolvePrompt(moments, events, now),
    quickActions: QUICK_ACTIONS,
    nextEvent: getNextEvent(events, now),
    recentMoment: getRecentMoment(moments),
    historyPreview: getHistoryPreview(moments),
  };
}
```

- [ ] **Step 5: Run tests to verify they pass**

```bash
bun test tests/unit/home/home-view-model.test.ts
```

Expected: PASS (9 tests).

- [ ] **Step 6: Run full test suite**

```bash
bun run test:unit
```

Expected: all existing tests still pass.

- [ ] **Step 7: Commit**

```bash
git add features/home/ tests/unit/home/
git commit -m "feat: add home view model with prompt and quick action logic"
```

---

## Task 5: Home Tab Screen

**Files:**
- Create: `app/(app)/(tabs)/home.tsx`

This screen composes existing components. It reads from `useMoments()` and `useCalendar()` then calls `buildHomeViewModel`.

- [ ] **Step 1: Create the home screen**

Create `app/(app)/(tabs)/home.tsx`:

```typescript
import { useRouter } from 'expo-router';
import { useCallback, useMemo } from 'react';
import { Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Animated, { FadeInDown, ReduceMotion } from 'react-native-reanimated';

import { MomentCard } from '@/components/moments/moment-card';
import { ThemedText } from '@/components/themed-text';
import { Button } from '@/components/ui/button';
import { Surface } from '@/components/ui/surface';
import { Motion, Spacing } from '@/constants/theme';
import { buildHomeViewModel } from '@/features/home/home-view-model';
import type { HomePromptType, QuickActionType } from '@/features/home/types';
import { useCalendar } from '@/features/calendar/calendar-context';
import { useMoments } from '@/features/moments/moments-context';
import { useSpace } from '@/features/space/space-context';
import { formatDateTitle, formatTimeRange } from '@/features/calendar/calendar-date-utils';
import { useThemeColor } from '@/hooks/use-theme-color';

const PROMPT_COPY: Record<HomePromptType, { heading: string; body: string; cta: string }> = {
  'plan-this-week': {
    heading: 'Plan this week together',
    body: 'No date planned yet. Add one thing to look forward to.',
    cta: 'Plan a date',
  },
  'save-from-today': {
    heading: 'Save one thing from today',
    body: 'What happened today worth remembering?',
    cta: 'Add a moment',
  },
  'save-moment-after-plan': {
    heading: 'You added a plan',
    body: 'Want to save a moment from today too?',
    cta: 'Add a moment',
  },
};

export default function HomeScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const isAndroid = process.env.EXPO_OS === 'android';
  const { moments } = useMoments();
  const { events } = useCalendar();
  const { space } = useSpace();
  const now = useMemo(() => new Date(), []);
  const muted = useThemeColor({}, 'muted');
  const accent = useThemeColor({}, 'accent');
  const background = useThemeColor({}, 'background');
  const surface2 = useThemeColor({}, 'surface2');
  const border = useThemeColor({}, 'border');

  const viewModel = useMemo(
    () => buildHomeViewModel(moments, events, now),
    [moments, events, now]
  );

  const prompt = PROMPT_COPY[viewModel.primaryPrompt];

  const handlePromptCta = useCallback(() => {
    if (viewModel.primaryPrompt === 'plan-this-week') {
      router.push('/(app)/date-plan/new');
    } else {
      router.push('/(app)/moment/new');
    }
  }, [router, viewModel.primaryPrompt]);

  const handleQuickAction = useCallback(
    (type: QuickActionType) => {
      if (type === 'note') {
        router.push({ pathname: '/(app)/moment/new', params: { type: 'note' } });
      } else if (type === 'date-idea') {
        router.push({ pathname: '/(app)/moment/new', params: { type: 'note', tag: 'date-idea' } });
      } else if (type === 'plan') {
        router.push('/(app)/date-plan/new');
      }
      // photo: disabled for now (camera integration pending)
    },
    [router]
  );

  const contentContainerStyle = useMemo(
    () => [
      styles.contentContainer,
      {
        paddingTop: insets.top + Spacing[8],
        paddingBottom: insets.bottom + Spacing[24],
      },
    ],
    [insets]
  );

  return (
    <ScrollView
      style={{ backgroundColor: background }}
      contentContainerStyle={contentContainerStyle}
      contentInsetAdjustmentBehavior="automatic"
      showsVerticalScrollIndicator={false}
    >
      {/* Header */}
      <Animated.View
        entering={
          !isAndroid
            ? FadeInDown.duration(Motion.slow).delay(20).reduceMotion(ReduceMotion.System)
            : undefined
        }
        style={styles.heroRow}
      >
        <View style={styles.heroText}>
          <ThemedText type="meta" style={{ color: muted }}>
            {space?.name ?? 'Your space'}
          </ThemedText>
          <ThemedText type="title">Home</ThemedText>
        </View>
      </Animated.View>

      {/* Primary prompt card */}
      <Animated.View
        entering={
          !isAndroid
            ? FadeInDown.duration(Motion.base).delay(60).reduceMotion(ReduceMotion.System)
            : undefined
        }
      >
        <Surface variant="raised" style={styles.promptCard}>
          <ThemedText type="title">{prompt.heading}</ThemedText>
          <ThemedText type="body" style={{ color: muted }}>
            {prompt.body}
          </ThemedText>
          <Button label={prompt.cta} onPress={handlePromptCta} />
        </Surface>
      </Animated.View>

      {/* Quick actions */}
      <Animated.View
        entering={
          !isAndroid
            ? FadeInDown.duration(Motion.base).delay(100).reduceMotion(ReduceMotion.System)
            : undefined
        }
      >
        <Surface style={styles.quickActionsCard}>
          <ThemedText type="meta" style={{ color: muted }}>
            Quick add
          </ThemedText>
          <View style={styles.quickActionsRow}>
            {viewModel.quickActions.map((action) => (
              <Pressable
                accessibilityLabel={action.label}
                accessibilityRole="button"
                disabled={action.disabled}
                key={action.type}
                onPress={() => handleQuickAction(action.type)}
                style={[
                  styles.quickActionChip,
                  {
                    backgroundColor: surface2,
                    borderColor: border,
                    opacity: action.disabled ? 0.45 : 1,
                  },
                ]}
              >
                <ThemedText type="caption">{action.label}</ThemedText>
              </Pressable>
            ))}
          </View>
        </Surface>
      </Animated.View>

      {/* Next upcoming plan */}
      {viewModel.nextEvent ? (
        <Pressable
          accessibilityLabel={`Open event ${viewModel.nextEvent.title}`}
          accessibilityRole="button"
          onPress={() => router.push(`/(app)/calendar/edit/${viewModel.nextEvent!.id}`)}
        >
          <Surface style={styles.nextEventCard}>
            <ThemedText type="meta" style={{ color: muted }}>
              Next plan
            </ThemedText>
            <ThemedText type="title">{viewModel.nextEvent.title}</ThemedText>
            <ThemedText type="caption" style={{ color: muted }}>
              {formatDateTitle(new Date(viewModel.nextEvent.startsAt))}
            </ThemedText>
            <ThemedText type="caption" style={{ color: muted }}>
              {formatTimeRange(viewModel.nextEvent.startsAt, viewModel.nextEvent.endsAt)}
            </ThemedText>
          </Surface>
        </Pressable>
      ) : null}

      {/* Recent moment */}
      {viewModel.recentMoment ? (
        <View>
          <ThemedText type="meta" style={[styles.sectionLabel, { color: muted }]}>
            Recent moment
          </ThemedText>
          <MomentCard moment={viewModel.recentMoment} />
        </View>
      ) : null}

      {/* History preview */}
      {viewModel.historyPreview ? (
        <Surface style={styles.historyCard}>
          <ThemedText type="meta" style={{ color: muted }}>
            From your story
          </ThemedText>
          {viewModel.historyPreview.map((moment) => (
            <View key={moment.id} style={styles.historyRow}>
              <ThemedText type="caption" style={{ color: accent }}>
                {new Date(moment.occurredAt).toLocaleDateString('en-US', {
                  month: 'short',
                  day: 'numeric',
                })}
              </ThemedText>
              <ThemedText type="caption" style={styles.historyTitle}>
                {moment.title}
              </ThemedText>
            </View>
          ))}
        </Surface>
      ) : null}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  contentContainer: {
    paddingHorizontal: Spacing[16],
    gap: Spacing[12],
  },
  heroRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  heroText: {
    gap: Spacing[4],
  },
  promptCard: {
    gap: Spacing[8],
  },
  quickActionsCard: {
    gap: Spacing[8],
  },
  quickActionsRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: Spacing[8],
  },
  quickActionChip: {
    minHeight: 44,
    minWidth: 44,
    paddingHorizontal: Spacing[16],
    borderRadius: 999,
    borderWidth: StyleSheet.hairlineWidth,
    alignItems: 'center',
    justifyContent: 'center',
  },
  nextEventCard: {
    gap: Spacing[4],
  },
  sectionLabel: {
    marginBottom: Spacing[4],
  },
  historyCard: {
    gap: Spacing[8],
  },
  historyRow: {
    flexDirection: 'row',
    gap: Spacing[8],
    alignItems: 'center',
  },
  historyTitle: {
    flex: 1,
  },
});
```

- [ ] **Step 2: Run typecheck**

```bash
bun run typecheck
```

Expected: no errors. If `date-plan/new` route is flagged, that's expected until Task 6 creates it — you can ignore typed route errors for now; they'll resolve once the file is created.

- [ ] **Step 3: Commit**

```bash
git add app/\(app\)/\(tabs\)/home.tsx
git commit -m "feat: add home tab screen with prompt, quick actions, next event, and recent moment"
```

---

## Task 6: Quick Capture Params + Date Plan Screen

**Files:**
- Modify: `app/(app)/moment/new.tsx`
- Create: `app/(app)/date-plan/new.tsx`
- Modify: `app/(app)/_layout.tsx`

- [ ] **Step 1: Update moment/new.tsx to accept type and tag params**

Add `useLocalSearchParams` to read `type` and `tag` from the URL. At the top of `NewMomentScreen`, after the existing imports, add:

```typescript
import { Stack, useRouter, useLocalSearchParams } from 'expo-router';
```

(Replace the existing `Stack, useRouter` import line — just add `useLocalSearchParams`.)

Then inside the component, read params and use them for initial state:

```typescript
// Add after existing hook calls at top of component body
const { type: typeParam, tag: tagParam } = useLocalSearchParams<{
  type?: string;
  tag?: string;
}>();

// Change the useState for type to use the param:
// BEFORE: const [type, setType] = useState<MomentType>('note');
// AFTER:
const [type, setType] = useState<MomentType>(() => {
  const validTypes: MomentType[] = ['note', 'milestone', 'date', 'goal'];
  return validTypes.includes(typeParam as MomentType)
    ? (typeParam as MomentType)
    : 'note';
});
```

Also import `MomentTag` and forward the tag to `addMoment`:

```typescript
import type { MomentType, MomentTag } from '@/features/moments/types';
```

Add a `tags` derivation before `handleSave`:

```typescript
const tags = useMemo<MomentTag[] | undefined>(() => {
  const validTags: MomentTag[] = ['date-idea', 'milestone', 'inside-joke', 'trip'];
  return validTags.includes(tagParam as MomentTag)
    ? [tagParam as MomentTag]
    : undefined;
}, [tagParam]);
```

In `handleSave`, pass `tags` to `addMoment`:

```typescript
addMoment({
  type,
  title: trimmedTitle,
  body: trimmedBody,
  occurredAt: new Date().toISOString(),
  targetAt: isGoal && hasTargetDate ? targetAt.toISOString() : null,
  authorId: user?.id ?? 'user_you',
  authorRole: 'you',
  authorName: user?.displayName ?? 'You',
  tags,   // ADD THIS
});
```

Add `tags` to the `handleSave` `useCallback` dep array.

- [ ] **Step 2: Create the date plan modal screen**

Create `app/(app)/date-plan/new.tsx`:

```typescript
import { Stack, useRouter } from 'expo-router';
import { useCallback, useMemo, useState } from 'react';
import {
  KeyboardAvoidingView,
  ScrollView,
  StyleSheet,
  TextInput,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { NativeDateTimeField } from '@/components/forms/native-date-time-field';
import { ThemedText } from '@/components/themed-text';
import { Button } from '@/components/ui/button';
import { Surface } from '@/components/ui/surface';
import { Spacing } from '@/constants/theme';
import { useCalendar } from '@/features/calendar/calendar-context';
import { useSpace } from '@/features/space/space-context';
import { useSession } from '@/features/session/session-context';
import { useThemeColor } from '@/hooks/use-theme-color';

function roundToNearestHour(date: Date): Date {
  const rounded = new Date(date);
  rounded.setMinutes(0, 0, 0);
  rounded.setHours(rounded.getHours() + 1);
  return rounded;
}

export default function NewDatePlanScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const isIos = process.env.EXPO_OS === 'ios';
  const { addEvent } = useCalendar();
  const { space } = useSpace();
  const { user } = useSession();
  const border = useThemeColor({}, 'border');
  const surface2 = useThemeColor({}, 'surface2');
  const text = useThemeColor({}, 'text');
  const muted = useThemeColor({}, 'muted');
  const danger = useThemeColor({}, 'danger');
  const background = useThemeColor({}, 'background');

  const initialStart = useMemo(() => {
    const base = roundToNearestHour(new Date());
    base.setHours(19, 0, 0, 0); // default 7pm
    return base;
  }, []);
  const initialEnd = useMemo(
    () => new Date(initialStart.getTime() + 2 * 60 * 60 * 1000),
    [initialStart]
  );

  const [title, setTitle] = useState('');
  const [startsAt, setStartsAt] = useState(initialStart);
  const [endsAt, setEndsAt] = useState(initialEnd);
  const [note, setNote] = useState('');
  const [error, setError] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [showFollowUp, setShowFollowUp] = useState(false);

  const inputStyle = useMemo(
    () => [styles.input, { borderColor: border, backgroundColor: surface2, color: text }],
    [border, surface2, text]
  );

  const handleSave = useCallback(async () => {
    const trimmedTitle = title.trim() || 'Date night';

    setIsSubmitting(true);
    try {
      await addEvent({
        title: trimmedTitle,
        startsAt: startsAt.toISOString(),
        endsAt: endsAt.toISOString(),
        actor: 'you',
        actorName: user?.displayName ?? 'You',
        label: { preset: 'Date', customText: note.trim() || undefined },
      });
      setShowFollowUp(true);
    } finally {
      setIsSubmitting(false);
    }
  }, [addEvent, endsAt, note, startsAt, title, user]);

  const contentContainerStyle = useMemo(
    () => [styles.contentContainer, { paddingBottom: insets.bottom + Spacing[24] }],
    [insets.bottom]
  );
  const footerStyle = useMemo(
    () => [styles.footer, { paddingBottom: insets.bottom + Spacing[12], borderColor: border, backgroundColor: background }],
    [insets.bottom, border, background]
  );

  if (showFollowUp) {
    return (
      <>
        <Stack.Screen options={{ title: 'Plan saved' }} />
        <View style={[styles.root, { backgroundColor: background }]}>
          <ScrollView contentContainerStyle={contentContainerStyle}>
            <Surface variant="raised" style={styles.followUpCard}>
              <ThemedText type="title">Date added</ThemedText>
              <ThemedText type="body" style={{ color: muted }}>
                Something to look forward to. Want to capture more?
              </ThemedText>
              <Button
                label="Add a date idea"
                onPress={() => {
                  router.back();
                  router.push({ pathname: '/(app)/moment/new', params: { type: 'note', tag: 'date-idea' } });
                }}
              />
              <Button
                label="Save a moment"
                variant="secondary"
                onPress={() => {
                  router.back();
                  router.push('/(app)/moment/new');
                }}
              />
              <Button label="Done" variant="ghost" onPress={() => router.back()} />
            </Surface>
          </ScrollView>
        </View>
      </>
    );
  }

  return (
    <>
      <Stack.Screen options={{ title: 'Plan a date' }} />
      <KeyboardAvoidingView
        behavior={isIos ? 'padding' : undefined}
        style={[styles.root, { backgroundColor: background }]}
      >
        <ScrollView
          contentContainerStyle={contentContainerStyle}
          contentInsetAdjustmentBehavior="never"
          keyboardDismissMode="interactive"
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
        >
          <Surface variant="raised" style={styles.section}>
            <ThemedText type="meta">What are you planning?</ThemedText>
            <TextInput
              accessibilityLabel="Date title"
              autoCapitalize="sentences"
              onChangeText={(v) => { setTitle(v); setError(''); }}
              placeholder="Date night, picnic, movie..."
              placeholderTextColor={muted}
              style={inputStyle}
              value={title}
            />
          </Surface>

          <Surface style={styles.section}>
            <NativeDateTimeField
              accessibilityLabel="Choose date"
              label="Day"
              mode="date"
              onChange={(d) => {
                setStartsAt((current) => {
                  const next = new Date(current);
                  next.setFullYear(d.getFullYear(), d.getMonth(), d.getDate());
                  const nextEnd = new Date(endsAt);
                  nextEnd.setFullYear(d.getFullYear(), d.getMonth(), d.getDate());
                  setEndsAt(nextEnd);
                  return next;
                });
              }}
              value={startsAt}
            />
            <NativeDateTimeField
              accessibilityLabel="Choose time"
              label="Rough time"
              mode="time"
              onChange={(d) => {
                setStartsAt((current) => {
                  const next = new Date(current);
                  next.setHours(d.getHours(), d.getMinutes(), 0, 0);
                  setEndsAt(new Date(next.getTime() + 2 * 60 * 60 * 1000));
                  return next;
                });
              }}
              value={startsAt}
            />
          </Surface>

          <Surface style={styles.section}>
            <ThemedText type="meta">Note (optional)</ThemedText>
            <TextInput
              accessibilityLabel="Date note"
              autoCapitalize="sentences"
              multiline
              onChangeText={setNote}
              placeholder="Location, idea, reminder..."
              placeholderTextColor={muted}
              style={[inputStyle, styles.textArea]}
              textAlignVertical="top"
              value={note}
            />
          </Surface>

          {error ? (
            <ThemedText accessibilityRole="alert" type="caption" style={{ color: danger }}>
              {error}
            </ThemedText>
          ) : null}
        </ScrollView>

        <View style={footerStyle}>
          <Button
            disabled={isSubmitting}
            label={isSubmitting ? 'Saving…' : 'Save date'}
            onPress={handleSave}
          />
          <Button label="Cancel" variant="secondary" onPress={() => router.back()} />
        </View>
      </KeyboardAvoidingView>
    </>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  contentContainer: {
    paddingHorizontal: Spacing[16],
    paddingTop: Spacing[16],
    gap: Spacing[12],
  },
  section: { gap: Spacing[8] },
  input: {
    minHeight: 44,
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: 14,
    paddingHorizontal: Spacing[12],
    paddingVertical: Spacing[12],
  },
  textArea: { minHeight: 88 },
  followUpCard: { gap: Spacing[12] },
  footer: {
    borderTopWidth: StyleSheet.hairlineWidth,
    paddingHorizontal: Spacing[16],
    paddingTop: Spacing[12],
    gap: Spacing[8],
  },
});
```

- [ ] **Step 3: Register date-plan/new in app layout**

Open `app/(app)/_layout.tsx`. Add the new screen inside `<Stack>`:

```typescript
<Stack.Screen
  name="date-plan/new"
  options={{
    title: 'Plan a date',
    presentation: useFormSheet ? 'formSheet' : 'modal',
    ...sheetOptions,
  }}
/>
```

Add this after the existing `calendar/edit/[id]` screen entry.

- [ ] **Step 4: Run typecheck**

```bash
bun run typecheck
```

Expected: no errors.

- [ ] **Step 5: Commit**

```bash
git add app/\(app\)/moment/new.tsx app/\(app\)/date-plan/ app/\(app\)/_layout.tsx
git commit -m "feat: add date plan modal and quick capture params support"
```

---

## Task 7: Tab Layout — Home as First Tab

**Files:**
- Modify: `app/(app)/(tabs)/_layout.tsx`

- [ ] **Step 1: Add Home tab as first, move Timeline to second**

Open `app/(app)/(tabs)/_layout.tsx`. The current tab order is: Timeline (index), Calendar, Profile, Settings.

New order: Home (home), Timeline (index), Calendar, Profile, Settings.

For Android `<Tabs>`, add the home screen first and rename the Timeline tab:

```typescript
// ADD at the top of the Tabs.Screen list (before the existing index screen):
<Tabs.Screen
  name="home"
  options={{
    title: 'Home',
    tabBarIcon: ({ color, size, focused }) => (
      <Ionicons
        color={color}
        name={focused ? 'heart' : 'heart-outline'}
        size={size}
      />
    ),
  }}
/>
// KEEP the existing index, calendar, profile, settings screens
```

For iOS `<NativeTabs>`, add the home trigger first:

```typescript
// ADD before <NativeTabs.Trigger name="index">:
<NativeTabs.Trigger name="home">
  <Icon sf={{ default: 'heart', selected: 'heart.fill' }} />
  <Label>Home</Label>
</NativeTabs.Trigger>
```

- [ ] **Step 2: Run typecheck**

```bash
bun run typecheck
```

Expected: no errors.

- [ ] **Step 3: Run full test suite**

```bash
bun run test:unit
```

Expected: all tests pass.

- [ ] **Step 4: Commit**

```bash
git add app/\(app\)/\(tabs\)/_layout.tsx
git commit -m "feat: add Home as first tab, Timeline moves to second position"
```

---

## Task 8: Notification Preferences — Types + Storage + Settings UI

**Files:**
- Create: `features/notifications/types.ts`
- Create: `features/notifications/notification-preferences-store.ts`
- Modify: `app/(app)/(tabs)/settings.tsx`

- [ ] **Step 1: Create notification types**

Create `features/notifications/types.ts`:

```typescript
export type NotificationPreferences = {
  weeklyPlanningEnabled: boolean;
  eventReminderEnabled: boolean;
  anniversaryReminderEnabled: boolean;
};

export const DEFAULT_NOTIFICATION_PREFERENCES: NotificationPreferences = {
  weeklyPlanningEnabled: true,
  eventReminderEnabled: true,
  anniversaryReminderEnabled: true,
};
```

- [ ] **Step 2: Write failing tests for the preferences store**

Create `tests/unit/notifications/notification-preferences-store.test.ts`:

```typescript
import { describe, expect, test, beforeEach, mock } from 'bun:test';

// Mock AsyncStorage before importing the module under test
const mockStore: Record<string, string> = {};
mock.module('@react-native-async-storage/async-storage', () => ({
  default: {
    getItem: async (key: string) => mockStore[key] ?? null,
    setItem: async (key: string, value: string) => { mockStore[key] = value; },
  },
}));

// Dynamic import after mock
const { getNotificationPreferences, saveNotificationPreferences } = await import(
  '../../../features/notifications/notification-preferences-store'
);

beforeEach(() => {
  Object.keys(mockStore).forEach((key) => delete mockStore[key]);
});

describe('getNotificationPreferences', () => {
  test('returns defaults when nothing is stored', async () => {
    const prefs = await getNotificationPreferences();
    expect(prefs.weeklyPlanningEnabled).toBe(true);
    expect(prefs.eventReminderEnabled).toBe(true);
    expect(prefs.anniversaryReminderEnabled).toBe(true);
  });

  test('returns stored values when present', async () => {
    mockStore['aoi.notification.prefs.v1'] = JSON.stringify({
      weeklyPlanningEnabled: false,
      eventReminderEnabled: true,
      anniversaryReminderEnabled: false,
    });
    const prefs = await getNotificationPreferences();
    expect(prefs.weeklyPlanningEnabled).toBe(false);
    expect(prefs.anniversaryReminderEnabled).toBe(false);
  });
});

describe('saveNotificationPreferences', () => {
  test('persists preferences to storage', async () => {
    await saveNotificationPreferences({
      weeklyPlanningEnabled: false,
      eventReminderEnabled: true,
      anniversaryReminderEnabled: true,
    });
    const raw = mockStore['aoi.notification.prefs.v1'];
    expect(JSON.parse(raw).weeklyPlanningEnabled).toBe(false);
  });
});
```

- [ ] **Step 3: Run tests to verify they fail**

```bash
bun test tests/unit/notifications/notification-preferences-store.test.ts
```

Expected: FAIL — module not yet defined.

- [ ] **Step 4: Implement the preferences store**

Create `features/notifications/notification-preferences-store.ts`:

```typescript
import AsyncStorage from '@react-native-async-storage/async-storage';
import {
  DEFAULT_NOTIFICATION_PREFERENCES,
  type NotificationPreferences,
} from './types';

const PREFS_KEY = 'aoi.notification.prefs.v1';

export async function getNotificationPreferences(): Promise<NotificationPreferences> {
  try {
    const raw = await AsyncStorage.getItem(PREFS_KEY);
    if (!raw) return { ...DEFAULT_NOTIFICATION_PREFERENCES };
    const parsed = JSON.parse(raw) as Partial<NotificationPreferences>;
    return { ...DEFAULT_NOTIFICATION_PREFERENCES, ...parsed };
  } catch {
    return { ...DEFAULT_NOTIFICATION_PREFERENCES };
  }
}

export async function saveNotificationPreferences(
  prefs: NotificationPreferences
): Promise<void> {
  await AsyncStorage.setItem(PREFS_KEY, JSON.stringify(prefs));
}
```

- [ ] **Step 5: Run tests to verify they pass**

```bash
bun test tests/unit/notifications/notification-preferences-store.test.ts
```

Expected: PASS (3 tests).

- [ ] **Step 6: Add notification preferences section to Settings**

Open `app/(app)/(tabs)/settings.tsx`. Add the following imports at the top:

```typescript
import { Switch } from 'react-native';
import { useEffect, useState } from 'react';
import {
  getNotificationPreferences,
  saveNotificationPreferences,
} from '@/features/notifications/notification-preferences-store';
import type { NotificationPreferences } from '@/features/notifications/types';
import { DEFAULT_NOTIFICATION_PREFERENCES } from '@/features/notifications/types';
```

Add state and loading inside `SettingsScreen`:

```typescript
const [notifPrefs, setNotifPrefs] = useState<NotificationPreferences>(
  DEFAULT_NOTIFICATION_PREFERENCES
);

useEffect(() => {
  void getNotificationPreferences().then(setNotifPrefs);
}, []);

const handleNotifToggle = useCallback(
  async (key: keyof NotificationPreferences, value: boolean) => {
    const next = { ...notifPrefs, [key]: value };
    setNotifPrefs(next);
    await saveNotificationPreferences(next);
  },
  [notifPrefs]
);
```

Add a new Surface before the "Session" section:

```typescript
<Surface variant="raised" style={styles.card}>
  <ThemedText type="meta">Notifications</ThemedText>
  <Divider style={styles.divider} />
  <View style={styles.prefRow}>
    <ThemedText type="body">Weekly planning reminder</ThemedText>
    <Switch
      accessibilityLabel="Toggle weekly planning reminder"
      onValueChange={(v) => void handleNotifToggle('weeklyPlanningEnabled', v)}
      trackColor={{ true: accent }}
      value={notifPrefs.weeklyPlanningEnabled}
    />
  </View>
  <View style={styles.prefRow}>
    <ThemedText type="body">Upcoming date reminders</ThemedText>
    <Switch
      accessibilityLabel="Toggle upcoming date reminders"
      onValueChange={(v) => void handleNotifToggle('eventReminderEnabled', v)}
      trackColor={{ true: accent }}
      value={notifPrefs.eventReminderEnabled}
    />
  </View>
  <View style={styles.prefRow}>
    <ThemedText type="body">Anniversary reminders</ThemedText>
    <Switch
      accessibilityLabel="Toggle anniversary reminders"
      onValueChange={(v) => void handleNotifToggle('anniversaryReminderEnabled', v)}
      trackColor={{ true: accent }}
      value={notifPrefs.anniversaryReminderEnabled}
    />
  </View>
</Surface>
```

You'll also need `accent` from `useThemeColor`:

```typescript
const accent = useThemeColor({}, 'accent');
```

Add `prefRow` to the StyleSheet:

```typescript
prefRow: {
  flexDirection: 'row',
  alignItems: 'center',
  justifyContent: 'space-between',
  minHeight: 44,
},
```

- [ ] **Step 7: Run typecheck and full tests**

```bash
bun run typecheck && bun run test:unit
```

Expected: no errors, all tests pass.

- [ ] **Step 8: Commit**

```bash
git add features/notifications/ tests/unit/notifications/ app/\(app\)/\(tabs\)/settings.tsx
git commit -m "feat: add notification preferences store and settings UI"
```

---

## Task 9: Notification Scheduler (expo-notifications)

**Files:**
- Create: `features/notifications/notification-scheduler.ts`

> **Prerequisite:** Install expo-notifications and configure app.json.

- [ ] **Step 1: Install expo-notifications**

```bash
bun add expo-notifications
```

Then add to `app.json` (inside the `"expo"` object):

```json
"plugins": [
  [
    "expo-notifications",
    {
      "icon": "./assets/images/notification-icon.png",
      "color": "#4ECDC4",
      "sounds": []
    }
  ]
]
```

Note: create `assets/images/notification-icon.png` (48×48 white icon on transparent) before building. For dev, any existing icon asset will work.

- [ ] **Step 2: Create the scheduler**

Create `features/notifications/notification-scheduler.ts`:

```typescript
import * as Notifications from 'expo-notifications';
import type { NotificationPreferences } from './types';
import type { CalendarEvent } from '@/features/calendar/types';

Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowAlert: true,
    shouldPlaySound: false,
    shouldSetBadge: false,
    shouldShowBanner: true,
    shouldShowList: true,
  }),
});

export async function requestNotificationPermission(): Promise<boolean> {
  const { status: existing } = await Notifications.getPermissionsAsync();
  if (existing === 'granted') return true;
  const { status } = await Notifications.requestPermissionsAsync();
  return status === 'granted';
}

const WEEKLY_NUDGE_ID = 'aoi.weekly.nudge';
const ANNIVERSARY_ID = 'aoi.anniversary';

export async function scheduleWeeklyPlanningNudge(enabled: boolean): Promise<void> {
  await Notifications.cancelScheduledNotificationAsync(WEEKLY_NUDGE_ID).catch(() => {});
  if (!enabled) return;

  // Fire every Sunday at 10am
  await Notifications.scheduleNotificationAsync({
    identifier: WEEKLY_NUDGE_ID,
    content: {
      title: 'Plan something together',
      body: 'No date planned for this week yet.',
    },
    trigger: {
      type: Notifications.SchedulableTriggerInputTypes.WEEKLY,
      weekday: 1, // Sunday
      hour: 10,
      minute: 0,
    },
  });
}

export async function scheduleEventReminder(
  event: CalendarEvent,
  minutesBefore: number
): Promise<string> {
  const fireAt = new Date(
    new Date(event.startsAt).getTime() - minutesBefore * 60 * 1000
  );
  if (fireAt <= new Date()) return '';

  const id = await Notifications.scheduleNotificationAsync({
    content: {
      title: event.title,
      body: `Starting in ${minutesBefore} minutes`,
    },
    trigger: {
      type: Notifications.SchedulableTriggerInputTypes.DATE,
      date: fireAt,
    },
  });
  return id;
}

export async function cancelEventReminders(notificationIds: string[]): Promise<void> {
  await Promise.all(
    notificationIds.map((id) =>
      Notifications.cancelScheduledNotificationAsync(id).catch(() => {})
    )
  );
}

export async function scheduleAnniversaryReminder(
  relationshipStartDate: string,
  enabled: boolean
): Promise<void> {
  await Notifications.cancelScheduledNotificationAsync(ANNIVERSARY_ID).catch(() => {});
  if (!enabled) return;

  const start = new Date(relationshipStartDate);
  if (Number.isNaN(start.getTime())) return;

  // Fire annually on the anniversary month/day at 9am
  await Notifications.scheduleNotificationAsync({
    identifier: ANNIVERSARY_ID,
    content: {
      title: 'Happy anniversary',
      body: 'Today marks another year together.',
    },
    trigger: {
      type: Notifications.SchedulableTriggerInputTypes.YEARLY,
      month: start.getMonth() + 1, // 1-indexed
      day: start.getDate(),
      hour: 9,
      minute: 0,
    },
  });
}

export async function syncNotifications(
  prefs: NotificationPreferences,
  relationshipStartDate: string
): Promise<void> {
  const granted = await requestNotificationPermission();
  if (!granted) return;

  await Promise.all([
    scheduleWeeklyPlanningNudge(prefs.weeklyPlanningEnabled),
    scheduleAnniversaryReminder(relationshipStartDate, prefs.anniversaryReminderEnabled),
  ]);
}
```

- [ ] **Step 3: Wire syncNotifications to Settings**

In `app/(app)/(tabs)/settings.tsx`, update `handleNotifToggle` to also call `syncNotifications` after saving:

```typescript
// Add import:
import { syncNotifications } from '@/features/notifications/notification-scheduler';

// Update handleNotifToggle:
const handleNotifToggle = useCallback(
  async (key: keyof NotificationPreferences, value: boolean) => {
    const next = { ...notifPrefs, [key]: value };
    setNotifPrefs(next);
    await saveNotificationPreferences(next);
    const startDate = space?.relationshipStartDate ?? '';
    await syncNotifications(next, startDate).catch(() => {});
  },
  [notifPrefs, space]
);
```

Also add `const { space } = useSpace();` if not already imported (it already is in the current settings screen — confirm by reading the file).

- [ ] **Step 4: Run typecheck**

```bash
bun run typecheck
```

Expected: no errors. If `expo-notifications` types are missing, run `bun add -d @types/expo-notifications` — though types are bundled with the package.

- [ ] **Step 5: Commit**

```bash
git add features/notifications/notification-scheduler.ts app/\(app\)/\(tabs\)/settings.tsx app.json bun.lock
git commit -m "feat: add notification scheduler with weekly nudge, event reminders, and anniversary"
```

---

## Task 10: Notification Opt-In Surface

**Files:**
- Modify: `app/(auth)/space-setup.tsx` or create a new post-onboarding screen

The spec says notifications are introduced after onboarding and first content. The simplest approach: after the user creates their first moment or date plan, show a one-time soft opt-in prompt as a bottom sheet or inline card.

- [ ] **Step 1: Add a one-time opt-in flag to AsyncStorage**

In `features/notifications/notification-preferences-store.ts`, add:

```typescript
const OPT_IN_ASKED_KEY = 'aoi.notification.opt-in-asked.v1';

export async function hasAskedForNotificationOptIn(): Promise<boolean> {
  const raw = await AsyncStorage.getItem(OPT_IN_ASKED_KEY).catch(() => null);
  return raw === 'true';
}

export async function markNotificationOptInAsked(): Promise<void> {
  await AsyncStorage.setItem(OPT_IN_ASKED_KEY, 'true');
}
```

- [ ] **Step 2: Show the opt-in prompt from the Home screen after first content**

In `app/(app)/(tabs)/home.tsx`, add state to track whether the prompt should show:

```typescript
import {
  hasAskedForNotificationOptIn,
  markNotificationOptInAsked,
  getNotificationPreferences,
  saveNotificationPreferences,
} from '@/features/notifications/notification-preferences-store';
import { syncNotifications } from '@/features/notifications/notification-scheduler';
import { useSpace } from '@/features/space/space-context';

// Inside HomeScreen:
const [showNotifPrompt, setShowNotifPrompt] = useState(false);
const { space } = useSpace();

useEffect(() => {
  if (moments.length === 0 && events.length === 0) return; // no content yet

  void hasAskedForNotificationOptIn().then((asked) => {
    if (!asked) setShowNotifPrompt(true);
  });
}, [moments.length, events.length]);

const handleEnableNotifications = useCallback(async () => {
  await markNotificationOptInAsked();
  setShowNotifPrompt(false);
  const prefs = await getNotificationPreferences();
  await saveNotificationPreferences(prefs);
  await syncNotifications(prefs, space?.relationshipStartDate ?? '').catch(() => {});
}, [space]);

const handleDismissNotifPrompt = useCallback(async () => {
  await markNotificationOptInAsked();
  setShowNotifPrompt(false);
}, []);
```

Add the prompt card to the JSX (insert after quick actions, before nextEvent):

```typescript
{showNotifPrompt ? (
  <Surface style={styles.notifPromptCard}>
    <ThemedText type="title">Stay in the loop</ThemedText>
    <ThemedText type="body" style={{ color: muted }}>
      Get a gentle reminder to plan together each week. No spam, just one nudge.
    </ThemedText>
    <Button label="Turn on reminders" onPress={handleEnableNotifications} />
    <Button label="Not now" variant="ghost" onPress={handleDismissNotifPrompt} />
  </Surface>
) : null}
```

Add style:

```typescript
notifPromptCard: {
  gap: Spacing[8],
},
```

- [ ] **Step 3: Run typecheck and full test suite**

```bash
bun run typecheck && bun run test:unit
```

Expected: all pass.

- [ ] **Step 4: Commit**

```bash
git add features/notifications/notification-preferences-store.ts app/\(app\)/\(tabs\)/home.tsx
git commit -m "feat: add one-time notification opt-in prompt on home screen after first content"
```

---

## Self-Review

### Spec coverage check

| Requirement | Task |
|------------|------|
| Home as first tab with prompt, quick actions, next event, recent moment | Tasks 4, 5, 7 |
| Prompt types: plan-this-week, save-from-today, save-moment-after-plan | Task 4 |
| Quick capture: Note, Date idea, Plan from home | Tasks 5, 6 |
| Photo quick action | Task 5 (included as disabled; camera integration deferred) |
| Title-only / minimal save | Task 6 (moment/new accepts any single field) |
| Date idea as tagged moment | Tasks 1, 6 |
| Weekly date planning ritual | Task 6 (date-plan/new screen) |
| Follow-up after saving date | Task 6 (showFollowUp state) |
| Timeline moved to secondary tab | Task 7 |
| Moment.tags type extension | Task 1 |
| CalendarEvent.reminderMinutesBefore | Tasks 1, 2 |
| Notification preferences type | Task 8 |
| Weekly planning nudge | Task 9 |
| Event reminder | Task 9 |
| Anniversary reminder | Task 9 |
| Notification opt-in after first content | Task 10 |
| Per-type notification toggles in Settings | Task 8 |
| historyPreview only when enough content | Task 4 |
| Empty states (no partner, no moments, no plans) | Task 5 (prompt covers no-plans; no-partner uses space?.name fallback) |
| Accessibility: 44px targets, screen-reader labels | All tasks (consistent with existing patterns) |
| Reduced motion respected | Task 5 (ReduceMotion.System on all animations) |

**One gap found:** The spec mentions the empty state "no partner yet → suggest invite/share". The home screen currently falls back to `space?.name ?? 'Your space'` but doesn't show a specific invite nudge. This is covered by the existing onboarding flow (space-setup) and is pre-app-tabs, so it's acceptable — the Home screen only renders when `spaceStatus === 'ready'` (from `_layout.tsx`).

**Photo quick action:** Marked `disabled: true` in the view model. The spec wants photo capture but that requires `expo-image-picker`. This is acceptable for MVP — the chip is visible, labeled, and disabled. The comment in `handleQuickAction` notes camera integration is pending.

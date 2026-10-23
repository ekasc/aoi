import { readFileSync } from 'node:fs';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor, act, within } from '@testing-library/react';
import { createElement, forwardRef, useEffect, useImperativeHandle, useState } from 'react';
import { CalendarListMock } from './calendar-list-mock';

import { YEAR_SECTION_HEIGHT } from '@/components/calendar/year-section';

// Resolve press-state styles as unpressed so the real Plans screen renders
// (rows/cells compute `style={({ pressed }) => ...}`).
vi.mock('react-native', () => {
  function flattenStyle(style: unknown): unknown {
    if (Array.isArray(style)) {
      const merged: Record<string, unknown> = {};
      for (const entry of style) {
        const flat = flattenStyle(entry);
        if (flat && typeof flat === 'object') Object.assign(merged, flat);
      }
      return merged;
    }
    return style;
  }

  function withAriaProps(props: Record<string, unknown>): Record<string, unknown> {
    const next: Record<string, unknown> = { ...props };
    if (typeof props.accessibilityLabel === 'string') {
      next['aria-label'] = props.accessibilityLabel;
    }
    if (typeof props.onPress === 'function') {
      next.onClick = props.onPress;
    }
    if (typeof props.testID === 'string') {
      next['data-testid'] = props.testID;
    }
    const state = props.accessibilityState;
    if (state && typeof state === 'object' && 'busy' in state) {
      next['aria-busy'] = state.busy;
    }
    return next;
  }

  function createDiv(children: unknown, style: unknown, props: Record<string, unknown>) {
    return createElement(
      'div',
      { style: flattenStyle(style), ...withAriaProps(props) },
      children
    );
  }

  const View = (props: Record<string, unknown>) => {
    const { children, style, onLayout, ...rest } = props;
    const layouts = ((globalThis as any).__plansLayouts ??= []) as unknown[];
    layouts.push({ testID: props.testID, onLayout });
    // The platform fires onLayout after mount. Screens that size a page from
    // the space they are given depend on it, so the mock does the same instead
    // of leaving the measured path untested.
    useEffect(() => {
      if (typeof onLayout === 'function') {
        onLayout({
          nativeEvent: { layout: { height: 600, width: 390, x: 0, y: 0 } },
        });
      }
    }, [onLayout]);
    return createDiv(children, style, rest);
  };
  const Text = (props: Record<string, unknown>) => {
    const { children, style, ...rest } = props;
    return createElement(
      'span',
      { style: flattenStyle(style), ...withAriaProps(rest) },
      children
    );
  };

  const Pressable = (props: Record<string, unknown>) => {
    const { children, style, ...rest } = props;
    const resolved = typeof style === 'function' ? style({ pressed: false }) : style;
    return createDiv(children, resolved, rest);
  };

  return {
    StyleSheet: {
      create: (styles: Record<string, unknown>) => styles,
      hairlineWidth: 1,
      flatten: flattenStyle,
      absoluteFillObject: {},
    },
    View,
    Text,
    Pressable,
    ActivityIndicator: () => null,
    FlatList: CalendarListMock,
    ScrollView: forwardRef<
      { scrollTo: (options: Record<string, unknown>) => void },
      Record<string, unknown>
    >(function ScrollViewMock(props, ref) {
      const {
        children,
        style,
        onMomentumScrollEnd,
        onScroll,
        onScrollEndDrag,
        onLayout,
        testID,
        ...rest
      } = props;
      // Both pagers report a settle through the same prop, so every handler is
      // kept: the day view mounts the week strip and the hour grid, the month
      // view the month pager, and tests poke the one they mean.
      const ends = ((globalThis as any).__plansMomentumEnds ??= []) as unknown[];
      // Tagged, because both scrollers are mounted now and "last one wins"
      // would hand back whichever happens to render later.
      ends.push({ handler: onMomentumScrollEnd, testID });
      const scrollHandlers = ((globalThis as any).__plansScrollHandlers ??= []) as unknown[];
      scrollHandlers.push({ testID, onScroll, onScrollEndDrag });
      (globalThis as any).__plansMomentumEnd = onMomentumScrollEnd;
      // The real scroller reports its scroll position when one is fixed, and
      // the re-centre is only visible through that call, so the mock answers
      // it instead of swallowing it.
      useImperativeHandle(
        ref,
        () => ({
          scrollTo: (options: Record<string, unknown>) => {
            const scrolls = ((globalThis as any).__plansScrolls ??= []) as Record<
              string,
              unknown
            >[];
            scrolls.push({ testID, ...options });
          },
        }),
        [testID]
      );
      // The week strip sizes its pages from the layout it is given, so the
      // mock reports one the way the platform does.
      useEffect(() => {
        if (typeof onLayout === 'function') {
          onLayout({
            nativeEvent: { layout: { height: 600, width: 390, x: 0, y: 0 } },
          });
        }
      }, [onLayout]);
      // Marked, so a test can ask whether something sits inside a scroller.
      return createDiv(children, style, { ...rest, 'data-rn-scrollview': 'true' });
    }),
    Platform: { OS: 'ios', select: (options: { ios?: unknown }) => options.ios },
    Dimensions: { get: () => ({ width: 390, height: 844 }) },
    useWindowDimensions: () => ({
      width: mockWindowWidth,
      height: 844,
      scale: 3,
      fontScale: mockFontScale,
    }),
    AppState: {
      currentState: 'active',
      addEventListener: () => ({ remove: () => {} }),
    },
  };
});

vi.mock('react-native-reanimated', () => {
  const chain: Record<string, () => unknown> = {};
  chain.duration = () => chain;
  chain.delay = () => chain;
  chain.reduceMotion = () => chain;
  return {
    default: {
      createAnimatedComponent: (component: unknown) => component,
      View: ({ children }: { children?: unknown }) =>
        createElement('div', {}, children),
    },
    FadeIn: chain,
    FadeOut: chain,
    FadeInDown: chain,
    ReduceMotion: { System: 'system' },
    useReducedMotion: () => mockReduceMotion,
    Easing: {
      linear: {},
      in: (easing: unknown) => easing,
      out: (easing: unknown) => easing,
      inOut: (easing: unknown) => easing,
      bezier: (...points: number[]) => ({ bezier: points }),
    },
  };
});

const pushSpy = vi.fn();

vi.mock('expo-router', () => ({
  useRouter: () => ({ push: pushSpy, back: vi.fn(), replace: vi.fn() }),
  useIsFocused: () => true,
}));

vi.mock('@/components/home/memory-sky', () => ({
  MemorySky: () => null,
  // Both helpers mirror the module's own math: the working-screen band is
  // the compact strip's 0.15 cut to 0.09.
  compactSkyHeightForWindow: (windowHeight: number) => Math.round(windowHeight * 0.15) + 12,
  headerSkyHeightForWindow: (windowHeight: number) => Math.round(windowHeight * 0.09) + 12,
  SYSTEM_TAB_BAR_IOS_CLEARANCE: 50,
  SYSTEM_TAB_BAR_CONTENT_HEIGHT: 50,
  SYSTEM_TAB_BAR_BOTTOM_GAP: 8,
  systemTabBarTopOffset: (bottomInset: number) => Math.max(bottomInset, 8) + 8 + 50,
  FAB_ABOVE_BAR_GAP: 16,
  fabBottomOffset: (bottomInset: number, isIos: boolean) =>
    (isIos && bottomInset >= 50 ? bottomInset : Math.max(bottomInset, 8) + 50) + 16,
  MEMORY_SKY_COMPACT_QUARTER: 0.15,
  MEMORY_SKY_TOP_SAFETY: 12,
}));

vi.mock('react-native-safe-area-context', () => ({
  useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }),
}));

vi.mock('@/hooks/use-theme-color', () => ({
  useThemeColor: (_overrides: unknown, name?: string) =>
    name === 'warning' ? '#8a5f2b' : '#000000',
}));

// The calendar context is stateful here, not a bag of getters that mutate a
// module variable: the navigation fixes hinge on a month set from outside the
// screen re-rendering it, so the mock publishes through subscribers the way
// the provider does.
const calendarSubscribers = new Set<() => void>();
function emitCalendarChange() {
  for (const subscriber of calendarSubscribers) {
    subscriber();
  }
}

vi.mock('@/features/calendar/calendar-context', () => ({
  useCalendar: () => {
    const [, forceRender] = useState(0);
    useEffect(() => {
      const subscriber = () => forceRender((count) => count + 1);
      calendarSubscribers.add(subscriber);
      return () => {
        calendarSubscribers.delete(subscriber);
      };
    }, []);
    return {
      selectedDate: mockSelectedDate,
      visibleMonth: mockVisibleMonth,
      eventsForDay: mockEventsForDay,
      upcomingEvents: mockUpcomingEvents,
      monthReadState: (month: Date) => mockMonthReadState(month),
      isLoading: mockCalendarLoading,
      error: mockCalendarError,
      setSelectedDate: (date: Date) => {
        mockSelectedDate = date;
        // The provider moves the visible month with the day; mirror that so the
        // pager follows a selection the way it does on device.
        mockVisibleMonth = new Date(date.getFullYear(), date.getMonth(), 1);
        emitCalendarChange();
      },
      setVisibleMonth: (date: Date) => {
        mockVisibleMonth = new Date(date.getFullYear(), date.getMonth(), 1);
        emitCalendarChange();
      },
      eventsInRange: async () => [],
      refresh: refreshCalendarSpy,
    };
  },
}));

vi.mock('@/features/someday/someday-context', () => ({
  useSomeday: () => ({ openItems: mockSomedayOpen, doneItems: [] }),
}));

vi.mock('@/features/moments/moments-context', () => ({
  useMoments: () => ({ moments: [], loadGoals }),
}));

// The agenda is its own covered screen with its own tests; what is under test
// here is that Plans opens it, hands it the clock, and can put the month back.
const plansAgendaRender = vi.fn();
vi.mock('@/components/calendar/plans-agenda', () => ({
  PlansAgenda: (props: { now?: Date }) => {
    plansAgendaRender(props);
    return createElement('div', { 'data-testid': 'plans-agenda-stub' });
  },
}));

// The Someday mode is its own covered component with its own tests; what is
// under test here is that Plans renders it as the third mode and hides the
// add-event FAB while it is showing.
vi.mock('@/components/calendar/plans-someday', () => ({
  PlansSomeday: () =>
    createElement('div', { 'data-testid': 'plans-someday-stub' }),
}));

// The real control measures its track and animates a thumb; this stand-in
// keeps the tablist/tab contract the Plans tests actually query.
vi.mock('@/components/ui/segmented-control', () => ({
  SegmentedControl: ({
    accessibilityLabel,
    onChange,
    options,
    value,
  }: {
    accessibilityLabel?: string;
    onChange: (value: string) => void;
    options: { value: string; label: string }[];
    value: string;
  }) =>
    createElement(
      'div',
      { 'aria-label': accessibilityLabel, role: 'tablist' },
      ...options.map((option) =>
        createElement(
          'button',
          {
            'aria-label': option.label,
            'aria-selected': String(option.value === value),
            key: option.value,
            onClick: () => onChange(option.value),
            role: 'tab',
            type: 'button',
          },
          option.label,
        ),
      ),
    ),
}));

vi.mock('@/features/session/session-context', () => ({
  useSession: () => ({ user: { displayName: 'You', email: 'you@example.com' } }),
}));

vi.mock('@/features/space/space-context', () => ({
  useSpace: () => ({ space: mockSpace }),
}));

let mockSelectedDate = new Date(2026, 0, 15, 12, 0, 0);
let mockVisibleMonth = new Date(2026, 0, 1);
let mockEventsForDay: Record<string, any[]> = {};
let mockUpcomingEvents: any[] = [];
let mockSomedayOpen: any[] = [];
let mockCalendarLoading = false;
let mockCalendarError: string | null = null;
// The provider's read state for a month: `loaded` is a successful read,
// `loading` a read in flight, `unread` a page nobody has queried. Plans must
// only call a month empty on `loaded`, so this boundary is what the empty
// labels are asserted against. The default tracks the global loading/error
// flags the older cases drive, which is what the provider reports for the
// visible window while those are set.
function defaultMonthReadState(): 'loaded' | 'loading' | 'unread' {
  if (mockCalendarError) return 'unread';
  return mockCalendarLoading ? 'loading' : 'loaded';
}
let mockMonthReadState: (month: Date) => 'loaded' | 'loading' | 'unread' =
  defaultMonthReadState;
let mockReduceMotion = false;
let mockFontScale = 1;
let mockWindowWidth = 390;
let mockSpace: any = { relationshipStartDate: '2024-06-15' };
const refreshCalendarSpy = vi.fn(async () => {});
const loadGoals = vi.fn(async (): Promise<any[]> => []);

function makeEvent(overrides: Record<string, any> = {}) {
  return {
    id: 'event-1',
    title: 'Dinner out',
    startsAt: new Date(2026, 0, 15, 19, 0, 0).toISOString(),
    endsAt: new Date(2026, 0, 15, 21, 0, 0).toISOString(),
    allDay: false,
    actor: 'you',
    ...overrides,
  };
}

function makeUpcomingEvent(overrides: Record<string, any> = {}) {
  return {
    id: 'upcoming-1',
    title: 'Weekend getaway',
    startsAt: new Date(2030, 0, 20, 19, 0, 0).toISOString(),
    endsAt: new Date(2030, 0, 20, 21, 0, 0).toISOString(),
    allDay: false,
    actor: 'you',
    actorName: 'You',
    label: { preset: 'Date' },
    together: true,
    createdAt: new Date(2026, 0, 1).toISOString(),
    updatedAt: new Date(2026, 0, 1).toISOString(),
    ...overrides,
  };
}

// React schedules a state update made outside act on the host task queue. In
// this environment that task never runs, so it pins the fiber root and the
// whole rendered tree in memory after the test lets go of them; 58 mounts of
// this screen then walk the heap past the suite's fence. Draining the queue
// after each test releases the tree, and is what a browser does on its own.
afterEach(async () => {
  await act(async () => {});
});

beforeEach(() => {
  mockSelectedDate = new Date(2026, 0, 15, 12, 0, 0);
  mockVisibleMonth = new Date(2026, 0, 1);
  mockEventsForDay = {};
  mockUpcomingEvents = [];
  mockSomedayOpen = [];
  mockCalendarLoading = false;
  mockCalendarError = null;
  mockMonthReadState = defaultMonthReadState;
  mockFontScale = 1;
  mockWindowWidth = 390;
  mockSpace = { relationshipStartDate: '2024-06-15' };
  (globalThis as any).__plansMomentumEnds = [];
  (globalThis as any).__plansScrolls = [];
  (globalThis as any).__plansScrollHandlers = [];
  (globalThis as any).__plansLayouts = [];
  (globalThis as any).__motiViews = [];
  mockReduceMotion = false;
  calendarSubscribers.clear();
  pushSpy.mockClear();
  refreshCalendarSpy.mockClear();
  plansAgendaRender.mockClear();
  loadGoals.mockReset();
  loadGoals.mockResolvedValue([]);
});

async function renderPlans() {
  const { default: PlansScreen } = await import('@/app/(app)/(tabs)/plans');
  return render(<PlansScreen />);
}

// Only the live mode is mounted, so queries have to say which layer they
// mean. The screen lands on the month grid; a grid cell opens the day in
// place of the grid, which is where the day UI lives.
const dayLayer = () => within(screen.getByTestId('day-view'));
const monthLayer = () => within(screen.getByTestId('month-surface'));
// The day header reads "Thu – Jan 15": a short weekday, so the row it shares
// with Today and add holds one line, and the year only when the day is outside
// the current one. The fixtures sit in 2026, so the expected string is computed
// rather than frozen to a calendar year the tests cannot control.
const dayHeading = (date: Date) => {
  const rest = date.toLocaleDateString(
    'en-US',
    date.getFullYear() === new Date().getFullYear()
      ? { month: 'short', day: 'numeric' }
      : { month: 'short', day: 'numeric', year: 'numeric' },
  );
  return `${date.toLocaleDateString('en-US', { weekday: 'short' })} – ${rest}`;
};
const JAN_14 = new Date(2026, 0, 14);
const JAN_15 = new Date(2026, 0, 15);
const JAN_16 = new Date(2026, 0, 16);
const JAN_18 = new Date(2026, 0, 18);
const JAN_31 = new Date(2026, 0, 31);
// The pager mounts yesterday through tomorrow, so assertions about the day
// on screen scope to the centre page by its label.
const centerPage = (day: Date) =>
  within(screen.getByLabelText(`Day page ${dayHeading(day)}`));
// Every MotiView mount recorded by the moti stand-in; the drill-zoom tests
// read only the swap wrapper's own entries.
const drillSwaps = () =>
  (((globalThis as any).__motiViews ?? []) as { testID?: string }[]).filter(
    (view) => view.testID === 'screen-swap',
  );

/**
 * A day opens from its grid cell, so the day cases tap one the way a
 * reader does. The month underneath never moves.
 */
async function openDayView() {
  const result = await renderPlans();
  fireEvent.click(screen.getByLabelText(/^Thursday, January 15/));
  return result;
}

const PLANS_SOURCE = readFileSync('app/(app)/(tabs)/plans.tsx', 'utf8');

describe('Plans calendar', () => {
  it('says an empty month is empty once its read succeeds, and opens its composer', async () => {
    mockSpace = { relationshipStartDate: null };
    await renderPlans();

    // Empty is a successful read, not the absence of a line: the month names
    // itself and offers the one useful next step.
    expect(await screen.findByText('No plans in January 2026.')).toBeTruthy();
    fireEvent.click(screen.getByLabelText('Plan something in January 2026'));
    expect(pushSpy).toHaveBeenCalledWith({
      pathname: '/(app)/calendar/new-event',
      params: { date: '2026-01-15' },
    });
  });

  it('never calls a month empty before the read has succeeded', async () => {
    mockSpace = { relationshipStartDate: null };
    mockCalendarLoading = true;
    await renderPlans();

    expect(screen.queryByText('No plans in January 2026.')).toBeNull();

    act(() => {
      mockCalendarLoading = false;
      emitCalendarChange();
    });

    expect(await screen.findByText('No plans in January 2026.')).toBeTruthy();
  });

  it('does not call a month with plans empty', async () => {
    mockSpace = { relationshipStartDate: null };
    mockEventsForDay = { '2026-01-15': [makeEvent()] };
    await renderPlans();

    expect(screen.queryByText('No plans in January 2026.')).toBeNull();
  });

  it('never calls a month empty while its own read is in flight', async () => {
    mockSpace = { relationshipStartDate: null };
    await renderPlans();

    // January's line appears first: this proves the goal read has landed,
    // so the absence below is about the month read, not a pending goal.
    expect(await screen.findByText('No plans in January 2026.')).toBeTruthy();

    // Move to February while its window is still being read. The events in
    // hand still answer January; they say nothing about February.
    act(() => {
      mockVisibleMonth = new Date(2026, 1, 1);
      mockMonthReadState = (month) =>
        month.getFullYear() === 2026 && month.getMonth() === 1
          ? 'loading'
          : 'unread';
      emitCalendarChange();
    });
    expect(screen.queryByText('No plans in February 2026.')).toBeNull();

    // Only the successful read earns the line.
    act(() => {
      mockMonthReadState = (month) =>
        month.getFullYear() === 2026 && month.getMonth() === 1
          ? 'loaded'
          : 'unread';
      emitCalendarChange();
    });
    expect(await screen.findByText('No plans in February 2026.')).toBeTruthy();
  });

  it('leaves mounted pages outside the read window unlabelled', async () => {
    mockSpace = { relationshipStartDate: null };
    mockMonthReadState = (month) =>
      month.getFullYear() === 2026 && month.getMonth() === 0 ? 'loaded' : 'unread';
    await renderPlans();

    // The pager mounts a neighbour either side for the swipe, but the
    // provider answered only the visible month's window: a mounted page is
    // not a read page, so only January may say it is empty.
    expect(screen.getByLabelText('Month page December 2025')).toBeTruthy();
    expect(await screen.findByText('No plans in January 2026.')).toBeTruthy();
    expect(screen.queryByText('No plans in December 2025.')).toBeNull();
    expect(screen.queryByText('No plans in February 2026.')).toBeNull();
  });

  it('counts a monthiversary as content, not an empty month', async () => {
    // Started on the 15th, so January 2026 carries the mark on that day.
    await renderPlans();

    expect(
      screen.getByLabelText(/^Thursday, January 15.*anniversary/),
    ).toBeTruthy();
    expect(screen.queryByText('No plans in January 2026.')).toBeNull();
  });

  it('counts a dated goal as content, not an empty month', async () => {
    mockSpace = { relationshipStartDate: null };
    loadGoals.mockResolvedValue([
      {
        id: 'goal-1',
        title: 'Trip',
        targetAt: new Date(2026, 0, 20, 12, 0, 0).toISOString(),
      },
    ]);
    await renderPlans();

    // The mark on the day is the proof the goal read landed; only then is
    // "no plans" a statement about a month rather than about a pending read.
    expect(
      await screen.findByLabelText(/^Tuesday, January 20.*has plans/),
    ).toBeTruthy();
    expect(screen.queryByText('No plans in January 2026.')).toBeNull();
  });

  it('announces loading and failure distinctly, never an empty-month line', async () => {
    mockSpace = { relationshipStartDate: null };
    mockCalendarLoading = true;
    const { default: PlansScreen } = await import('@/app/(app)/(tabs)/plans');
    render(createElement(PlansScreen));
    expect(screen.getByLabelText('Open the year view').getAttribute('aria-busy')).toBe('true');
    expect(screen.queryByText('No plans in January 2026.')).toBeNull();
    act(() => {
      mockCalendarLoading = false;
      mockCalendarError = 'private network failure';
      emitCalendarChange();
    });
    expect(screen.getByText('Your plans could not be loaded.')).toBeTruthy();
    expect(screen.queryByText('No plans in January 2026.')).toBeNull();
    expect(screen.getByLabelText('Open the year view').getAttribute('aria-busy')).toBe('false');
  });
  it('shows the day events as strips in the cell, not a dot', async () => {
    mockEventsForDay = { '2026-01-15': [makeEvent()] };
    await renderPlans();

    // The title appears in the grid cell itself. The agenda that used to
    // repeat it below is gone: the grid is the screen now. The cell also
    // says whose plans they are, since the tint alone cannot be read out.
    expect(screen.getAllByText('Dinner out').length).toBeGreaterThanOrEqual(1);
    expect(
      screen.getByLabelText(
        'Thursday, January 15, 1 plan: 1 from your partner, anniversary',
      ),
    ).toBeTruthy();
  });

  it('says how many plans are not shown when a day holds more than two', async () => {
    mockEventsForDay = {
      '2026-01-15': [
        makeEvent({ id: 'a', title: 'Standup', startsAt: '2026-01-15T09:00:00.000Z' }),
        makeEvent({ id: 'b', title: 'Gym', startsAt: '2026-01-15T18:00:00.000Z' }),
        makeEvent({ id: 'c', title: 'Dinner', startsAt: '2026-01-15T20:00:00.000Z' }),
      ],
    };
    await renderPlans();

    // Two strips fit the cell; the rest is counted rather than dropped
    // silently, the way Calendar does it.
    expect(monthLayer().getByText('Standup')).toBeTruthy();
    expect(monthLayer().getByText('Gym')).toBeTruthy();
    expect(monthLayer().queryByText('Dinner')).toBeNull();
    expect(monthLayer().getByText('+1 more')).toBeTruthy();
  });

  it('keeps the month pill outside the ScrollView so it never scrolls away', async () => {
    await renderPlans();
    // Structural, not a source offset: however the file is arranged, the pills
    // must not sit inside a scroller. This used to compare source positions,
    // which a refactor can move without changing the answer. The month name
    // also scrolls with its page, so the pill is followed by its own control.
    expect(
      screen.getByLabelText('Open the year view').closest('[data-rn-scrollview]'),
    ).toBeNull();
    expect(PLANS_SOURCE).not.toContain('marginTop: -');
    expect(PLANS_SOURCE).not.toContain('paddingTop: -');
  });
});

describe('Plans inline year', () => {
  it('swaps the month grid for the year grid in place, without a route push', async () => {
    await renderPlans();

    fireEvent.click(screen.getByLabelText('Open the year view'));

    // The year of the visible month renders its twelve mini months where
    // the grid was; the pill now offers the way back, not another screen.
    // (month-surface is the mode container in every mode, so assert on the
    // pager's labelled pages instead.)
    expect(screen.getByLabelText('Open January 2026')).toBeTruthy();
    expect(screen.queryAllByLabelText(/Month page /)).toHaveLength(0);
    expect(screen.getByLabelText('Back to the month view')).toBeTruthy();
    expect(pushSpy).not.toHaveBeenCalledWith('/(app)/calendar/year');
  });

  it('returns to the picked month in place', async () => {
    await renderPlans();

    fireEvent.click(screen.getByLabelText('Open the year view'));
    fireEvent.click(await screen.findByLabelText('Open March 2026'));

    // Same screen: the grid is back on March, the pill names it again.
    expect(screen.getAllByLabelText(/Month page /).length).toBeLessThan(7);
    expect(screen.queryByLabelText('Open January 2026')).toBeNull();
    expect(mockVisibleMonth.getMonth()).toBe(2);
    expect(mockVisibleMonth.getFullYear()).toBe(2026);
    within(screen.getByLabelText('Open the year view')).getByText('March 2026');
  });
});

describe('Plans day view', () => {
  it('opens on the month grid, with the day one tap away', async () => {
    await renderPlans();

    // The grid is the landing: it answers "when are we free" first. No day
    // UI is mounted until a cell opens it in place.
    expect(screen.getByTestId('month-surface')).toBeTruthy();
    expect(screen.queryByTestId('day-view')).toBeNull();
    expect(screen.getByLabelText('Agenda')).toBeTruthy();
  });

  it('codes whose plan it is by strip colour, with no legend and no dots', async () => {
    mockEventsForDay = {
      '2026-01-15': [makeEvent({ title: 'Dinner out', together: true })],
    };
    await renderPlans();

    // One signal per strip: the fill. No key row explaining the colours,
    // no dots beside the titles, on the grid or in the day.
    expect(screen.queryByTestId('ownership-legend')).toBeNull();
    expect(monthLayer().getByText('Dinner out')).toBeTruthy();

    fireEvent.click(screen.getByLabelText(/^Thursday, January 15/));

    expect(screen.getByTestId('day-view')).toBeTruthy();
    expect(screen.queryByTestId('ownership-legend')).toBeNull();
    expect(PLANS_SOURCE).not.toContain('ownership-legend');
    expect(PLANS_SOURCE).not.toContain('stripDot');
  });

  it('names whose plan each event is, so colour is not the only signal', async () => {
    mockEventsForDay = {
      '2026-01-15': [
        makeEvent({ id: 'mine', title: 'Standup', isOwn: true }),
        makeEvent({ id: 'theirs', title: 'Dinner out' }),
        makeEvent({ id: 'ours', title: 'Weekend away', together: true }),
      ],
    };
    await openDayView();

    expect(dayLayer().getByText(/You · /)).toBeTruthy();
    expect(dayLayer().getByText(/Partner · /)).toBeTruthy();
    expect(dayLayer().getByText(/Together · /)).toBeTruthy();
  });

  it('says a day is still loading instead of showing it as free', async () => {
    mockCalendarLoading = true;
    await openDayView();

    expect(centerPage(JAN_15).getByText('Loading plans…')).toBeTruthy();
  });

  it('says the plans could not be loaded, and offers the retry', async () => {
    mockCalendarError = 'network down';
    await renderPlans();

    expect(screen.getByText('Your plans could not be loaded.')).toBeTruthy();
    fireEvent.click(screen.getByLabelText('Retry loading plans'));
    await waitFor(() => expect(refreshCalendarSpy).toHaveBeenCalled());
  });

  it('gets back to today from a day the reader wandered to', async () => {
    mockVisibleMonth = new Date(2026, 1, 1);
    await renderPlans();
    fireEvent.click(screen.getByLabelText(/^Tuesday, February 3/));

    fireEvent.click(
      dayLayer().getByLabelText('Back to today'),
    );

    const today = new Date();
    expect(dayLayer().getByText(dayHeading(today))).toBeTruthy();
  });

  it('leaves the next plan to the agenda instead of a banner', async () => {
    mockUpcomingEvents = [makeUpcomingEvent({ title: 'Weekend getaway' })];
    await renderPlans();

    // The month grid is the landing, with nothing above it: the next plan
    // lives in the agenda list, not in a teaser lane over the calendar.
    expect(screen.getByTestId('month-surface')).toBeTruthy();
    expect(screen.queryByLabelText(/^Next: /)).toBeNull();
    expect(PLANS_SOURCE).not.toContain('findCountdownEvent');
  });
});

describe('Plans paging windows', () => {
  it('ignores a pending day-scroll completion after Back closes the detail', async () => {
    await openDayView();
    const pendingSettle = settleHandler('day-pager');
    expect(dayLayer().getByLabelText('Back to the month view').closest('[data-rn-scrollview]')).toBeNull();
    fireEvent.click(dayLayer().getByLabelText('Back to the month view'));
    act(() => pendingSettle({ nativeEvent: { contentOffset: { x: 6 * 390 } } }));
    expect(screen.queryByTestId('day-view')).toBeNull();
    expect(mockVisibleMonth.getMonth()).toBe(0);
    fireEvent.click(screen.getByLabelText(/^Thursday, January 15/));
    act(() => pendingSettle({ nativeEvent: { contentOffset: { x: 6 * 390 } } }));
    fireEvent.click(dayLayer().getByLabelText(`Plan something on ${dayHeading(JAN_15)}`));
    expect(pushSpy).toHaveBeenCalledWith({
      pathname: '/(app)/calendar/new-event',
      params: { date: '2026-01-15' },
    });
  });
  it('stays on May and June while their reads start and finish', async () => {
    mockVisibleMonth = new Date(2027, 3, 1);
    await renderPlans();
    act(() => settleHandler('month-pager')({ nativeEvent: { contentOffset: { y: 4.2 * 600 } } }));
    (globalThis as any).__plansScrolls = [];
    act(() => { mockCalendarLoading = true; emitCalendarChange(); });
    expect(screen.getByLabelText('Open the year view').getAttribute('aria-busy')).toBe('true');
    expect(mockVisibleMonth.getMonth()).toBe(4);
    act(() => { mockCalendarLoading = false; emitCalendarChange(); });
    act(() => settleHandler('month-pager')({ nativeEvent: { contentOffset: { y: 5.2 * 600 } } }));
    act(() => { mockCalendarLoading = true; emitCalendarChange(); });
    act(() => { mockCalendarLoading = false; emitCalendarChange(); });
    expect(mockVisibleMonth.getMonth()).toBe(5);
    expect(within(screen.getByLabelText('Open the year view')).getByText('June 2027')).toBeTruthy();
    expect((globalThis as any).__plansScrolls.filter((entry: { testID?: string }) => entry.testID === 'month-pager')).toEqual([]);
  });
  it('preserves the stopped month and partial offset when the viewport resizes', async () => {
    await renderPlans();
    act(() => settleHandler('month-pager')({ nativeEvent: { contentOffset: { y: 4.4 * 600 } } }));
    (globalThis as any).__plansScrolls = [];
    const layouts = (globalThis as any).__plansLayouts;
    act(() => layouts.findLast((entry: { testID?: string }) => entry.testID === 'month-viewport')
      .onLayout({ nativeEvent: { layout: { height: 580, width: 390, x: 0, y: 0 } } }));
    const corrections = (globalThis as any).__plansScrolls.filter((entry: { testID?: string }) => entry.testID === 'month-pager');
    expect(corrections.at(-1).y).toBeCloseTo(4.4 * 580);
    expect(mockVisibleMonth.getMonth()).toBe(1);
  });
  it('updates the month button during a drag without waiting for momentum', async () => {
    await renderPlans();
    const handlers = (globalThis as any).__plansScrollHandlers;
    const month = handlers.findLast((entry: { testID?: string }) => entry.testID === 'month-pager');
    act(() => month.onScroll({ nativeEvent: { contentOffset: { y: 4 * 600 } } }));
    expect(within(screen.getByLabelText('Open the year view')).getByText('February 2026')).toBeTruthy();
    act(() => month.onScrollEndDrag({ nativeEvent: { contentOffset: { y: 4 * 600 }, velocity: { y: 0 } } }));
    expect(mockVisibleMonth.getMonth()).toBe(1);
  });

  it('extends the year window in both directions while keeping month selection reachable', async () => {
    await renderPlans();
    fireEvent.click(screen.getByLabelText('Open the year view'));

    act(() => settleHandler('year-pager')({ nativeEvent: { contentOffset: { y: 4.25 * YEAR_SECTION_HEIGHT } } }));
    expect(within(screen.getByLabelText('Back to the month view')).getByText('2028')).toBeTruthy();
    act(() => settleHandler('year-pager')({ nativeEvent: { contentOffset: { y: 4 * YEAR_SECTION_HEIGHT } } }));
    act(() => settleHandler('year-pager')({ nativeEvent: { contentOffset: { y: 0 } } }));
    act(() => settleHandler('year-pager')({ nativeEvent: { contentOffset: { y: 0 } } }));
    act(() => settleHandler('year-pager')({ nativeEvent: { contentOffset: { y: 0 } } }));
    fireEvent.click(screen.getByLabelText('Open March 2024'));
    expect(mockVisibleMonth.getFullYear()).toBe(2024);
    expect(mockVisibleMonth.getMonth()).toBe(2);
    expect(pushSpy).not.toHaveBeenCalled();
  });
  it('turns the day with a swipe, settling on the next day', async () => {
    await openDayView();
    expect(dayLayer().getByText(dayHeading(JAN_15))).toBeTruthy();

    // One page right of centre: the stopped page becomes the focused day.
    // The shared selection is untouched: the month underneath must not budge.
    // Inside the window nothing rebuilds, so there is no frame to flash.
    act(() => {
      settleHandler('day-pager')({ nativeEvent: { contentOffset: { x: 4 * 390 } } });
    });

    expect(mockSelectedDate.toDateString()).toBe(
      new Date(2026, 0, 15, 12, 0, 0).toDateString(),
    );
    expect(dayLayer().getByText(dayHeading(JAN_16))).toBeTruthy();
  });

  it('turns the day back with a swipe the other way', async () => {
    await openDayView();

    act(() => {
      settleHandler('day-pager')({ nativeEvent: { contentOffset: { x: 2 * 390 } } });
    });

    expect(mockSelectedDate.toDateString()).toBe(
      new Date(2026, 0, 15, 12, 0, 0).toDateString(),
    );
    expect(dayLayer().getByText(dayHeading(JAN_14))).toBeTruthy();
  });

  it('keeps the stopped day when the viewport width changes', async () => {
    const view = await openDayView();
    act(() => settleHandler('day-pager')({ nativeEvent: { contentOffset: { x: 4 * 390 } } }));
    (globalThis as { __plansScrolls?: unknown[] }).__plansScrolls = [];
    mockWindowWidth = 320;
    const { default: PlansScreen } = await import('@/app/(app)/(tabs)/plans');
    view.rerender(<PlansScreen />);
    const scrolls = (globalThis as { __plansScrolls?: { testID?: string; x?: number }[] }).__plansScrolls ?? [];
    expect(scrolls.filter(entry => entry.testID === 'day-pager').at(-1)?.x).toBe(4 * 320);
  });

  it('recentres the window at its edge, carrying the stopped day with it', async () => {
    await openDayView();

    // All the way to the last page: the window rebuilds around the stopped
    // day and the offset is corrected to the new centre, so the stopped day
    // stays visually still instead of flashing and snapping back.
    act(() => {
      settleHandler('day-pager')({ nativeEvent: { contentOffset: { x: 6 * 390 } } });
    });

    expect(dayLayer().getByText(dayHeading(JAN_18))).toBeTruthy();
    const scrolls = ((globalThis as any).__plansScrolls ?? []) as {
      testID?: string;
      x?: number;
    }[];
    const dayScrolls = scrolls.filter((scroll) => scroll.testID === 'day-pager');
    expect(dayScrolls.length).toBeGreaterThan(0);
    expect(dayScrolls.at(-1)?.x).toBe(3 * 390);
  });

  it('keeps offscreen day pages out of the accessibility tree', async () => {
    await openDayView();

    // The pager mounts a bounded window of pages for the swipe, and a screen
    // reader must meet one day: the side pages' duplicated actions would read
    // as phantom days. Queried structurally, not through the accessible tree.
    const pages = Array.from(
      screen.getByTestId('day-view').querySelectorAll('[aria-label^="Day page"]'),
    );
    expect(pages.length).toBeGreaterThan(0);
    expect(pages.length).toBeLessThan(7);
    expect(
      pages.filter((page) => page.getAttribute('aria-hidden') === 'true'),
    ).toHaveLength(pages.length - 1);
  });

  it('exposes the settled day to assistive tech, never a hardcoded page', async () => {
    await openDayView();

    // The regression: exposure was hardcoded to page index 1 while the
    // window centers on index 3, so screen readers met day anchor-2 while
    // the sighted day sat elsewhere.
    const exposedDayLabels = () =>
      Array.from(
        screen.getByTestId('day-view').querySelectorAll('[aria-label^="Day page"]'),
      )
        .filter((page) => page.getAttribute('aria-hidden') !== 'true')
        .map((page) => page.getAttribute('aria-label'));
    expect(exposedDayLabels()).toEqual([`Day page ${dayHeading(JAN_15)}`]);

    act(() => {
      settleHandler('day-pager')({ nativeEvent: { contentOffset: { x: 4 * 390 } } });
    });

    expect(exposedDayLabels()).toEqual([`Day page ${dayHeading(JAN_16)}`]);
  });

  it('expands the day\u2019s goals inline instead of ejecting to Agenda', async () => {
    loadGoals.mockResolvedValue([
      { id: 'g1', title: 'Buy flights', targetAt: '2026-01-15T12:00:00.000Z' },
    ]);
    await openDayView();

    // Goals open where the day is, with collapsing as the way back: no
    // mode swap, no stranded day.
    await waitFor(() =>
      expect(
        dayLayer().getByLabelText(`Show goals for ${dayHeading(JAN_15)}`),
      ).toBeTruthy(),
    );
    fireEvent.click(dayLayer().getByLabelText(`Show goals for ${dayHeading(JAN_15)}`));
    expect(dayLayer().getByText('Buy flights')).toBeTruthy();
    // Still on the day: the grid underneath unmoved.
    expect(screen.getByTestId('day-view')).toBeTruthy();
    expect(screen.getByTestId('month-surface')).toBeTruthy();

    fireEvent.click(dayLayer().getByLabelText(`Hide goals for ${dayHeading(JAN_15)}`));
    expect(dayLayer().queryByText('Buy flights')).toBeNull();
  });

  it('names event times in screen-reader labels, even on short blocks', async () => {
    mockEventsForDay = {
      '2026-01-15': [
        makeEvent({
          id: 'short',
          title: 'Standup',
          startsAt: '2026-01-15T09:00:00.000Z',
          endsAt: '2026-01-15T09:20:00.000Z',
        }),
      ],
    };
    await openDayView();

    // A 20-minute block hides its caption visually; the label must still
    // carry the range, in whatever timezone the device renders.
    const label =
      dayLayer().getByLabelText(/Open Standup/).getAttribute('aria-label') ?? '';
    expect(label).toMatch(/\d{1,2}:\d{2}.*to/);
  });

  it('lands empty days at morning instead of midnight', async () => {
    await openDayView();

    // The pager mounts before its measured height lands, so each timeline
    // lands imperatively on first layout. Empty days open at 7am
    // (initialScrollHour), not stuck at the top.
    const scrolls = ((globalThis as any).__plansScrolls ?? []) as {
      testID?: string;
      x?: number;
      y?: number;
    }[];
    const landings = scrolls.filter(
      (scroll) => scroll.testID === 'day-timeline' && scroll.y === 7 * 64,
    );
    expect(landings.length).toBeGreaterThan(0);
  });

  it('offers a quiet entry point on empty days', async () => {
    await openDayView();

    const cta = dayLayer().getByLabelText(`Plan something on ${dayHeading(JAN_15)}`);
    expect(cta).toBeTruthy();
    fireEvent.click(cta);
    expect(pushSpy).toHaveBeenCalledWith({
      pathname: '/(app)/calendar/new-event',
      params: { date: '2026-01-15' },
    });
    // The composer is a route above the screen, so the day stays exactly
    // as it was: going back from the composer returns to it.
    expect(screen.getByTestId('day-view')).toBeTruthy();
  });

  it('says the empty day once, in a short line beside its entry point', async () => {
    await openDayView();

    // One factual line, not a paragraph: the button carries the invitation.
    // (Jan 15 is not today, so the non-today line shows here. Neighbouring
    // empty days say the same, so scope to the settled page.)
    expect(
      centerPage(JAN_15).getByText('No plans for this day.'),
    ).toBeTruthy();
    expect(
      dayLayer().getByLabelText(`Plan something on ${dayHeading(JAN_15)}`),
    ).toBeTruthy();
  });

  it('hides the entry point once the day has plans', async () => {
    mockEventsForDay = {
      '2026-01-15': [makeEvent()],
    };
    await openDayView();

    // The settled page (Thursday) has plans, so its own entry point is
    // gone — neighbouring empty days keep theirs.
    const thursday = centerPage(JAN_15);
    expect(
      thursday.queryByLabelText(`Plan something on ${dayHeading(JAN_15)}`),
    ).toBeNull();
  });

  it('opens the edit screen with the day left in place', async () => {
    mockEventsForDay = {
      '2026-01-15': [makeEvent()],
    };
    await openDayView();

    // The edit screen is a route above the day, the way the composer is:
    // the day stays mounted underneath, and back returns to it.
    fireEvent.click(dayLayer().getByLabelText(/Open Dinner out/));
    expect(pushSpy).toHaveBeenCalledWith('/(app)/calendar/edit/event-1');
    expect(screen.getByTestId('day-view')).toBeTruthy();
  });

  it('adds another plan to a populated day without losing the day', async () => {
    mockEventsForDay = { '2026-01-15': [makeEvent()] };
    await openDayView();

    fireEvent.click(dayLayer().getByLabelText(
      `Add a plan on ${dayHeading(JAN_15)}`,
    ));
    expect(pushSpy).toHaveBeenCalledWith({
      pathname: '/(app)/calendar/new-event',
      params: { date: '2026-01-15' },
    });
    fireEvent.click(dayLayer().getByLabelText(
      'Back to the month view',
    ));
    fireEvent.click(screen.getByLabelText(/^Thursday, January 15/));
    fireEvent.click(dayLayer().getByLabelText(/Open Dinner out/));
    expect(pushSpy).toHaveBeenLastCalledWith('/(app)/calendar/edit/event-1');
  });

  it('keeps yesterday and tomorrow mounted, so a swipe never lands blank', async () => {
    mockEventsForDay = {
      '2026-01-15': [
        makeEvent({ id: 'a', title: 'Standup', startsAt: '2026-01-15T09:00:00.000Z' }),
      ],
      '2026-01-16': [
        makeEvent({ id: 'b', title: 'Gym', startsAt: '2026-01-16T18:00:00.000Z' }),
      ],
    };
    await openDayView();

    // Both pages are in the tree before any swipe: the neighbour's plans
    // are already there when the page stops.
    expect(dayLayer().getByText('Standup')).toBeTruthy();
    expect(dayLayer().getByText('Gym')).toBeTruthy();
  });

  const settleHandler = (testID: string) => {
    const ends = ((globalThis as any).__plansMomentumEnds ?? []) as {
      handler?: unknown;
      testID?: string;
    }[];
    // The latest, not the first: each render re-registers the handler with
    // fresh state, and the mount-time one closes over an empty window.
    const entry = [...ends]
      .reverse()
      .find(
        (item) => item?.testID === testID && typeof item.handler === 'function',
      );
    expect(entry, `no momentum handler on ${testID}`).toBeTruthy();
    return entry!.handler as (event: unknown) => void;
  };

  it('re-centres the month pager so the list never runs out of months', async () => {
    await renderPlans();

    const labelsBefore = screen
      .getAllByLabelText(/Month page /)
      .map((el) => el.getAttribute('aria-label'));
    // A bounded window, not the whole reachable horizon: the anchor month is
    // mounted, the far months are not.
    expect(labelsBefore.length).toBeLessThan(7);
    expect(labelsBefore).toContain('Month page January 2026');

    // Settle on the last page. Without re-centring the reader is now walled in
    // three months from where they started; with it, that month becomes the
    // anchor and there is a fresh window either side.
    act(() => {
      settleHandler('month-pager')({ nativeEvent: { contentOffset: { y: 6 * 600 } } });
    });

    const labelsAfter = screen
      .getAllByLabelText(/Month page /)
      .map((el) => el.getAttribute('aria-label'));
    expect(labelsAfter.length).toBeLessThan(7);
    expect(labelsAfter).toContain('Month page April 2026');
    expect(labelsAfter).not.toContain('Month page October 2025');
  });

  it('moves the header and the loaded month with the page that settled', async () => {
    await renderPlans();

    // One page over: still inside the delivered window. The header and the
    // loaded data follow the settle, while the window itself stays put —
    // rebuilding it here is what used to flash the wrong month.
    act(() => {
      settleHandler('month-pager')({ nativeEvent: { contentOffset: { y: 4 * 600 } } });
    });

    expect(
      within(screen.getByLabelText('Open the year view')).getByText('February 2026'),
    ).toBeTruthy();
    const labels = screen
      .getAllByLabelText(/Month page /)
      .map((el) => el.getAttribute('aria-label'));
    expect(labels.length).toBeLessThan(7);
    expect(labels).toContain('Month page January 2026');
    expect(labels).toContain('Month page February 2026');
    expect(mockVisibleMonth.getMonth()).toBe(1);
    expect(mockVisibleMonth.getFullYear()).toBe(2026);
  });

  it('issues no correction scroll for a settle inside the window', async () => {
    await renderPlans();

    // A fractional settle between months must not move the native offset:
    // any scroll here would be the flash-and-snap-back.
    (globalThis as any).__plansScrolls = [];
    act(() => {
      settleHandler('month-pager')({ nativeEvent: { contentOffset: { y: 4.4 * 600 } } });
    });

    const scrolls = (globalThis as any).__plansScrolls as {
      testID?: string;
    }[];
    expect(scrolls.filter((entry) => entry.testID === 'month-pager')).toHaveLength(0);
    // ...while the header still names the settled month.
    expect(
      within(screen.getByLabelText('Open the year view')).getByText('February 2026'),
    ).toBeTruthy();
  });

  it('adopts a month chosen outside the screen instead of overwriting it', async () => {
    await renderPlans();

    // The year view hands a month back by setting the context, not by moving
    // the pager. The screen has to follow that, not push its old month back.
    act(() => {
      mockVisibleMonth = new Date(2026, 8, 1);
      emitCalendarChange();
    });

    expect(
      within(screen.getByLabelText('Open the year view')).getByText('September 2026'),
    ).toBeTruthy();
    const labels = screen
      .getAllByLabelText(/Month page /)
      .map((el) => el.getAttribute('aria-label'));
    expect(labels).toContain('Month page September 2026');
    // The old anchor was not written back over the chosen month.
    expect(mockVisibleMonth.getMonth()).toBe(8);
    expect(mockVisibleMonth.getFullYear()).toBe(2026);
  });

  it('keeps the mid-page offset when the window recentres, instead of snapping to the month top', async () => {
    await renderPlans();

    // The pager is a free scroll, so a settle can stop between two pages,
    // here 40% past the window's last page. That page is the month on
    // screen, and the offset belongs to the reader: re-centring at the edge
    // must carry the fraction so the stopped content does not jump.
    (globalThis as any).__plansScrolls = [];
    act(() => {
      settleHandler('month-pager')({ nativeEvent: { contentOffset: { y: 6.4 * 600 } } });
    });

    const scrolls = (globalThis as any).__plansScrolls as {
      testID?: string;
      y?: number;
    }[];
    const recentre = scrolls.find((entry) => entry.testID === 'month-pager');
    expect(recentre).toBeTruthy();
    // Centre page (3) plus the fraction the settle carried (0.4), not 3.
    expect(recentre!.y).toBeCloseTo(600 * 3.4);
    // The rebuilt window is centred on the stopped month, April.
    const labels = screen
      .getAllByLabelText(/Month page /)
      .map((el) => el.getAttribute('aria-label'));
    expect(labels).toContain('Month page April 2026');
  });

  it('leaves the month exactly where it was while the day pager moves', async () => {
    await openDayView();

    // Swipe the day on: the pager follows, the month underneath must not
    // budge, or going back would land somewhere new.
    act(() => {
      settleHandler('day-pager')({ nativeEvent: { contentOffset: { x: 4 * 390 } } });
    });
    expect(dayLayer().getByText(dayHeading(JAN_16))).toBeTruthy();
    expect(screen.getByTestId('month-surface')).toBeTruthy();
    expect(mockSelectedDate.toDateString()).toBe(
      new Date(2026, 0, 15, 12, 0, 0).toDateString(),
    );

    fireEvent.click(dayLayer().getByLabelText('Back to the month view'));

    // Going back returns to the untouched month: same page, same selection,
    // same pill.
    expect(screen.queryByTestId('day-view')).toBeNull();
    expect(screen.getByTestId('month-surface')).toBeTruthy();
    expect(mockSelectedDate.toDateString()).toBe(
      new Date(2026, 0, 15, 12, 0, 0).toDateString(),
    );
    expect(
      within(screen.getByLabelText('Open the year view')).getByText('January 2026'),
    ).toBeTruthy();
  });

  it('moves the pill month with the day across a boundary', async () => {
    await renderPlans();
    fireEvent.click(screen.getByLabelText(/^Saturday, January 31/));
    expect(dayLayer().getByText(dayHeading(JAN_31))).toBeTruthy();

    // Swiping onto February moves the screen's month with the day, so the
    // loaded window and the grid underneath agree on where the reader is.
    // The pill proves it on the way back: February, not the January the
    // screen opened on.
    act(() => {
      settleHandler('day-pager')({ nativeEvent: { contentOffset: { x: 6 * 390 } } });
    });
    fireEvent.click(
      dayLayer().getByLabelText('Back to the month view'),
    );
    expect(
      within(screen.getByLabelText('Open the year view')).getByText('February 2026'),
    ).toBeTruthy();
  });

  it('switches modes from the returned month', async () => {
    await openDayView();
    fireEvent.click(
      dayLayer().getByLabelText('Back to the month view'),
    );

    // The control lives on the month: back first, then switch. The day
    // does not trail along.
    // (The ScrollView mock drops testIDs, so the agenda proves itself
    // through its surface and its stubbed content, the way the other
    // mode tests do.)
    fireEvent.click(screen.getByLabelText('Agenda'));
    expect(screen.queryByTestId('day-view')).toBeNull();
    expect(screen.getByTestId('agenda-surface')).toBeTruthy();
    expect(screen.getByTestId('plans-agenda-stub')).toBeTruthy();
  });

  it('stands the view control down while a day is open', async () => {
    await openDayView();

    // Back is the way out: the three-way control waits on the month.
    expect(screen.queryByRole('tablist')).toBeNull();

    fireEvent.click(
      dayLayer().getByLabelText('Back to the month view'),
    );
    expect(screen.getByRole('tablist', { name: 'Plans view' })).toBeTruthy();
  });

  it('keeps the month mounted beneath the rising day', async () => {
    await openDayView();

    // Covered, not gone: the grid keeps its scroll position and costs no
    // remount — but it leaves the accessibility tree to the curtain.
    expect(screen.getByTestId('day-view')).toBeTruthy();
    expect(screen.getByTestId('month-surface')).toBeTruthy();
    expect(
      screen.getByTestId('month-surface').closest('[aria-hidden="true"]'),
    ).toBeTruthy();

    fireEvent.click(
      dayLayer().getByLabelText('Back to the month view'),
    );
    expect(screen.queryByTestId('day-view')).toBeNull();
    expect(screen.getByTestId('month-surface')).toBeTruthy();
    expect(
      screen.getByTestId('month-surface').closest('[aria-hidden="true"]'),
    ).toBeNull();
  });

  it('reveals the day on open', async () => {
    await openDayView();

    // The curtain rises from the bottom edge over the standing month:
    // one mount, transform-only, no scale, no fade.
    expect(drillSwaps()).toHaveLength(1);
    expect(drillSwaps()[0].from).toEqual({ translateY: 844 });
    expect(drillSwaps()[0].animate).toEqual({ translateY: 0 });
    expect(drillSwaps()[0].exit).toEqual({ translateY: 844 });
    expect(drillSwaps()[0].transition).toMatchObject({ type: 'timing', duration: 300 });
  });

  it('sinks the curtain on the way back, remounting nothing', async () => {
    await openDayView();
    fireEvent.click(
      dayLayer().getByLabelText('Back to the month view'),
    );

    // Going back runs the same mount's exit: the curtain sinks through the
    // bottom edge, uncovering the month that never moved. No second mount,
    // no month replay.
    expect(drillSwaps()).toHaveLength(1);
    expect(drillSwaps()[0].exit).toEqual({ translateY: 844 });
    expect(screen.queryByTestId('day-view')).toBeNull();
    expect(screen.getByTestId('month-surface')).toBeTruthy();
  });

  it('swaps instantly under reduced motion', async () => {
    mockReduceMotion = true;
    await openDayView();

    // No zoom entries at all: the day is simply there.
    expect(drillSwaps()).toHaveLength(0);
    expect(dayLayer().getByText(dayHeading(JAN_15))).toBeTruthy();
  });
});

describe('Plans adaptation', () => {
  it('lets the date own the day heading, with no week-number stamp', async () => {
    await openDayView();

    // The heading is short enough to hold one line beside Today and add: an
    // abbreviated weekday, and the year only when the day leaves this one.
    expect(dayLayer().getByText(dayHeading(JAN_15))).toBeTruthy();
    expect(dayLayer().queryByText(/^Thursday –/)).toBeNull();
    // The W38 stamp is gone: it is productivity-calendar vocabulary, and it
    // was taking width off the one label that says which day this is.
    expect(screen.queryByText(/^W\d+$/)).toBeNull();
  });

  it('prints a plan title where the column can hold it', async () => {
    mockEventsForDay = {
      '2026-01-15': [makeEvent({ title: 'Dinner out', together: true })],
    };
    await renderPlans();

    expect(monthLayer().getAllByText('Dinner out').length).toBeGreaterThanOrEqual(1);
  });

  it('prints a shared plan title on the narrowest phone now that dots are gone', async () => {
    mockEventsForDay = {
      '2026-01-15': [makeEvent({ title: 'Dinner out', together: true })],
    };
    // The narrowest phone used to leave a shared strip two dots and about
    // three characters of room, so it drew as a bar. With the dots gone the
    // title fits, and the fill colour alone says whose plan it is.
    mockWindowWidth = 320;
    await renderPlans();

    expect(monthLayer().getByText('Dinner out')).toBeTruthy();
    expect(
      monthLayer().getByLabelText(
        'Thursday, January 15, 1 plan: 1 together, anniversary',
      ),
    ).toBeTruthy();
  });

  it('draws fewer strips per cell as text scales, counting the rest', async () => {
    mockEventsForDay = {
      '2026-01-15': [
        makeEvent({ id: 'a', title: 'Standup', startsAt: '2026-01-15T09:00:00.000Z' }),
        makeEvent({ id: 'b', title: 'Gym', startsAt: '2026-01-15T18:00:00.000Z' }),
        makeEvent({ id: 'c', title: 'Dinner', startsAt: '2026-01-15T20:00:00.000Z' }),
      ],
    };
    mockFontScale = 2;
    await renderPlans();

    // A cell is a fixed slice of a six-row grid, so at 2x text not one strip
    // fits without reaching into the week below. The count carries the news
    // instead, and the cell label still names every plan for a screen reader.
    expect(monthLayer().queryByText('Standup')).toBeNull();
    expect(monthLayer().queryByText('Gym')).toBeNull();
    expect(monthLayer().getByText('+3 more')).toBeTruthy();
  });
});

describe('Plans press handling', () => {
  it('swallows the tap that releases a long-press on the same day', async () => {
    const { LONG_PRESS_SUPPRESS_MS, noteLongPress, takeTap } = await import(
      '@/app/(app)/(tabs)/plans'
    );
    const log: Record<string, number> = {};
    noteLongPress(log, '2026-01-15', 1000);
    // The release right after the hold is the same gesture, not a tap.
    expect(takeTap(log, '2026-01-15', 1000 + LONG_PRESS_SUPPRESS_MS - 1)).toBe(false);
  });

  it('lets later taps through, and never crosses days', async () => {
    const { LONG_PRESS_SUPPRESS_MS, noteLongPress, takeTap } = await import(
      '@/app/(app)/(tabs)/plans'
    );
    const log: Record<string, number> = {};
    // No long-press on record: an ordinary tap always acts.
    expect(takeTap(log, '2026-01-15', 2000)).toBe(true);
    noteLongPress(log, '2026-01-15', 2000);
    // Past the window it is a real tap again, even on the same day.
    expect(takeTap(log, '2026-01-15', 2000 + LONG_PRESS_SUPPRESS_MS + 1)).toBe(true);
    noteLongPress(log, '2026-01-15', 3000);
    // Another day's tap is never the release of this hold.
    expect(takeTap(log, '2026-01-16', 3100)).toBe(true);
  });
});

// Motion is not what these tests are about: render the element and drop the
// animation props, so the tree is the same with or without a transition.
// Mounts are recorded too, so the drill-zoom tests can pin direction and
// timing without asserting on animation frames.
vi.mock('moti', () => ({
  AnimatePresence: ({ children }: { children?: unknown }) => children,
  MotiView: ({ children, ...rest }: Record<string, unknown>) => {
    const { animate, exit, exitTransition, from, transition, testID, ...props } = rest;
    // Mount-only: a re-render is not a replay, so recording in the body
    // would count one zoom several times over.
    useEffect(() => {
      const views = ((globalThis as any).__motiViews ??= []) as unknown[];
      views.push({ from, animate, exit, exitTransition, transition, testID });
    }, []);
    const style = (props as { style?: unknown }).style;
    const flat = Array.isArray(style)
      ? Object.assign({}, ...style.filter(Boolean))
      : style;
    // Moti's view is a div in these tests, so a testID has to be mapped the
    // way the platform maps it or the layers cannot be told apart.
    return createElement(
      'div',
      { ...props, ...(typeof testID === 'string' ? { 'data-testid': testID } : null), style: flat },
      children as never,
    );
  },
}));

describe('Plans view control', () => {
  it('offers one three-way control for the modes, with the active one selected', async () => {
    await renderPlans();

    // A single tablist names the screen's modes: Month, Agenda, Someday.
    const view = screen.getByRole('tablist', { name: 'Plans view' });
    expect(within(view).getByRole('tab', { name: 'Month' })).toBeTruthy();
    expect(within(view).getByRole('tab', { name: 'Agenda' })).toBeTruthy();
    expect(within(view).getByRole('tab', { name: 'Someday' })).toBeTruthy();
    expect(
      within(view).getByRole('tab', { name: 'Month' }).getAttribute('aria-selected'),
    ).toBe('true');
    expect(
      within(view).getByRole('tab', { name: 'Agenda' }).getAttribute('aria-selected'),
    ).toBe('false');
  });

  it('steps from the month into the agenda and back to the month', async () => {
    mockUpcomingEvents = [makeUpcomingEvent({ title: 'Weekend getaway' })];
    await renderPlans();

    // The month grid is still the landing, with no banner above it.
    expect(screen.getByTestId('month-surface')).toBeTruthy();
    expect(screen.queryByTestId('agenda-surface')).toBeNull();

    fireEvent.click(screen.getByRole('tab', { name: 'Agenda' }));

    expect(screen.queryByTestId('month-surface')).toBeNull();
    expect(screen.getByTestId('agenda-surface')).toBeTruthy();
    // One agenda, mounted once, handed the screen's clock so its day labels
    // are the ones the reader is living in.
    expect(screen.getAllByTestId('plans-agenda-stub').length).toBe(1);
    expect(plansAgendaRender.mock.calls.at(-1)?.[0]).toEqual(
      expect.objectContaining({ now: expect.any(Date) }),
    );
    // The same control puts the month back: a mode is chosen, not toggled.
    fireEvent.click(screen.getByRole('tab', { name: 'Month' }));

    expect(screen.getByTestId('month-surface')).toBeTruthy();
    expect(screen.queryByTestId('agenda-surface')).toBeNull();
  });

  it('shows Someday as a third mode and stands the add-event FAB down', async () => {
    await renderPlans();

    expect(screen.getByLabelText('Add an event')).toBeTruthy();
    fireEvent.click(screen.getByRole('tab', { name: 'Someday' }));

    expect(screen.queryByTestId('month-surface')).toBeNull();
    expect(screen.queryByTestId('agenda-surface')).toBeNull();
    expect(screen.getByTestId('someday-surface')).toBeTruthy();
    expect(screen.getByTestId('plans-someday-stub')).toBeTruthy();
    // Someday carries its own quick-add, so the event FAB is gone.
    expect(screen.queryByLabelText('Add an event')).toBeNull();

    fireEvent.click(screen.getByRole('tab', { name: 'Month' }));
    expect(screen.getByTestId('month-surface')).toBeTruthy();
    expect(screen.getByLabelText('Add an event')).toBeTruthy();
  });

  it('adds no search or profile controls to the header', async () => {
    await renderPlans();
    expect(screen.queryByLabelText('Search')).toBeNull();
    expect(screen.queryByLabelText('Profile')).toBeNull();

    fireEvent.click(screen.getByRole('tab', { name: 'Agenda' }));
    expect(screen.queryByLabelText('Search')).toBeNull();
    expect(screen.queryByLabelText('Profile')).toBeNull();
  });
});

describe('Plans motion', () => {
  it('mounts modes instantly with no entrance motion, and honours reduced motion in the day timeline', () => {
    // Mode switches mount fresh with no arrival choreography and no exit
    // ensemble: the drill zoom is the only sanctioned motion, and it
    // stands down under reduced motion (or before the first drill).
    expect(PLANS_SOURCE).toContain('AnimatePresence');
    expect(PLANS_SOURCE).toContain('screen-swap');
    // Custom iOS-sheet curve, never a built-in: built-ins read generic
    // next to the Apple zoom this drill mimics.
    expect(PLANS_SOURCE).toContain('Easing.bezier(0.32, 0.72, 0, 1)');
    expect(PLANS_SOURCE).toContain('reduceMotion || drillSeq === 0');

    const timelineSource = readFileSync(
      'components/calendar/day-timeline.tsx',
      'utf8',
    );
    expect(timelineSource).toContain('useReducedMotion');
    expect(timelineSource).toContain('reduceMotion ? 0 :');
    // Events arrive in order rather than all at once.
    expect(timelineSource).toContain('Math.min(index, 8) * 34');
  });
});

import { readFileSync } from 'node:fs';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor, act, within } from '@testing-library/react';
import { createElement, forwardRef, useEffect, useImperativeHandle, useState } from 'react';

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
    ScrollView: forwardRef<
      { scrollTo: (options: Record<string, unknown>) => void },
      Record<string, unknown>
    >(function ScrollViewMock(props, ref) {
      const {
        children,
        style,
        onMomentumScrollEnd,
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
    Modal: View,
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
    useReducedMotion: () => false,
    Easing: {
      linear: {},
      in: (easing: unknown) => easing,
      out: (easing: unknown) => easing,
      inOut: (easing: unknown) => easing,
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
      refresh: refreshCalendarSpy,
    };
  },
}));

vi.mock('@/features/proposals/proposals-context', () => ({
  useProposals: () => ({
    proposals: mockProposals,
    accept: acceptProposalSpy,
    decline: declineProposalSpy,
    reload: vi.fn(async () => {}),
  }),
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
let mockProposals: any[] = [];
let mockSomedayOpen: any[] = [];
let mockCalendarLoading = false;
let mockCalendarError: string | null = null;
let mockFontScale = 1;
let mockWindowWidth = 390;
let mockSpace: any = { relationshipStartDate: '2024-06-15' };
const refreshCalendarSpy = vi.fn(async () => {});
const acceptProposalSpy = vi.fn(async () => {});
const declineProposalSpy = vi.fn(async () => {});
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

beforeEach(() => {
  mockSelectedDate = new Date(2026, 0, 15, 12, 0, 0);
  mockVisibleMonth = new Date(2026, 0, 1);
  mockEventsForDay = {};
  mockUpcomingEvents = [];
  mockProposals = [];
  mockSomedayOpen = [];
  mockCalendarLoading = false;
  mockCalendarError = null;
  mockFontScale = 1;
  mockWindowWidth = 390;
  mockSpace = { relationshipStartDate: '2024-06-15' };
  (globalThis as any).__plansMomentumEnds = [];
  (globalThis as any).__plansScrolls = [];
  calendarSubscribers.clear();
  pushSpy.mockClear();
  refreshCalendarSpy.mockClear();
  acceptProposalSpy.mockClear();
  declineProposalSpy.mockClear();
  plansAgendaRender.mockClear();
  loadGoals.mockReset();
  loadGoals.mockResolvedValue([]);
});

async function renderPlans() {
  const { default: PlansScreen } = await import('@/app/(app)/(tabs)/plans');
  return render(<PlansScreen />);
}

// Only the live mode is mounted, so queries have to say which layer they
// mean. The screen lands on the month grid; a grid cell lifts the day into
// the sheet, which is where the day UI lives.
const dayLayer = () => within(screen.getByTestId('day-sheet'));
const monthLayer = () => within(screen.getByTestId('month-surface'));
// The pager mounts yesterday through tomorrow, so assertions about the day
// on screen scope to the centre page by its label.
const centerPage = (heading: string) =>
  within(screen.getByLabelText(`Day page ${heading}`));

/**
 * A day is a grid cell lifted into the sheet, so the day cases tap one the
 * way a reader does. The month underneath never moves.
 */
async function openDaySheet() {
  const result = await renderPlans();
  fireEvent.click(screen.getByLabelText(/^Thursday, January 15/));
  return result;
}

const PLANS_SOURCE = readFileSync('app/(app)/(tabs)/plans.tsx', 'utf8');

describe('Plans calendar', () => {
  it('identifies an empty visible month without mistaking neighbouring plans for its own', async () => {
    mockEventsForDay = { '2025-12-31': [makeEvent()], '2026-02-01': [makeEvent()] };
    const { default: PlansScreen } = await import('@/app/(app)/(tabs)/plans');
    render(createElement(PlansScreen));
    expect(screen.getByText('No confirmed plans this month.')).toBeTruthy();
    act(() => {
      mockEventsForDay = { '2026-01-15': [makeEvent()] };
      emitCalendarChange();
    });
    expect(screen.queryByText('No confirmed plans this month.')).toBeNull();
  });

  it('does not call the month empty while loading or failed', async () => {
    mockCalendarLoading = true;
    const { default: PlansScreen } = await import('@/app/(app)/(tabs)/plans');
    render(createElement(PlansScreen));
    expect(screen.getByText('Loading plans…')).toBeTruthy();
    expect(screen.queryByText('No confirmed plans this month.')).toBeNull();
    act(() => {
      mockCalendarLoading = false;
      mockCalendarError = 'private network failure';
      emitCalendarChange();
    });
    expect(screen.getByText('Your plans could not be loaded.')).toBeTruthy();
    expect(screen.queryByText('No confirmed plans this month.')).toBeNull();
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

  it('pins ScreenHeader and the sky, with the block sizing to its rows', () => {
    // The sky is an absolute backdrop and the block holds a title row plus the
    // weekday row. Giving the block an explicit height is what left a dead
    // band below the header twice, so it has none.
    expect(PLANS_SOURCE).toContain('styles.headerBlock');
    expect(PLANS_SOURCE).not.toContain('height: headerBlockHeight');
    expect(PLANS_SOURCE).toContain('<MemorySky compact');
  });


  it('renders MemorySky first inside the block with the pill header above content', () => {
    expect(PLANS_SOURCE.indexOf('<View style={headerBlockStyle}>')).toBeLessThan(
      PLANS_SOURCE.indexOf('<MemorySky compact'),
    );
    expect(PLANS_SOURCE.indexOf('<MemorySky compact')).toBeLessThan(
      PLANS_SOURCE.indexOf('styles.pillRow'),
    );
  });

  it('sizes the header band from the working-screen helper, not the compact one', () => {
    // The sky still draws compact and clips into the shorter block, but the
    // block itself takes the header band's height: the compact strip left the
    // sky and the countdown lane eating ~270pt above the calendar.
    expect(PLANS_SOURCE).toContain('headerSkyHeightForWindow(windowHeight)');
    expect(PLANS_SOURCE).not.toContain('compactSkyHeightForWindow');
    expect(PLANS_SOURCE).toContain('<MemorySky compact');
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

describe('Plans day view', () => {
  it('opens on the month grid, with the day one tap away', async () => {
    await renderPlans();

    // The grid is the landing: it answers "when are we free" first. No day
    // UI is mounted until a cell lifts it into the sheet.
    expect(screen.getByTestId('month-surface')).toBeTruthy();
    expect(screen.queryByTestId('day-sheet')).toBeNull();
    expect(screen.getByLabelText('Agenda')).toBeTruthy();
  });

  it('codes whose plan it is by strip colour, with no legend and no dots', async () => {
    mockEventsForDay = {
      '2026-01-15': [makeEvent({ title: 'Dinner out', together: true })],
    };
    await renderPlans();

    // One signal per strip: the fill. No key row explaining the colours,
    // no dots beside the titles, on the grid or in the sheet.
    expect(screen.queryByTestId('ownership-legend')).toBeNull();
    expect(monthLayer().getByText('Dinner out')).toBeTruthy();

    fireEvent.click(screen.getByLabelText(/^Thursday, January 15/));

    expect(screen.getByTestId('day-sheet')).toBeTruthy();
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
    await openDaySheet();

    expect(dayLayer().getByText(/You · /)).toBeTruthy();
    expect(dayLayer().getByText(/Partner · /)).toBeTruthy();
    expect(dayLayer().getByText(/Together · /)).toBeTruthy();
  });

  it('says a day is still loading instead of showing it as free', async () => {
    mockCalendarLoading = true;
    await openDaySheet();

    expect(centerPage('Thursday – Jan 15, 2026').getByText('Loading plans…')).toBeTruthy();
  });

  it('offers the agenda from a day whose only plans are proposals', async () => {
    // The month grid marks a pending proposal's day, so the day view must not
    // read it as free: it hands the reader to the list where it can be
    // answered instead.
    mockProposals = [
      {
        id: 'proposal-1',
        status: 'pending',
        proposedStart: new Date(2026, 0, 15, 19, 0, 0).toISOString(),
        proposedEnd: new Date(2026, 0, 15, 21, 0, 0).toISOString(),
        title: 'Sunset picnic',
      },
    ];
    await openDaySheet();

    expect(
      centerPage('Thursday – Jan 15, 2026').queryByText('No plans for this day.'),
    ).toBeNull();

    expect(centerPage('Thursday – Jan 15, 2026').getByText('No confirmed plans for this day.')).toBeTruthy();
    fireEvent.click(screen.getByLabelText('View suggestions and goals'));

    // The agenda takes the screen and the sheet goes away with it: the two
    // never stack.
    expect(screen.getByTestId('agenda-surface')).toBeTruthy();
    expect(screen.queryByTestId('day-sheet')).toBeNull();
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
      centerPage('Tuesday – Feb 3, 2026').getByLabelText('Back to today'),
    );

    const today = new Date();
    const heading = `${today.toLocaleDateString('en-US', { weekday: 'long' })} – ${today.toLocaleDateString('en-US', { day: 'numeric', month: 'short', year: 'numeric' })}`;
    expect(centerPage(heading).getByText(heading)).toBeTruthy();
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
  it('turns the day with a swipe, settling on the next day', async () => {
    await openDaySheet();
    expect(dayLayer().getByText('Thursday – Jan 15, 2026')).toBeTruthy();

    // One page right of centre: the stopped page becomes the sheet's day.
    // The shared selection is untouched: the month underneath must not budge.
    // Inside the window nothing rebuilds, so there is no frame to flash.
    act(() => {
      settleHandler('day-pager')({ nativeEvent: { contentOffset: { x: 4 * 390 } } });
    });

    expect(mockSelectedDate.toDateString()).toBe(
      new Date(2026, 0, 15, 12, 0, 0).toDateString(),
    );
    expect(dayLayer().getByText('Friday – Jan 16, 2026')).toBeTruthy();
  });

  it('turns the day back with a swipe the other way', async () => {
    await openDaySheet();

    act(() => {
      settleHandler('day-pager')({ nativeEvent: { contentOffset: { x: 2 * 390 } } });
    });

    expect(mockSelectedDate.toDateString()).toBe(
      new Date(2026, 0, 15, 12, 0, 0).toDateString(),
    );
    expect(dayLayer().getByText('Wednesday – Jan 14, 2026')).toBeTruthy();
  });

  it('recentres the window at its edge, carrying the stopped day with it', async () => {
    await openDaySheet();

    // All the way to the last page: the window rebuilds around the stopped
    // day and the offset is corrected to the new centre, so the stopped day
    // stays visually still instead of flashing and snapping back.
    act(() => {
      settleHandler('day-pager')({ nativeEvent: { contentOffset: { x: 6 * 390 } } });
    });

    expect(dayLayer().getByText('Sunday – Jan 18, 2026')).toBeTruthy();
    const scrolls = ((globalThis as any).__plansScrolls ?? []) as {
      testID?: string;
      x?: number;
    }[];
    const dayScrolls = scrolls.filter((scroll) => scroll.testID === 'day-pager');
    expect(dayScrolls.length).toBeGreaterThan(0);
    expect(dayScrolls.at(-1)?.x).toBe(3 * 390);
  });

  it('keeps offscreen day pages out of the accessibility tree', async () => {
    await openDaySheet();

    // Seven pages stay mounted for the swipe, but a screen reader must meet
    // one day: the side pages' duplicated actions would read as phantom days.
    // Queried structurally, not through the accessible tree, which hides six.
    const pages = Array.from(
      screen.getByTestId('day-sheet').querySelectorAll('[aria-label^="Day page"]'),
    );
    expect(pages.length).toBe(7);
    expect(
      pages.filter((page) => page.getAttribute('aria-hidden') === 'true'),
    ).toHaveLength(6);
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
    await openDaySheet();

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
    // A bounded window: the anchor month sits in the middle.
    expect(labelsBefore.length).toBe(7);
    expect(labelsBefore[3]).toBe('Month page January 2026');

    // Settle on the last page. Without re-centring the reader is now walled in
    // three months from where they started; with it, that month becomes the
    // anchor and there is a fresh window either side.
    act(() => {
      settleHandler('month-pager')({ nativeEvent: { contentOffset: { y: 6 * 600 } } });
    });

    const labelsAfter = screen
      .getAllByLabelText(/Month page /)
      .map((el) => el.getAttribute('aria-label'));
    expect(labelsAfter.length).toBe(7);
    expect(labelsAfter[3]).toBe('Month page April 2026');
    expect(labelsAfter[0]).toBe('Month page January 2026');
    expect(labelsAfter[6]).toBe('Month page July 2026');
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
    expect(labels).toHaveLength(7);
    expect(labels[3]).toBe('Month page January 2026');
    expect(labels[4]).toBe('Month page February 2026');
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
    expect(labels[3]).toBe('Month page September 2026');
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
    expect(labels[3]).toBe('Month page April 2026');
  });

  it('leaves the month exactly where it was while the sheet moves days', async () => {
    await openDaySheet();

    // Swipe the sheet a day on: the sheet follows, the month underneath
    // must not budge, or dismissing would land somewhere new.
    act(() => {
      settleHandler('day-pager')({ nativeEvent: { contentOffset: { x: 4 * 390 } } });
    });
    expect(dayLayer().getByText('Friday – Jan 16, 2026')).toBeTruthy();
    expect(screen.getByTestId('month-surface')).toBeTruthy();
    expect(
      within(screen.getByLabelText('Open the year view')).getByText('January 2026'),
    ).toBeTruthy();
    expect(mockSelectedDate.toDateString()).toBe(
      new Date(2026, 0, 15, 12, 0, 0).toDateString(),
    );

    fireEvent.click(screen.getByLabelText('Close'));

    // Dismissing returns to the untouched month: same page, same selection.
    expect(screen.queryByTestId('day-sheet')).toBeNull();
    expect(screen.getByTestId('month-surface')).toBeTruthy();
    expect(mockSelectedDate.toDateString()).toBe(
      new Date(2026, 0, 15, 12, 0, 0).toDateString(),
    );
  });
});

describe('Plans adaptation', () => {
  it('lets the date own the day heading, with no week-number stamp', async () => {
    await openDaySheet();

    expect(dayLayer().getByText('Thursday \u2013 Jan 15, 2026')).toBeTruthy();
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
vi.mock('moti', () => ({
  AnimatePresence: ({ children }: { children?: unknown }) => children,
  MotiView: ({ children, ...rest }: Record<string, unknown>) => {
    const { animate, exit, from, transition, testID, ...props } = rest;
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

describe('Plans agenda view', () => {
  it('labels the agenda control with words, not just an icon', async () => {
    await renderPlans();

    // The control is a text pill, so what it does is readable at a glance
    // rather than guessed from a list glyph.
    const agenda = screen.getByLabelText('Agenda');
    expect(within(agenda).getByText('Agenda')).toBeTruthy();
    expect(agenda.style.minHeight).toBe('44px');

    fireEvent.click(agenda);

    const calendar = screen.getByLabelText('Calendar');
    expect(within(calendar).getByText('Calendar')).toBeTruthy();
  });

  it('steps from the month into the agenda and back to the month', async () => {
    mockUpcomingEvents = [makeUpcomingEvent({ title: 'Weekend getaway' })];
    await renderPlans();

    // The month grid is still the landing, with no banner above it.
    expect(screen.getByTestId('month-surface')).toBeTruthy();
    expect(screen.queryByTestId('agenda-surface')).toBeNull();

    fireEvent.click(screen.getByLabelText('Agenda'));

    expect(screen.queryByTestId('month-surface')).toBeNull();
    expect(screen.getByTestId('agenda-surface')).toBeTruthy();
    // One agenda, mounted once, handed the screen's clock so its day labels
    // are the ones the reader is living in.
    expect(screen.getAllByTestId('plans-agenda-stub').length).toBe(1);
    expect(plansAgendaRender.mock.calls.at(-1)?.[0]).toEqual(
      expect.objectContaining({ now: expect.any(Date) }),
    );
    // The same header control now reads Calendar and puts the month back.
    fireEvent.click(screen.getByLabelText('Calendar'));

    expect(screen.getByTestId('month-surface')).toBeTruthy();
    expect(screen.queryByTestId('agenda-surface')).toBeNull();
    expect(screen.getByLabelText('Agenda')).toBeTruthy();
  });

  it('adds no search or profile controls to the header', async () => {
    await renderPlans();
    expect(screen.queryByLabelText('Search')).toBeNull();
    expect(screen.queryByLabelText('Profile')).toBeNull();

    fireEvent.click(screen.getByLabelText('Agenda'));
    expect(screen.queryByLabelText('Search')).toBeNull();
    expect(screen.queryByLabelText('Profile')).toBeNull();
  });
});

describe('Plans motion', () => {
  it('honours reduced motion in the screen and the day timeline', () => {
    // Motion is decoration here. A reader who asked for less of it gets the
    // same screens with the transitions cut to zero, not a different layout.
    expect(PLANS_SOURCE).toContain('useReducedMotion');
    expect(PLANS_SOURCE).toContain('reduceMotion ? 0 :');

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

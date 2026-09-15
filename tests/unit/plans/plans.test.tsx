import { readFileSync } from 'node:fs';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor, act } from '@testing-library/react';
import { createElement } from 'react';

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
    const { children, style, ...rest } = props;
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
    ScrollView: (props: Record<string, unknown>) => {
      const { children, style, onMomentumScrollEnd, ...rest } = props;
      (globalThis as any).__plansMomentumEnd = onMomentumScrollEnd;
      return createDiv(children, style, rest);
    },
    Modal: View,
    Platform: { OS: 'ios', select: (options: { ios?: unknown }) => options.ios },
    Dimensions: { get: () => ({ width: 390, height: 844 }) },
    useWindowDimensions: () => ({ width: 390, height: 844, scale: 3, fontScale: 1 }),
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
      View: ({ children }: { children?: unknown }) =>
        createElement('div', {}, children),
    },
    FadeIn: chain,
    FadeInDown: chain,
    ReduceMotion: { System: 'system' },
    useReducedMotion: () => false,
  };
});

const pushSpy = vi.fn();

vi.mock('expo-router', () => ({
  useRouter: () => ({ push: pushSpy, back: vi.fn(), replace: vi.fn() }),
  useIsFocused: () => true,
}));

vi.mock('@/components/home/memory-sky', () => ({
  MemorySky: () => null,
  compactSkyHeightForWindow: (windowHeight: number) => Math.round(windowHeight * 0.15) + 12,
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

vi.mock('@/features/calendar/calendar-context', () => ({
  useCalendar: () => ({
    selectedDate: mockSelectedDate,
    visibleMonth: mockVisibleMonth,
    eventsForDay: mockEventsForDay,
    upcomingEvents: mockUpcomingEvents,
    setSelectedDate: (date: Date) => {
      mockSelectedDate = date;
    },
    setVisibleMonth: (date: Date) => {
      mockVisibleMonth = date;
    },
    refresh: refreshCalendarSpy,
  }),
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

function makeGoal(overrides: Record<string, any> = {}) {
  return {
    id: 'goal-1',
    type: 'goal' as const,
    title: 'Visit Kyoto',
    body: '',
    occurredAt: new Date(2026, 0, 10, 12, 0, 0).toISOString(),
    targetAt: new Date(2026, 11, 1, 12, 0, 0).toISOString(),
    authorId: 'user_you',
    authorRole: 'you' as const,
    authorName: 'You',
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
  mockSpace = { relationshipStartDate: '2024-06-15' };
  pushSpy.mockClear();
  refreshCalendarSpy.mockClear();
  acceptProposalSpy.mockClear();
  declineProposalSpy.mockClear();
  loadGoals.mockReset();
  loadGoals.mockResolvedValue([]);
});

async function renderPlans() {
  const { default: PlansScreen } = await import('@/app/(app)/(tabs)/plans');
  return render(<PlansScreen />);
}

describe('Plans calendar', () => {
  it('marks dates with dots instead of event-title chips', async () => {
    mockEventsForDay = { '2026-01-15': [makeEvent()] };
    await renderPlans();

    // The event title appears once — in the agenda — never inside the grid.
    expect(screen.getAllByText('Dinner out')).toHaveLength(1);
    expect(screen.getByLabelText('Thursday, January 15, has plans')).toBeTruthy();
  });

  it('selecting a day drives the inline agenda', async () => {
    mockEventsForDay = { '2026-01-15': [makeEvent()] };
    mockSelectedDate = new Date(2026, 0, 20, 12, 0, 0);
    const { default: PlansScreen } = await import('@/app/(app)/(tabs)/plans');
    const first = render(<PlansScreen />);
    expect(screen.getByText('An open day. Add something small if you like.')).toBeTruthy();

    fireEvent.click(screen.getByLabelText('Thursday, January 15, has plans'));
    // Selection state lives in the mocked context setter; re-render on it.
    first.unmount();
    render(<PlansScreen />);
    expect(screen.getByText('Dinner out')).toBeTruthy();
  });

  it('navigates repeatedly backward and forward without dead-ending', async () => {
    await renderPlans();
    expect(screen.getByText('January 2026')).toBeTruthy();

    fireEvent.click(screen.getByLabelText('Previous month'));
    expect(await screen.findByText('December 2025')).toBeTruthy();
    fireEvent.click(screen.getByLabelText('Previous month'));
    expect(await screen.findByText('November 2025')).toBeTruthy();
    fireEvent.click(screen.getByLabelText('Previous month'));
    expect(await screen.findByText('October 2025')).toBeTruthy();

    fireEvent.click(screen.getByLabelText('Next month'));
    expect(await screen.findByText('November 2025')).toBeTruthy();
    fireEvent.click(screen.getByLabelText('Next month'));
    expect(await screen.findByText('December 2025')).toBeTruthy();
  });

  it('navigates backward past the old 61-month cap with bounded pages', async () => {
    await renderPlans();

    for (let step = 0; step < 70; step += 1) {
      fireEvent.click(screen.getByLabelText('Previous month'));
    }
    // Jan 2026 minus 70 months = March 2020 — reachable, no five-year wall.
    expect(screen.getByText('March 2020')).toBeTruthy();
    // Only the sliding window stays materialized (3 behind, current, 3 ahead).
    expect(screen.getAllByLabelText(/Month page /)).toHaveLength(7);
  }, 30000);

  it('navigates forward past the old 61-month cap with bounded pages', async () => {
    await renderPlans();

    for (let step = 0; step < 70; step += 1) {
      fireEvent.click(screen.getByLabelText('Next month'));
    }
    // Jan 2026 plus 70 months = November 2031.
    expect(screen.getByText('November 2031')).toBeTruthy();
    expect(screen.getAllByLabelText(/Month page /)).toHaveLength(7);
  }, 30000);

  it('swipe settle advances one month and recenters silently', async () => {
    await renderPlans();
    expect(screen.getByText('January 2026')).toBeTruthy();

    // Page width tracks the screen: window (390) minus screen gutters
    // (24 each side) minus calendar card padding (12 each side).
    const swipeTo = (page: number) =>
      act(() =>
        (globalThis as any).__plansMomentumEnd({
          nativeEvent: { contentOffset: { x: page * 318, y: 0 } },
        })
      );
    // Swipe forward one page (center index 3 → 4), then again: each
    // settle advances exactly one month from the recentered window.
    swipeTo(4);
    expect(await screen.findByText('February 2026')).toBeTruthy();
    swipeTo(4);
    expect(await screen.findByText('March 2026')).toBeTruthy();
  });

  it('empty selected day is a lightweight line, not a panel', async () => {
    await renderPlans();

    expect(screen.getByText('An open day. Add something small if you like.')).toBeTruthy();
    expect(screen.getByText('Add event')).toBeTruthy();
  });
});

describe('Plans calendar collapsed with upcoming', () => {
  it('defaults collapsed with an upcoming event (no Month pages)', async () => {
    mockUpcomingEvents = [makeUpcomingEvent()];
    await renderPlans();

    expect(screen.getByText('Show calendar')).toBeTruthy();
    expect(screen.queryByText('Hide calendar')).toBeNull();
    expect(screen.queryAllByLabelText(/Month page /)).toHaveLength(0);
    // Countdown lane still shows the next event.
    expect(screen.getByText('Weekend getaway')).toBeTruthy();
  });

  it('toggles Show/Hide calendar explicitly', async () => {
    mockUpcomingEvents = [makeUpcomingEvent()];
    await renderPlans();

    fireEvent.click(screen.getByText('Show calendar'));
    expect(screen.getByText('Hide calendar')).toBeTruthy();
    expect(screen.getAllByLabelText(/Month page /)).toHaveLength(7);

    fireEvent.click(screen.getByText('Hide calendar'));
    expect(screen.getByText('Show calendar')).toBeTruthy();
    expect(screen.queryAllByLabelText(/Month page /)).toHaveLength(0);
  });

  it('upcoming tap expands and selects the correct day', async () => {
    mockUpcomingEvents = [makeUpcomingEvent()];
    await renderPlans();
    expect(screen.getByText('Show calendar')).toBeTruthy();

    fireEvent.click(screen.getByLabelText(/Next: Weekend getaway/));
    // Expands the calendar and moves selection to the event day.
    expect(screen.getByText('Hide calendar')).toBeTruthy();
    expect(screen.getAllByLabelText(/Month page /)).toHaveLength(7);
    expect(mockSelectedDate.getFullYear()).toBe(2030);
    expect(mockSelectedDate.getMonth()).toBe(0);
    expect(mockSelectedDate.getDate()).toBe(20);
  });
});

describe('Plans sections', () => {
  it('shows Someday preview with entry to the full list', async () => {
    mockSomedayOpen = [
      { id: 's1', title: 'Night train ride' },
      { id: 's2', title: 'Rooftop picnic' },
      { id: 's3', title: 'Pottery class' },
      { id: 's4', title: 'Lake cabin' },
    ];
    await renderPlans();

    expect(screen.getByText('Someday')).toBeTruthy();
    expect(screen.getByText('Night train ride')).toBeTruthy();
    expect(screen.getByText('Rooftop picnic')).toBeTruthy();
    expect(screen.getByText('Pottery class')).toBeTruthy();
    expect(screen.queryByText('Lake cabin')).toBeNull();
    fireEvent.click(screen.getByText('See all 4'));
    expect(pushSpy).toHaveBeenCalledWith('/(app)/someday');
  });

  it('makes pending proposals first-class with answers preserved', async () => {
    mockProposals = [
      {
        id: 'p1',
        title: 'Brunch Saturday?',
        status: 'pending',
        proposerRole: 'partner',
        proposedStart: new Date(2026, 0, 17, 10, 0, 0).toISOString(),
      },
      {
        id: 'p2',
        title: 'Museum Sunday',
        status: 'pending',
        proposerRole: 'you',
        proposedStart: new Date(2026, 0, 18, 10, 0, 0).toISOString(),
      },
    ];
    await renderPlans();

    expect(screen.getByText('Proposals')).toBeTruthy();
    expect(screen.getByText('Brunch Saturday?')).toBeTruthy();
    expect(screen.getByText('Museum Sunday')).toBeTruthy();
    expect(screen.getByText(/Waiting on them/)).toBeTruthy();

    fireEvent.click(screen.getByText('Accept'));
    await waitFor(() => expect(acceptProposalSpy).toHaveBeenCalledWith('p1'));
    await waitFor(() => expect(refreshCalendarSpy).toHaveBeenCalledTimes(1));
  });

  it('gives waiting-for-yes one warm job: gold dot to answer, warning words while waiting', async () => {
    mockProposals = [
      {
        id: 'p1',
        title: 'Brunch Saturday?',
        status: 'pending',
        proposerRole: 'partner',
        proposedStart: new Date(2026, 0, 17, 10, 0, 0).toISOString(),
      },
      {
        id: 'p2',
        title: 'Museum Sunday',
        status: 'pending',
        proposerRole: 'you',
        proposedStart: new Date(2026, 0, 18, 10, 0, 0).toISOString(),
      },
    ];
    const { container } = await renderPlans();

    // Answerable-by-you row pairs a small 8px warning dot with its words.
    const dots = Array.from(container.querySelectorAll('div')).filter(
      (element) =>
        (element as HTMLElement).style.backgroundColor === '#8a5f2b' &&
        (element as HTMLElement).style.width === '8px' &&
        (element as HTMLElement).style.height === '8px'
    );
    expect(dots).toHaveLength(1);

    // Waiting-on-them caption renders in warning instead of muted.
    const waiting = screen.getByText(/Waiting on them/);
    expect((waiting as HTMLElement).style.color).toBe('#8a5f2b');
  });

  it('shows important context without fabricating a missing start date', async () => {
    await renderPlans();
    expect(screen.getByText(/Together since/)).toBeTruthy();

    mockSpace = { relationshipStartDate: null };
    const { default: PlansScreen } = await import('@/app/(app)/(tabs)/plans');
    render(<PlansScreen />);
    expect(screen.queryByText(/Together since/)).toBeNull();
  });
});

describe('Plans goals', () => {
  it('lists historical and future goals from the goal store', async () => {
    loadGoals.mockResolvedValue([makeGoal()]);
    await renderPlans();

    await waitFor(() => expect(screen.getByText('Visit Kyoto')).toBeTruthy());
    expect(screen.getByText('Future goals')).toBeTruthy();
    fireEvent.click(screen.getByText('Visit Kyoto'));
    expect(pushSpy).toHaveBeenCalledWith({
      pathname: '/(app)/moment/[id]',
      params: { id: 'goal-1', at: makeGoal().occurredAt },
    });
  });

  it('creates new goals from Plans, never Story', async () => {
    await renderPlans();

    fireEvent.click(screen.getByText('New goal'));
    expect(pushSpy).toHaveBeenCalledWith('/(app)/goal-new');
  });

  it('surfaces goal records dated on the selected day inside the agenda', async () => {
    loadGoals.mockResolvedValue([
      makeGoal({ id: 'goal-1', targetAt: new Date(2026, 0, 15, 12, 0, 0).toISOString() }),
    ]);
    await renderPlans();

    await waitFor(() => expect(screen.getAllByText('Visit Kyoto').length).toBeGreaterThanOrEqual(1));
  });
});

describe('Plans fixed header block (pinned ScreenHeader, zero overlap)', () => {
  const PLANS_SOURCE = readFileSync('app/(app)/(tabs)/plans.tsx', 'utf8');

  it('pins ScreenHeader+sky in a fixed block sized by the helper', () => {
    expect(PLANS_SOURCE).toContain('compactSkyHeightForWindow');
    expect(PLANS_SOURCE).toContain('headerBlockStyle');
    expect(PLANS_SOURCE).toContain('height: headerBlockHeight');
    expect(PLANS_SOURCE).toContain('paddingTop: insets.top + Spacing[8]');
  });

  it('renders MemorySky first inside the block with ScreenHeader above content', () => {
    expect(PLANS_SOURCE.indexOf('<View style={headerBlockStyle}>')).toBeLessThan(
      PLANS_SOURCE.indexOf('<MemorySky compact'),
    );
    expect(PLANS_SOURCE.indexOf('<MemorySky compact')).toBeLessThan(
      PLANS_SOURCE.indexOf('<ScreenHeader'),
    );
  });

  it('keeps ScreenHeader outside the ScrollView so it never scrolls away', () => {
    expect(PLANS_SOURCE.indexOf('<ScreenHeader')).toBeLessThan(
      PLANS_SOURCE.indexOf('<ScrollView\n'),
    );
    expect(PLANS_SOURCE).not.toContain('marginTop: -');
    expect(PLANS_SOURCE).not.toContain('paddingTop: -');
  });
});

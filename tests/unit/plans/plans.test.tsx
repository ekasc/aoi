import { readFileSync } from 'node:fs';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor, act } from '@testing-library/react';
import { createElement, useEffect } from 'react';

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
      createAnimatedComponent: (component: unknown) => component,
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

const PLANS_SOURCE = readFileSync('app/(app)/(tabs)/plans.tsx', 'utf8');

describe('Plans calendar', () => {
  it('shows the day events as strips in the cell, not a dot', async () => {
    mockEventsForDay = { '2026-01-15': [makeEvent()] };
    await renderPlans();

    // The title appears in the grid cell itself. The agenda that used to
    // repeat it below is gone: the grid is the screen now.
    expect(screen.getAllByText('Dinner out').length).toBeGreaterThanOrEqual(1);
    expect(screen.getByLabelText('Thursday, January 15, has plans')).toBeTruthy();
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

  it('keeps the month and view pills outside the ScrollView so they never scroll away', () => {
    expect(PLANS_SOURCE.indexOf('styles.pillRow')).toBeLessThan(
      PLANS_SOURCE.indexOf('<ScrollView\n'),
    );
    expect(PLANS_SOURCE).not.toContain('marginTop: -');
    expect(PLANS_SOURCE).not.toContain('paddingTop: -');
  });
});

// Motion is not what these tests are about: render the element and drop the
// animation props, so the tree is the same with or without a transition.
vi.mock('moti', () => ({
  AnimatePresence: ({ children }: { children?: unknown }) => children,
  MotiView: ({ children, ...rest }: Record<string, unknown>) => {
    const { animate, exit, from, transition, ...props } = rest;
    const style = (props as { style?: unknown }).style;
    const flat = Array.isArray(style)
      ? Object.assign({}, ...style.filter(Boolean))
      : style;
    return createElement('div', { ...props, style: flat }, children as never);
  },
}));

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

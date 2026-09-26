import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { createElement } from 'react';

const { backSpy, setSelectedDateSpy, setVisibleMonthSpy } = vi.hoisted(() => ({
  backSpy: vi.fn(),
  setSelectedDateSpy: vi.fn(),
  setVisibleMonthSpy: vi.fn(),
}));

// Same RN boundary as the other Plans tests: resolve press-state styles, map
// accessibilityLabel to aria-label and onPress to onClick.
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

  function withAria(props: Record<string, unknown>): Record<string, unknown> {
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

  return {
    AppState: {
      currentState: 'active',
      addEventListener: () => ({ remove: () => {} }),
    },
    Dimensions: { get: () => ({ height: 844, width: 390 }) },
    StyleSheet: {
      absoluteFillObject: {},
      create: (styles: Record<string, unknown>) => styles,
      flatten: flattenStyle,
      hairlineWidth: 1,
    },
    View: ({ children, style, ...rest }: Record<string, unknown>) =>
      createElement('div', { ...withAria(rest), style: flattenStyle(style) }, children as never),
    Text: ({ children, style, ...rest }: Record<string, unknown>) =>
      createElement('span', { ...withAria(rest), style: flattenStyle(style) }, children as never),
    Pressable: ({ children, style, ...rest }: Record<string, unknown>) => {
      const resolved = typeof style === 'function' ? style({ pressed: false }) : style;
      return createElement(
        'div',
        { ...withAria(rest), style: flattenStyle(resolved) },
        children as never,
      );
    },
    ScrollView: ({ children, style, ...rest }: Record<string, unknown>) =>
      createElement('div', { ...withAria(rest), style: flattenStyle(style) }, children as never),
    // The real list mounts a window around its opening index, not every item:
    // the year screen holds seventeen years, and rendering all of them here
    // made this file cost seconds of the suite budget and time out under load.
    // Respecting the window keeps the mock honest and the test cheap, and it
    // fails if the screen ever drops back to an unbounded list.
    FlatList: ({
      data,
      renderItem,
      style,
      initialScrollIndex = 0,
      windowSize = 21,
      ...rest
    }: {
      data?: unknown[];
      renderItem?: (info: { item: unknown; index: number }) => unknown;
      style?: unknown;
      initialScrollIndex?: number;
      windowSize?: number;
    }) => {
      const items = data ?? [];
      const start = Math.max(0, initialScrollIndex - Math.floor(windowSize / 2));
      const visible = items.slice(start, start + windowSize);
      return createElement(
        'div',
        { ...withAria(rest as Record<string, unknown>), style: flattenStyle(style) },
        visible.map((item, offset) =>
          renderItem?.({ index: start + offset, item }),
        ) as never,
      );
    },
    Platform: { OS: 'ios', select: (options: { ios?: unknown }) => options.ios },
    useWindowDimensions: () => ({ fontScale: 1, height: 844, scale: 3, width: 390 }),
  };
});

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

vi.mock('react-native-reanimated', () => ({
  default: {
    createAnimatedComponent: (component: unknown) => component,
    View: ({ children }: { children?: unknown }) => createElement('div', {}, children),
  },
  FadeOut: {},
  FadeIn: {},
  FadeInDown: {},
  ReduceMotion: { System: 'system' },
  useReducedMotion: () => false,
}));

vi.mock('expo-router', () => ({
  useRouter: () => ({ back: backSpy, push: vi.fn(), replace: vi.fn() }),
}));

vi.mock('@/hooks/use-theme-color', () => ({
  // Real colours, named distinctly, so a test can tell whose ink a mark
  // draws with: the DOM drops invalid colour strings silently.
  useThemeColor: (_overrides: unknown, name?: string) =>
    name === 'partnerAccentInk' ? '#222222' : '#111111',
}));

let mockRangeEvents: Record<string, unknown>[] = [
  {
    endsAt: '2026-09-16T11:00:00.000Z',
    id: 'fair',
    startsAt: '2026-09-16T10:00:00.000Z',
    title: 'Career fair',
  },
];

vi.mock('@/features/calendar/calendar-context', () => ({
  useCalendar: () => ({
    selectedDate: new Date(2026, 8, 16, 12, 0, 0),
    setSelectedDate: setSelectedDateSpy,
    setVisibleMonth: setVisibleMonthSpy,
    visibleMonth: new Date(2026, 8, 1),
    // The density read: one plan on 16 September 2026, which is the day the
    // screen is told is selected, so the dot and the accent agree.
    eventsInRange: async () => mockRangeEvents,
  }),
}));

beforeEach(() => {
  backSpy.mockClear();
  setSelectedDateSpy.mockClear();
  setVisibleMonthSpy.mockClear();
  mockRangeEvents = [
    {
      endsAt: '2026-09-16T11:00:00.000Z',
      id: 'fair',
      startsAt: '2026-09-16T10:00:00.000Z',
      title: 'Career fair',
    },
  ];
});

describe('Calendar year view', () => {
  it('shows a year of months at a glance and opens the one you tap', async () => {
    const { default: YearScreen } = await import('@/app/(app)/calendar/year');
    render(<YearScreen />);

    // Twelve months for each year in the window, not one month at a time.
    const months = screen.getAllByLabelText(/^Open [A-Z][a-z]+ \d{4}$/);
    expect(months.length).toBeGreaterThanOrEqual(12);
    expect(months.length % 12).toBe(0);

    const thisYear = new Date().getFullYear();
    const septemberThisYear = screen.getByLabelText(`Open September ${thisYear}`);
    fireEvent.click(septemberThisYear);

    expect(setVisibleMonthSpy).toHaveBeenCalledTimes(1);
    expect(setSelectedDateSpy).toHaveBeenCalledTimes(1);
    expect(backSpy).toHaveBeenCalledTimes(1);

    // The month it hands back is the first of that month, not the tapped cell.
    const handedBack = setSelectedDateSpy.mock.calls[0][0] as Date;
    expect(handedBack.getDate()).toBe(1);
    expect(handedBack.getMonth()).toBe(8);
    expect(handedBack.getFullYear()).toBe(thisYear);
  });

  it('marks the days a year holds plans, from a real range read', async () => {
    const { default: YearScreen } = await import('@/app/(app)/calendar/year');
    render(<YearScreen />);

    // The read resolves a tick later, which is what the await is for.
    const dot = await screen.findByTestId('plans:2026-09-16');
    expect(dot).toBeTruthy();
    // One day, one dot, no matter how many years are on screen.
    expect(screen.getAllByTestId('plans:2026-09-16')).toHaveLength(1);
    expect(screen.queryByTestId('plans:2026-09-17')).toBeNull();
  });

  it('colours each day dot by whose plans it holds', async () => {
    mockRangeEvents = [
      {
        id: 'mine',
        title: 'Standup',
        startsAt: '2026-09-15T09:00:00.000Z',
        endsAt: '2026-09-15T09:30:00.000Z',
        actor: 'you',
        actorName: 'You',
        label: { preset: 'Work' },
        isOwn: true,
      },
      {
        id: 'theirs',
        title: 'Dinner out',
        startsAt: '2026-09-16T19:00:00.000Z',
        endsAt: '2026-09-16T21:00:00.000Z',
        actor: 'partner',
        actorName: 'Alex',
        label: { preset: 'Date' },
        isOwn: false,
      },
      {
        id: 'ours',
        title: 'Weekend away',
        startsAt: '2026-09-17T10:00:00.000Z',
        endsAt: '2026-09-17T12:00:00.000Z',
        actor: 'partner',
        actorName: 'Alex',
        label: { preset: 'Date' },
        together: true,
        isOwn: false,
      },
    ];
    const { default: YearScreen } = await import('@/app/(app)/calendar/year');
    render(<YearScreen />);

    // Ink, not fill: at mini size the dot is a mark, so it takes the
    // lightness that reads. Shared plans read as the viewer's ink, the
    // way their month strips take the viewer's fill.
    const mine = await screen.findByTestId('plans:2026-09-15');
    expect((mine as HTMLElement).style.backgroundColor).toBe('#111111');
    expect(
      ((await screen.findByTestId('plans:2026-09-16')) as HTMLElement).style
        .backgroundColor,
    ).toBe('#222222');
    expect(
      ((await screen.findByTestId('plans:2026-09-17')) as HTMLElement).style
        .backgroundColor,
    ).toBe('#111111');
  });

  it('lets the strongest voice win a day with several plans', async () => {
    mockRangeEvents = [
      {
        id: 'mine',
        title: 'Standup',
        startsAt: '2026-09-15T09:00:00.000Z',
        endsAt: '2026-09-15T09:30:00.000Z',
        actor: 'you',
        actorName: 'You',
        label: { preset: 'Work' },
        isOwn: true,
      },
      {
        id: 'theirs',
        title: 'Dinner out',
        startsAt: '2026-09-15T19:00:00.000Z',
        endsAt: '2026-09-15T21:00:00.000Z',
        actor: 'partner',
        actorName: 'Alex',
        label: { preset: 'Date' },
        isOwn: false,
      },
    ];
    const { default: YearScreen } = await import('@/app/(app)/calendar/year');
    render(<YearScreen />);

    // One mark per day: shared would win outright, and theirs beats yours —
    // your own plans you already know about.
    const dot = await screen.findByTestId('plans:2026-09-15');
    expect((dot as HTMLElement).style.backgroundColor).toBe('#222222');
  });
});

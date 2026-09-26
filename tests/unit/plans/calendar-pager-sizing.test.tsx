import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { createElement, useEffect } from 'react';
import { readFileSync } from 'node:fs';
import path from 'node:path';

// Same RN boundary as plans.test.tsx: resolve press-state styles unpressed,
// flatten styles, map accessibilityLabel -> aria-label and onPress -> onClick.
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
    ScrollView: (props: Record<string, unknown>) => {
      const { children, style, onLayout, ...rest } = props;
      // The platform fires onLayout after mount, and the week strip sizes its
      // pages from it. Without this the strip renders nothing and its render
      // budget would look green while measuring zero cells.
      useEffect(() => {
        if (typeof onLayout === 'function') {
          onLayout({
            nativeEvent: { layout: { height: 600, width: 390, x: 0, y: 0 } },
          });
        }
      }, [onLayout]);
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

vi.mock('expo-router', () => ({
  useRouter: () => ({ push: vi.fn(), back: vi.fn(), replace: vi.fn() }),
  useIsFocused: () => true,
}));

vi.mock('react-native-safe-area-context', () => ({
  useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }),
}));

vi.mock('@/components/home/memory-sky', () => ({
  MemorySky: () => null,
  // The header band on a working screen is shorter than the compact one, so
  // the mock follows the helper the screen actually calls.
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

vi.mock('@/hooks/use-theme-color', () => ({
  useThemeColor: () => '#000000',
}));

vi.mock('@/features/calendar/calendar-context', () => ({
  useCalendar: () => ({
    selectedDate: new Date(2026, 0, 15, 12, 0, 0),
    visibleMonth: new Date(2026, 0, 1),
    eventsForDay: {},
    upcomingEvents: [],
    setSelectedDate: vi.fn(),
    setVisibleMonth: vi.fn(),
    refresh: vi.fn(async () => {}),
  }),
}));

vi.mock('@/features/proposals/proposals-context', () => ({
  useProposals: () => ({
    proposals: [],
    accept: vi.fn(async () => {}),
    decline: vi.fn(async () => {}),
    reload: vi.fn(async () => {}),
  }),
}));

vi.mock('@/features/someday/someday-context', () => ({
  useSomeday: () => ({ openItems: [], doneItems: [] }),
}));

vi.mock('@/features/moments/moments-context', () => ({
  useMoments: () => ({ loadGoals: vi.fn(async () => []) }),
}));

vi.mock('@/features/space/space-context', () => ({
  useSpace: () => ({ space: { relationshipStartDate: '2024-06-15' } }),
}));

vi.mock('@/features/session/session-context', () => ({
  useSession: () => ({ user: { displayName: 'You', email: 'you@example.com' } }),
}));

beforeEach(() => {
  vi.resetModules();
});

describe('Plans calendar pager sizing', () => {
  it('sizes every page from the space the grid is given, so a month frames', async () => {
    const { default: PlansScreen } = await import('@/app/(app)/(tabs)/plans');
    render(<PlansScreen />);

    // The mock reports a 600pt box for the measured wrapper. Every page takes
    // that number, so a page and a screenful are the same thing: the pager
    // cannot land mid month, which is what left the tail of one month above the
    // next month's heading.
    const pages = screen.getAllByLabelText(/Month page /);
    // Enough pages to swipe a month either way, and no more than the window
    // the pager is allowed to mount.
    expect(pages.length).toBeGreaterThanOrEqual(3);
    expect(pages.length).toBeLessThanOrEqual(9);
    for (const page of pages) {
      expect(Number.parseFloat((page as HTMLElement).style.height)).toBe(600);
    }

    // The scroll step is the page height, not a second estimate of it.
    const pager = (pages[0] as HTMLElement).parentElement as HTMLElement;
    expect(Number.parseFloat(pager.style.height)).toBe(600);
  });

  it('mounts a window of dates, not the whole reachable horizon', async () => {
    const { default: PlansScreen } = await import('@/app/(app)/(tabs)/plans');
    render(<PlansScreen />);

    // Counts the live date cells, which is the cost that scales with the
    // window. A whole-horizon window mounted 1,463 cells in the day view and
    // 1,785 in the month view; the budgets below fail if that comes back.
    const dateCellCount = (within?: Element | null) =>
      Array.from((within ?? document).querySelectorAll('[aria-label]')).filter((el) =>
        /^(Sunday|Monday|Tuesday|Wednesday|Thursday|Friday|Saturday), /.test(
          el.getAttribute('aria-label') ?? '',
        ),
      ).length;

    // A grid cell lifts its day into the sheet: yesterday through tomorrow,
    // three pages, counted inside the sheet only.
    fireEvent.click(screen.getAllByLabelText(/Thursday, January 15/)[0]);
    expect(
      dateCellCount(document.querySelector('[data-testid="day-sheet"]')),
    ).toBeLessThanOrEqual(49);

    // Month view: a bounded stack of grids, counted inside the month surface
    // only.
    expect(
      dateCellCount(document.querySelector('[data-testid="month-surface"]')),
    ).toBeLessThanOrEqual(9 * 42);
  });

  it('creates from a floating control, not from a Today pill', () => {
    const PLANS_SOURCE = readFileSync('app/(app)/(tabs)/plans.tsx', 'utf8');
    // The floating Today pill is gone. Creation is the floating control now,
    // and it is the same tinted glass FAB the Memories tab uses.
    expect(PLANS_SOURCE).not.toContain('handleJumpToToday');
    expect(PLANS_SOURCE).not.toContain('accessibilityLabel="Today"');
    expect(PLANS_SOURCE).toContain('accessibilityLabel="Add an event"');
    expect(PLANS_SOURCE).toContain('styles.fabGlass');
    expect(PLANS_SOURCE).toContain('fabBottomOffset(insets.bottom');
    expect(PLANS_SOURCE).toContain('onPress={handleAddEvent}');
  });

  it('measures a wrapper rather than the pager, so the page cannot feed itself', async () => {
    const PLANS_SOURCE = readFileSync(
      path.join(process.cwd(), 'app/(app)/(tabs)/plans.tsx'),
      'utf8',
    );
    // The measuring view is the box, which is flex: 1 and knows nothing about
    // the pager's own height. The pager then takes that number.
    expect(PLANS_SOURCE).toContain('style={styles.pagerBox}');
    expect(PLANS_SOURCE).toContain('style={[styles.pager, { height: MONTH_PAGE_HEIGHT }]}');
    expect(PLANS_SOURCE).toContain('const MONTH_PAGE_HEIGHT = listHeight;');
    // Nothing renders before the space is known, so the opening frame is not a
    // guess that gets corrected a frame later.
    expect(PLANS_SOURCE).toContain('{MONTH_PAGE_HEIGHT > 0 ? (');
    // Continuous and endless: the month list is a free scroll, and the page
    // that settles becomes the month on screen, so the window always has
    // months either side. The behaviour itself (header and loaded month
    // following the settle) is exercised with real state in plans.test.tsx.
    // Only the day pager snaps: days are discrete pages, one per swipe.
    expect(PLANS_SOURCE.match(/pagingEnabled/g)).toHaveLength(1);
    expect(PLANS_SOURCE).toContain('onMomentumScrollEnd={handlePagerSettled}');
    expect(PLANS_SOURCE).toContain('onMomentumScrollEnd={handleDayPagerSettled}');
    // Room at the end for the FAB, and no inset cutting the grid off above the
    // tab bar: the grid fills the screen and passes behind it.
    expect(PLANS_SOURCE).toContain('paddingBottom: fabBottom + Spacing[8]');
    expect(PLANS_SOURCE).toContain('{ backgroundColor: background },\n\t\t],\n\t\t[background],');
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
    return createElement(
      'div',
      {
        ...props,
        ...(typeof testID === 'string' ? { 'data-testid': testID } : null),
        style: flat,
      },
      children as never,
    );
  },
}));

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { Children, createElement, isValidElement, type ReactNode } from 'react';

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
    if (typeof props.accessibilityLabel === 'string') next['aria-label'] = props.accessibilityLabel;
    if (typeof props.onPress === 'function') next.onClick = props.onPress;
    return next;
  }
  function createDiv(children: unknown, style: unknown, props: Record<string, unknown>) {
    return createElement('div', { style: flattenStyle(style), ...withAriaProps(props) }, children);
  }
  const View = (props: Record<string, unknown>) => {
    const { children, style, ...rest } = props;
    return createDiv(children, style, rest);
  };
  const Text = (props: Record<string, unknown>) => {
    const { children, style, ...rest } = props;
    return createElement('span', { style: flattenStyle(style), ...withAriaProps(rest) }, children);
  };
  const Pressable = (props: Record<string, unknown>) => {
    const { children, style, ...rest } = props;
    const resolved = typeof style === 'function' ? style({ pressed: false }) : style;
    return createDiv(children, resolved, rest);
  };
  const TextInput = (props: Record<string, unknown>) => {
    const { onChangeText, ...rest } = props as { onChangeText?: (value: string) => void };
    return createElement('input', {
      ...withAriaProps(rest as Record<string, unknown>),
      onChange: (event: { target: { value: string } }) => onChangeText?.(event.target.value),
    });
  };
  return {
    Animated: {
      View,
      Value: class {
        interpolate() {
          return {};
        }
      },
      event: () => () => {},
      createAnimatedComponent: (Component: unknown) => Component,
    },
    StyleSheet: { create: (s: Record<string, unknown>) => s, hairlineWidth: 1, flatten: flattenStyle, absoluteFill: {}, absoluteFillObject: {} },
    View,
    Text,
    Pressable,
    TextInput,
    ScrollView: View,
    KeyboardAvoidingView: View,
    AppState: { currentState: 'active', addEventListener: () => ({ remove: () => {} }) },
    FlatList: function FlatListMock(props: Record<string, unknown>) {
      const { ref: listRef, ListHeaderComponent, children, style, ...rest } = props as Record<
        string,
        unknown
      > & { ref?: unknown };
      if (listRef && typeof listRef === 'object') {
        (listRef as { current?: unknown }).current = {
          scrollToIndex: () => {},
          scrollToOffset: () => {},
        };
      }
      const header =
        typeof ListHeaderComponent === 'function'
          ? (ListHeaderComponent as () => unknown)()
          : ListHeaderComponent;
      return createElement('div', { style: flattenStyle(style), ...withAriaProps(rest) }, header, children);
    },
    Platform: { OS: 'ios', select: (o: { ios?: unknown }) => o.ios },
    Dimensions: { get: () => ({ width: 320, height: 568 }) },
    useWindowDimensions: () => ({ width: 320, height: 568, scale: 2, fontScale: 1 }),
    AccessibilityInfo: {
      isReduceTransparencyEnabled: () => Promise.resolve(false),
      addEventListener: () => ({ remove: () => {} }),
    },
  };
});

vi.mock('@expo/vector-icons', () => ({
  Ionicons: (props: { name?: unknown }) => createElement('i', { 'data-icon': String(props.name ?? '') }),
}));

vi.mock('react-native-reanimated', () => {
  const chain: Record<string, () => unknown> = {};
  chain.duration = () => chain;
  chain.delay = () => chain;
  chain.reduceMotion = () => chain;
  return {
    default: { View: ({ children }: { children?: unknown }) => createElement('div', {}, children) },
    FadeIn: chain,
    FadeInDown: chain,
    ReduceMotion: { System: 'system' },
    useReducedMotion: () => false,
  };
});

const pushSpy = vi.fn();
let sessionState = { status: 'signed_in', isHydrated: true };
let spaceState: { status: string; isHydrated: boolean } = { status: 'ready', isHydrated: true };
let themeState = { isHydrated: true };
let mockSegments: string[] = ['(auth)', 'sign-in'];
type CapturedTabTrigger = {
  name: string;
  label?: unknown;
  sf?: { default?: string; selected?: string };
  src?: {
    default?: { props?: { name?: unknown } };
    selected?: { props?: { name?: unknown } };
  };
};
const capturedNativeTabsProps: Record<string, unknown> = {};
const capturedTabTriggers: CapturedTabTrigger[] = [];
let lastRedirectHref: string | null = null;

// The layout renders the OS tab bar and hands it the Ionicons family as
// config. Capture the bar's props and every Trigger in render order;
// MockVectorIcon renders its name through `data-icon` so the cross-platform
// icon names stay assertable.
vi.mock('expo-router/unstable-native-tabs', () => {
  function MockVectorIcon(props: { name?: unknown }) {
    return createElement('i', { 'data-icon': String(props.name ?? '') });
  }
  function MockTriggerLabel() {
    return null;
  }
  function MockTriggerIcon(props: {
    sf?: CapturedTabTrigger['sf'];
    src?: CapturedTabTrigger['src'];
  }) {
    return createElement(
      'i',
      {
        'data-sf-default': props.sf?.default ?? '',
        'data-sf-selected': props.sf?.selected ?? '',
      },
      props.src?.default as never,
      props.src?.selected as never
    );
  }
  function MockTrigger(props: { name: string; children?: unknown }) {
    const entry: CapturedTabTrigger = { name: props.name };
    for (const child of Children.toArray(props.children as ReactNode)) {
      if (!isValidElement(child)) continue;
      if (child.type === MockTriggerLabel) {
        entry.label = (child.props as { children?: unknown }).children;
      }
      if (child.type === MockTriggerIcon) {
        const icon = child.props as {
          sf?: CapturedTabTrigger['sf'];
          src?: CapturedTabTrigger['src'];
        };
        entry.sf = icon.sf;
        entry.src = icon.src;
      }
    }
    capturedTabTriggers.push(entry);
    return createElement('div', { 'data-tab-trigger': props.name }, props.children as never);
  }
  Object.assign(MockTrigger, {
    Label: MockTriggerLabel,
    Icon: MockTriggerIcon,
    VectorIcon: MockVectorIcon,
  });
  const MockNativeTabs = Object.assign(
    function MockNativeTabs({ children, ...rest }: { children?: unknown }) {
      Object.assign(capturedNativeTabsProps, rest);
      return createElement('div', { 'data-testid': 'native-tabs' }, children as never);
    },
    { Trigger: MockTrigger }
  );
  return { NativeTabs: MockNativeTabs };
});

vi.mock('expo-router', () => {
  return {
    useRouter: () => ({ push: pushSpy, back: vi.fn(), replace: vi.fn(), dismissTo: vi.fn(), setParams: vi.fn() }),
    useLocalSearchParams: () => ({}),
    useSegments: () => mockSegments,
    Redirect: function MockRedirect(props: { href: string }) {
      lastRedirectHref = props.href;
      return createElement('div', { 'data-testid': 'redirect', 'data-href': props.href });
    },
    Stack: { Screen: () => null },
    useIsFocused: () => true,
  };
});

vi.mock('@expo/vector-icons/Ionicons', () => ({
  default: () => null,
}));

// AuthLayout imports Stack from the real 'expo-router/stack' entrypoint,
// not from 'expo-router' — mirror that submodule so the test reflects the
// production import graph instead of loading the real native stack.
vi.mock('expo-router/stack', () => {
  function MockStack({ children }: { children?: unknown }) {
    return createElement('div', { 'data-testid': 'stack' }, children as never);
  }
  (MockStack as Record<string, unknown>).Screen = function StackScreen() {
    return null;
  };
  return { Stack: MockStack };
});

vi.mock('react-native-safe-area-context', () => ({
  useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }),
}));

vi.mock('@/features/theme/theme-context', () => ({
  useAoiTheme: () => ({
    colors: {
      background: '#FCF9F2',
      surface: '#FFFDF8',
      surface2: '#F3ECDD',
      border: '#E3D8C3',
      text: '#1E1B16',
      muted: '#5E564A',
      accent: '#334E45',
    },
    mode: 'light' as const,
    isHydrated: themeState.isHydrated,
  }),
}));

vi.mock('@/hooks/use-theme-color', () => ({
  useThemeColor: () => '#000000',
}));

vi.mock('@/features/session/session-context', () => ({
  useSession: () => ({ status: sessionState.status, isHydrated: sessionState.isHydrated }),
}));

vi.mock('@/features/space/space-context', () => ({
  useSpace: () => ({
    status: spaceState.status,
    isHydrated: spaceState.isHydrated,
    space: { name: 'Test space', partnerName: 'Alex', relationshipStartDate: '2024-01-01T00:00:00.000Z' },
  }),
}));

vi.mock('@/features/moments/moments-context', () => ({
  useMoments: () => ({
    moments: [],
    activity: [],
    removeMoment: vi.fn(),
    isLoading: false,
    hasMoreMoments: false,
    loadMoreMoments: vi.fn(async () => false),
    loadBucketSummary: vi.fn(async () => ({ buckets: [], hasOlder: false })),
    loadChapterRange: vi.fn(async () => []),
    refresh: vi.fn(),
    error: null,
  }),
}));

vi.mock('@/features/moments/use-resurface-notification', () => ({
  useResurfaceNotification: () => {},
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

vi.mock('@/components/moments/moment-card', () => ({ MomentCard: () => null }));
vi.mock('@/components/moments/resurface-card', () => ({ ResurfaceCard: () => null }));
vi.mock('@/components/moments/tombstone-marker', () => ({ TombstoneMarker: () => null }));
vi.mock('@/components/ui/action-sheet', () => ({ ActionSheet: () => null }));
vi.mock('@/components/moments/pending-memory-row', () => ({ PendingMemoryRow: () => null }));
vi.mock('@/components/ui/frosted-backdrop', () => ({ FrostedBackdrop: () => null }));
vi.mock('@/features/composer/composer-context', () => ({
  useComposer: () => ({ pending: [], sendingIds: [] }),
  userSafeMessage: () => 'Could not keep this. Please try again.',
}));
vi.mock('@/components/moments/inline-memory-composer', () => {
  const React = require('react');
  return {
    InlineMemoryComposer: () =>
      React.createElement('div', { 'data-testid': 'inline-composer' }, '+ Keep something…'),
  };
});

beforeEach(() => {
  pushSpy.mockClear();
  capturedTabTriggers.length = 0;
  for (const key of Object.keys(capturedNativeTabsProps)) {
    delete capturedNativeTabsProps[key as keyof typeof capturedNativeTabsProps];
  }
  lastRedirectHref = null;
  sessionState = { status: 'signed_in', isHydrated: true };
  spaceState = { status: 'ready', isHydrated: true };
  themeState = { isHydrated: true };
  mockSegments = ['(auth)', 'sign-in'];
});

function tabTrigger(name: string) {
  return capturedTabTriggers.find((entry) => entry.name === name);
}

function tabSf(name: string, focused: boolean) {
  const sf = tabTrigger(name)?.sf;
  return focused ? sf?.selected : sf?.default;
}

function tabVectorIcon(name: string, focused: boolean) {
  const src = tabTrigger(name)?.src;
  return (focused ? src?.selected : src?.default)?.props?.name;
}

function tabIconNames() {
  const names: string[] = [];
  for (const entry of capturedTabTriggers) {
    for (const sf of [entry.sf?.default, entry.sf?.selected]) {
      if (typeof sf === 'string') names.push(sf);
    }
    for (const vector of [entry.src?.default, entry.src?.selected]) {
      const name = vector?.props?.name;
      if (typeof name === 'string') names.push(name);
    }
  }
  return names;
}

describe('authenticated default entry is Memories', () => {
  it('root index redirects a ready session to the Memories default (auth guard intact)', async () => {
    sessionState = { status: 'signed_in', isHydrated: true };
    spaceState = { status: 'ready', isHydrated: true };
    const { default: Index } = await import('@/app/index');
    render(<Index />);
    expect(lastRedirectHref).toBe('/(app)/(tabs)/(memories)');
  });

  it('root index still guards signed_out to public and unready to setup', async () => {
    sessionState = { status: 'signed_out', isHydrated: true };
    const { default: Index } = await import('@/app/index');
    const first = render(<Index />);
    expect(lastRedirectHref).toBe('/(public)');
    first.unmount();

    sessionState = { status: 'signed_in', isHydrated: true };
    spaceState = { status: 'loading', isHydrated: true };
    lastRedirectHref = null;
    render(<Index />);
    expect(lastRedirectHref).toBe('/(auth)/space-setup');
  });

  it('auth layout sends a ready sign-in straight to the Memories default', async () => {
    sessionState = { status: 'signed_in', isHydrated: true };
    spaceState = { status: 'ready', isHydrated: true };
    mockSegments = ['(auth)', 'sign-in'];
    const { default: AuthLayout } = await import('@/app/(auth)/_layout');
    render(<AuthLayout />);
    expect(lastRedirectHref).toBe('/(app)/(tabs)/(memories)');
  });

  it('public layout sends a ready session to the Memories default', async () => {
    sessionState = { status: 'signed_in', isHydrated: true };
    spaceState = { status: 'ready', isHydrated: true };
    const { default: PublicLayout } = await import('@/app/(public)/_layout');
    render(<PublicLayout />);
    expect(lastRedirectHref).toBe('/(app)/(tabs)/(memories)');
  });
});

describe('tab order and labels (Memories first)', () => {
  it('visible order is Memories, Us, Plans with the memories trigger first', async () => {
    const { default: TabsLayout } = await import('@/app/(app)/(tabs)/_layout');
    render(<TabsLayout />);
    expect(capturedTabTriggers.map((entry) => entry.name)).toEqual([
      '(memories)',
      'together',
      'plans',
    ]);
    expect(capturedTabTriggers.map((entry) => entry.label)).toEqual([
      'Memories',
      'Us',
      'Plans',
    ]);
    // Memories is the leading trigger the platform bar renders.
    expect(capturedTabTriggers[0]?.name).toBe('(memories)');
    // Book/mail/calendar SF + vector outline/filled pairs — and no hearts.
    const seen = tabIconNames();
    expect(seen.length).toBeGreaterThan(0);
    for (const name of seen) {
      expect(name).not.toMatch(/heart/i);
    }
    expect(tabSf('(memories)', false)).toBe('book');
    expect(tabSf('(memories)', true)).toBe('book.fill');
    expect(tabSf('together', false)).toBe('envelope');
    expect(tabSf('together', true)).toBe('envelope.fill');
    expect(tabSf('plans', false)).toBe('calendar');
    expect(tabSf('plans', true)).toBe('calendar.circle.fill');
    expect(tabVectorIcon('(memories)', false)).toBe('book-outline');
    expect(tabVectorIcon('(memories)', true)).toBe('book');
    expect(tabVectorIcon('together', false)).toBe('mail-outline');
    expect(tabVectorIcon('together', true)).toBe('mail');
    expect(tabVectorIcon('plans', false)).toBe('calendar-outline');
    expect(tabVectorIcon('plans', true)).toBe('calendar');
  });

  it('Memories feed renders at 320px with the FAB capture entry on the screen', async () => {
    const { default: TimelineScreen } = await import('@/app/(app)/(tabs)/(memories)/index');
    const feed = render(<TimelineScreen />);
    // The screen owns the pinned title; the native header is off.
    expect(screen.getByText('Memories')).toBeTruthy();
    // 320px no-overflow: the feed fills the window by percentage under a
    // max width (never a fixed width wider than the viewport), and the
    // round Add-memory FAB lives on the screen itself — not on a bar, and
    // with no persistent composer footer.
    const feedRoot = feed.container.firstElementChild as HTMLElement;
    expect(feedRoot.style.width).toBe('100%');
    expect(feedRoot.style.maxWidth).toBe('720px');
    const fab = screen.getByLabelText('Add memory') as HTMLElement;
    expect(fab.style.width).toBe('56px');
    expect(fab.style.height).toBe('56px');
    expect(fab.style.borderRadius).toBe('28px');
    expect(screen.queryByTestId('inline-composer')).toBeNull();
    expect(screen.queryByLabelText('Capture a moment')).toBeNull();
  });
});

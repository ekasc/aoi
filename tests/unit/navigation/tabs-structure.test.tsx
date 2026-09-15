import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, act } from '@testing-library/react';
import { Children, createElement, isValidElement, type ReactNode } from 'react';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

// The shared react-native mock passes Pressable `style` straight through,
// but tab screens compute `style={({ pressed }) => ...}`. Resolve press-state
// styles as unpressed so the real screens render in this file.
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
    if (typeof props.testID === 'string') {
      next['data-testid'] = props.testID;
    }
    if (typeof props.onPress === 'function') {
      next.onClick = props.onPress;
    }
    // Press-and-hold (Voice button): drive onPressIn/onPressOut with
    // mouseDown/mouseUp so tests can hold and release.
    if (typeof props.onPressIn === 'function') {
      next.onMouseDown = props.onPressIn;
    }
    if (typeof props.onPressOut === 'function') {
      next.onMouseUp = props.onPressOut;
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
    const content =
      typeof children === 'function'
        ? (children as (state: { pressed: boolean }) => unknown)({ pressed: false })
        : children;
    return createDiv(content, resolved, rest);
  };

  return {
    StyleSheet: {
      create: (styles: Record<string, unknown>) => styles,
      hairlineWidth: 1,
      absoluteFill: {},
      absoluteFillObject: {},
      flatten: flattenStyle,
    },
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
    View,
    Text,
    Pressable,
    ActivityIndicator: View,
    TextInput: (props: Record<string, unknown>) => {
      const { style, value, onChangeText, placeholder, autoFocus, ...rest } = props as {
        style?: unknown;
        value?: string;
        onChangeText?: (value: string) => void;
        placeholder?: string;
        autoFocus?: boolean;
      };
      return createElement('input', {
        style: flattenStyle(style),
        value: (value as string) ?? '',
        placeholder,
        autoFocus: autoFocus ? true : undefined,
        'data-autofocus': autoFocus ? 'true' : 'false',
        onChange: (event: { target: { value: string } }) =>
          (onChangeText as ((value: string) => void) | undefined)?.(event.target.value),
        ...withAriaProps(rest as Record<string, unknown>),
      });
    },
    KeyboardAvoidingView: View,
    ScrollView: (props: Record<string, unknown>) => {
      const { children, style, contentContainerStyle, contentInsetAdjustmentBehavior, showsVerticalScrollIndicator, ...rest } = props as {
        children?: unknown;
        style?: unknown;
        contentContainerStyle?: unknown;
        contentInsetAdjustmentBehavior?: unknown;
        showsVerticalScrollIndicator?: unknown;
      };
      void contentContainerStyle;
      void contentInsetAdjustmentBehavior;
      void showsVerticalScrollIndicator;
      return createDiv(children, style, rest as Record<string, unknown>);
    },
    FlatList: function FlatListMock(props: Record<string, unknown>) {
      const { ref: listRef, ...flatProps } = props as Record<string, unknown> & { ref?: unknown };
      if (listRef && typeof listRef === 'object') {
        (listRef as { current?: unknown }).current = {
          scrollToIndex: () => {},
          scrollToOffset: () => {},
        };
      }
      const {
        ListHeaderComponent,
        ListFooterComponent,
        children,
        style,
        data,
        renderItem,
        keyExtractor,
        ...rest
      } = flatProps as {
        ListHeaderComponent?: unknown;
        ListFooterComponent?: unknown;
        children?: unknown;
        style?: unknown;
        data?: Array<unknown>;
        renderItem?: (info: { item: unknown; index: number; separators: unknown }) => unknown;
        keyExtractor?: (item: unknown, index: number) => string;
      };
      // Header/footer are React elements in this codebase; render as-is.
      const header = isValidElement(ListHeaderComponent) ? ListHeaderComponent : null;
      const footer = isValidElement(ListFooterComponent) ? ListFooterComponent : null;
      // Timeline rows (day separators + moments) render from `data` via
      // `renderItem` — header/children/footer alone would hide the scroll
      // content the toolbar-date contract asserts about.
      function renderRow(item: unknown, index: number) {
        const key = typeof keyExtractor === 'function' ? keyExtractor(item, index) : index;
        const row = renderItem({ item, index, separators: {} });
        return createElement('div', { key }, row);
      }
      const items =
        Array.isArray(data) && typeof renderItem === 'function' ? data.map(renderRow) : null;
      return createElement(
        'div',
        { style: flattenStyle(style), ...withAriaProps(rest as Record<string, unknown>) },
        header,
        items,
        children,
        footer,
      );
    },
    Modal: (props: Record<string, unknown>) => {
      const { children, visible, ...rest } = props as { children?: unknown; visible?: boolean };
      if (visible === false) {
        return null;
      }
      return createDiv(children, undefined, rest as Record<string, unknown>);
    },
    AppState: {
      currentState: 'active',
      addEventListener: () => ({ remove: () => {} }),
    },
    Platform: { OS: 'ios', select: (options: { ios?: unknown }) => options.ios },
    Dimensions: { get: () => ({ width: 390, height: 844 }) },
    useWindowDimensions: () => ({ width: 390, height: 844, scale: 3, fontScale: 1 }),
    AccessibilityInfo: {
      isReduceMotionEnabled: () => Promise.resolve(false),
      isReduceTransparencyEnabled: () => Promise.resolve(mockReduceTransparency),
      addEventListener: (event: string, handler: (value: boolean) => void) => {
        if (event === 'reduceTransparencyChanged') {
          capturedTransparencyHandler = handler;
        }
        return { remove: () => {} };
      },
    },
  };
});

vi.mock('@expo/vector-icons', () => ({
  Ionicons: (props: { name?: unknown; size?: unknown; color?: unknown }) =>
    createElement('i', {
      'data-icon': String(props.name ?? ''),
      style: { fontSize: props.size, color: props.color },
    }),
}));

// The tabs layout passes the Ionicons family to native-tab VectorIcons
// (never rendered — config only), so the submodule stays a stub here.
vi.mock('@expo/vector-icons/Ionicons', () => ({
  default: () => null,
}));

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
    // Together now renders MemorySky which uses the reduced-motion +
    // shared-value surface. Mirror the shared setup mock (the passing
    // together suites rely on it) so this file renders the same contract.
    useReducedMotion: () => false,
    useSharedValue: (initial: unknown) => ({ value: initial }),
    useAnimatedStyle: () => ({}),
    withTiming: (value: unknown) => value,
    withSpring: (value: unknown) => value,
    withDelay: (_delay: number, value: unknown) => value,
    withRepeat: (value: unknown) => value,
    withSequence: (...values: unknown[]) => values[values.length - 1],
    cancelAnimation: () => {},
    Easing: {
      linear: {},
      sin: {},
      quad: {},
      cubic: {},
      inOut: (easing: unknown) => easing,
      in: (easing: unknown) => easing,
      out: (easing: unknown) => easing,
    },
  };
});

const pushSpy = vi.fn();
const capturedRedirect: { href: string | null } = { href: null };
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
const TABS_LAYOUT_SOURCE = readFileSync('app/(app)/(tabs)/_layout.tsx', 'utf8');
let mockReduceTransparency = false;
let mockLiquidGlassAvailable = false;
let capturedTransparencyHandler: ((value: boolean) => void) | null = null;
const sendSqueezeSpy = vi.fn();
let mockAudioGranted = true;
let mockAudioActive = false;
let mockAudioDuration = 0;
let mockAudioMetering: number | undefined = -20;
let mockAudioStatusHandler: ((status: any) => void) | null = null;
let mockRecorderOptions: unknown = null;
const mockPrepareToRecord = vi.fn(async () => {});
const mockRecordStart = vi.fn(() => {
  mockAudioActive = true;
});
const mockStopRecording = vi.fn(async () => {
  mockAudioActive = false;
});
const mockSetAudioMode = vi.fn(async () => {});

// The layout renders the OS tab bar (iOS 26 liquid glass / Material 3) and
// hands it the Ionicons family as config. Capture the bar's props and every
// Trigger in render order; MockVectorIcon renders its name through
// `data-icon` so the cross-platform icon names stay assertable.
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
  const React = require('react');
  return {
    useRouter: () => ({ push: pushSpy, back: vi.fn(), replace: vi.fn(), setParams: vi.fn() }),
    useLocalSearchParams: () => ({}),
    useFocusEffect: (effect: () => void | (() => void)) => {
      React.useEffect(() => {
        return effect();
      }, []);
    },
    useIsFocused: () => true,
    Redirect: function MockRedirect(props: { href: string }) {
      capturedRedirect.href = props.href;
      return createElement('div', { 'data-testid': 'redirect' });
    },
  };
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
  }),
}));

vi.mock('@/hooks/use-theme-color', () => ({
  useThemeColor: () => '#000000',
}));

vi.mock('@/features/session/session-context', () => ({
  useSession: () => ({
    user: { id: 'user_you', displayName: 'You', email: 'you@example.com' },
    signOut: vi.fn(),
  }),
}));

vi.mock('@/features/space/space-context', () => ({
  useSpace: () => ({
    space: {
      id: 'space-1',
      name: 'Test space',
      partnerName: 'Alex',
      relationshipStartDate: '2024-01-01T00:00:00.000Z',
      inviteCode: 'ABC123',
    },
    status: 'ready',
    leaveSpace: vi.fn(),
  }),
}));

vi.mock('@/features/squeeze/squeeze-context', () => ({
  useSqueeze: () => ({ sendSqueeze: sendSqueezeSpy, isSending: false }),
}));

// Unused by the Story feed (months derive from loaded moments); kept so
// the shared moments mock keeps its full shape for other suites.
const storyLoadBucketSummary = vi.fn(async () => {
  // Feed months derive from loaded moments; bucket discovery is gone.
  return { buckets: [], hasOlder: false };
});
const storyLoadMoreMoments = vi.fn(async () => false);
const storyMoments = [
  {
    id: 'test-moment-1',
    type: 'trace' as const,
    title: '',
    body: 'test memory',
    occurredAt: new Date().toISOString(),
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    authorId: 'user_you',
    authorRole: 'you' as const,
    authorName: 'You',
    isOwn: true,
  },
];
vi.mock('@/features/moments/moments-context', () => ({
  useMoments: () => ({
    moments: storyMoments,
    activity: [],
    removeMoment: vi.fn(),
    isLoading: false,
    error: null,
    refresh: vi.fn(async () => {}),
    hasMoreMoments: false,
    loadMoreMoments: storyLoadMoreMoments,
    loadBucketSummary: storyLoadBucketSummary,
    loadChapterRange: vi.fn(async () => []),
    loadGoals: vi.fn(async () => []),
  }),
}));

vi.mock('@/features/moments/use-resurface-notification', () => ({
  useResurfaceNotification: () => {},
}));

vi.mock('@/features/letters/letters-context', () => ({
  useLetters: () => ({
    letters: [],
    isLoading: false,
    error: null,
    reload: vi.fn(async () => {}),
  }),
}));

vi.mock('@/features/question/question-context', () => ({
  useQuestion: () => ({
    state: {
      weekKey: '2026-W32',
      questionId: 1,
      question: 'What small thing made today good?',
      yourAnswer: null,
      yourAnswerUpdatedAt: null,
      partnerAnswered: false,
      partnerAnswer: null,
      partnerName: 'Alex',
      revealed: false,
    },
    isLoading: false,
    error: null,
    reload: vi.fn(async () => {}),
  }),
}));

vi.mock('@/features/calendar/calendar-context', () => ({
  useCalendar: () => ({
    selectedDate: new Date('2026-01-15T00:00:00.000Z'),
    visibleMonth: new Date('2026-01-01T00:00:00.000Z'),
    eventsForDay: {},
    upcomingEvents: [],
    setSelectedDate: vi.fn(),
    setVisibleMonth: vi.fn(),
    isLoading: false,
    refresh: vi.fn(async () => {}),
  }),
}));

vi.mock('@/features/someday/someday-context', () => ({
  useSomeday: () => ({ openItems: [], doneItems: [] }),
}));

vi.mock('@/features/proposals/proposals-context', () => ({
  useProposals: () => ({
    proposals: [],
    accept: vi.fn(),
    decline: vi.fn(),
    reload: vi.fn(async () => {}),
  }),
}));

vi.mock('@/components/moments/moment-card', () => ({
  MomentCard: () => null,
}));

vi.mock('@/components/moments/resurface-card', () => ({
  ResurfaceCard: () => null,
}));

vi.mock('@/components/moments/tombstone-marker', () => ({
  TombstoneMarker: () => null,
}));

vi.mock('@/components/theme/theme-selector', () => ({
  ThemeSelector: () => null,
}));

vi.mock('@/features/export/raw-export', () => ({
  exportRawArchive: async () => ({ status: 'shared', mediaErrors: 0 }),
}));

vi.mock('@/features/legal/legal-links', () => ({
  getLegalLinks: () => ({}),
}));

vi.mock('@/features/subscription/subscription-context', () => ({
  useSubscription: () => ({ isPlus: false, status: 'free' }),
}));

vi.mock('@/components/ui/surface', () => ({
  Surface: ({ children }: { children?: unknown }) =>
    createElement('div', {}, children),
}));

vi.mock('@/components/ui/action-sheet', () => ({
  ActionSheet: ({ visible, title, actions }: { visible?: boolean; title?: string; actions?: Array<{ label: string; onPress: () => void }> }) => {
    if (!visible) return null;
    return createElement(
      'div',
      { 'data-testid': `sheet:${title ?? ''}` },
      (actions ?? []).map((a) => createElement('button', { key: a.label, onClick: a.onPress }, a.label)),
    );
  },
}));

vi.mock('expo-blur', () => ({
  BlurView: (props: { testID?: string; intensity?: number; tint?: string }) =>
    createElement('div', {
      'data-testid': props.testID ?? 'tab-bar-blur',
      'data-intensity': String(props.intensity ?? ''),
      'data-tint': props.tint ?? '',
    }),
}));

vi.mock('expo-glass-effect', () => ({
  GlassView: (props: { testID?: string }) =>
    createElement('div', {
      'data-testid': props.testID ?? 'tab-bar-glass',
    }),
  isLiquidGlassAvailable: () => mockLiquidGlassAvailable,
}));

vi.mock('expo-audio', () => ({
  RecordingPresets: { HIGH_QUALITY: { extension: '.m4a' } },
  requestRecordingPermissionsAsync: vi.fn(async () => ({ granted: mockAudioGranted })),
  setAudioModeAsync: (...args: unknown[]) => mockSetAudioMode(...(args as [])),
  useAudioRecorder: (options: unknown, onStatus: unknown) => {
    mockRecorderOptions = options;
    mockAudioStatusHandler = onStatus as ((status: unknown) => void) | null;
    return {
      prepareToRecordAsync: (...args: unknown[]) => mockPrepareToRecord(...(args as [])),
      record: (...args: unknown[]) => mockRecordStart(...(args as [])),
      stop: (...args: unknown[]) => mockStopRecording(...(args as [])),
    };
  },
  useAudioRecorderState: () => ({
    canRecord: true,
    isRecording: mockAudioActive,
    durationMillis: mockAudioDuration,
    mediaServicesDidReset: false,
    url: null,
    metering: mockAudioMetering,
  }),
}));

vi.mock('@/features/composer/composer-context', () => ({
  useComposer: () => ({ pending: [], sendingIds: [] }),
  userSafeMessage: () => 'Could not keep this. Please try again.',
}));

vi.mock('@/components/moments/inline-memory-composer', () => ({
  InlineMemoryComposer: () => {
    const React = require('react');
    return React.createElement('div', { 'data-testid': 'inline-composer' }, '+ Keep something\u2026');
  },
}));

vi.mock('@/components/moments/pending-memory-row', () => ({
  PendingMemoryRow: () => null,
}));

vi.mock('@/components/media/voice-recorder', () => ({
  VoiceRecorder: ({ onRecorded }: { onRecorded: (uri: string) => void }) =>
    createElement(
      'button',
      { 'aria-label': 'Record voice', onClick: () => onRecorded('file:///voice.m4a') },
      'Record voice'
    ),
}));

beforeEach(() => {
  pushSpy.mockClear();
  mockAudioGranted = true;
  mockAudioActive = false;
  mockAudioDuration = 0;
  mockAudioMetering = -20;
  mockAudioStatusHandler = null;
  mockRecorderOptions = null;
  mockPrepareToRecord.mockClear();
  mockRecordStart.mockClear();
  mockStopRecording.mockClear();
  mockSetAudioMode.mockClear();
  sendSqueezeSpy.mockReset();
  sendSqueezeSpy.mockResolvedValue(undefined);
  capturedTabTriggers.length = 0;
  for (const key of Object.keys(capturedNativeTabsProps)) {
    delete capturedNativeTabsProps[key as keyof typeof capturedNativeTabsProps];
  }
  capturedRedirect.href = null;
  mockReduceTransparency = false;
  mockLiquidGlassAvailable = false;
  process.env.EXPO_OS = 'ios';
  capturedTransparencyHandler = null;
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

async function renderTabsLayout() {
  const { default: TabsLayout } = await import('@/app/(app)/(tabs)/_layout');
  return render(<TabsLayout />);
}

describe('P2A tab structure (system tab bar)', () => {
  it('declares exactly Memories, Us, Plans triggers in that visible order', async () => {
    await renderTabsLayout();
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
  });

  it('pins Memories first and renders the system bar, not an app-owned row', async () => {
    await renderTabsLayout();
    // The leading trigger is the Memories route.
    expect(capturedTabTriggers[0]?.name).toBe('(memories)');
    // The OS tab bar takes the theme accent, and the layout hands it no
    // custom bar to render.
    expect(capturedNativeTabsProps.tintColor).toBe('#334E45');
    expect('tabBar' in capturedNativeTabsProps).toBe(false);
    // The layout imports the native-tab navigator; the app-owned row and its
    // JS tabs entry are gone from the production import graph.
    expect(TABS_LAYOUT_SOURCE).toContain("from 'expo-router/unstable-native-tabs'");
    expect(TABS_LAYOUT_SOURCE).toContain('NativeTabs');
    expect(TABS_LAYOUT_SOURCE).not.toContain('TabBarRow');
    expect(TABS_LAYOUT_SOURCE).not.toContain('js-tabs');
  });

  it('has no Profile or Settings triggers', async () => {
    await renderTabsLayout();
    const names = capturedTabTriggers.map((entry) => entry.name);
    expect(names).not.toContain('profile');
    expect(names).not.toContain('settings');
  });

  it('uses book/mail/calendar SF + vector pairs — no hearts anywhere in the bar', async () => {
    const { container } = await renderTabsLayout();
    const seen = tabIconNames();
    expect(seen.length).toBeGreaterThan(0);
    for (const name of seen) {
      expect(name).not.toMatch(/heart/i);
    }
    // SF Symbols on iOS, with filled selected states.
    expect(tabSf('(memories)', false)).toBe('book');
    expect(tabSf('(memories)', true)).toBe('book.fill');
    expect(tabSf('together', false)).toBe('envelope');
    expect(tabSf('together', true)).toBe('envelope.fill');
    expect(tabSf('plans', false)).toBe('calendar');
    expect(tabSf('plans', true)).toBe('calendar.circle.fill');
    // The same outline/filled pairs cross-platform through Ionicons.
    expect(tabVectorIcon('(memories)', false)).toBe('book-outline');
    expect(tabVectorIcon('(memories)', true)).toBe('book');
    expect(tabVectorIcon('together', false)).toBe('mail-outline');
    expect(tabVectorIcon('together', true)).toBe('mail');
    expect(tabVectorIcon('plans', false)).toBe('calendar-outline');
    expect(tabVectorIcon('plans', true)).toBe('calendar');
    // The bar renders those Ionicons in trigger order.
    expect(
      Array.from(container.querySelectorAll('[data-icon]')).map((icon) =>
        icon.getAttribute('data-icon')
      )
    ).toEqual([
      'book-outline',
      'book',
      'mail-outline',
      'mail',
      'calendar-outline',
      'calendar',
    ]);
  });
});

describe('P2A Together ownership', () => {
  it('exposes Letters and This week with squeeze, but neither Someday nor Memory wall', async () => {
    const { default: TogetherScreen } = await import('@/app/(app)/(tabs)/together');
    const { container } = render(<TogetherScreen />);
    expect(screen.getByText('Letters')).toBeTruthy();
    expect(screen.getByText('This week')).toBeTruthy();
    expect(screen.getByText('Squeeze')).toBeTruthy();
    expect(screen.queryByText('Someday')).toBeNull();
    expect(screen.queryByText('Memory wall')).toBeNull();
    // Calm contract: the capture trio stays hidden until the Keep a memory
    // toggle is asked (progressive disclosure, mirror together-actions).
    expect(screen.queryByLabelText('Keep a photo memory')).toBeNull();
    expect(screen.queryByLabelText('Keep a note memory')).toBeNull();
    expect(screen.queryByLabelText('Keep a voice memory')).toBeNull();
    fireEvent.click(screen.getByLabelText('Keep a memory'));
    // Current contract: chunky Keep-a-memory targets (64px min-height,
    // 44px min-width, camera/pencil/mic glyphs) mirror together-actions.
    const keeps: Array<[string, string, string]> = [
      ['Keep a photo memory', 'Photo', 'camera'],
      ['Keep a note memory', 'Note', 'pencil'],
      ['Keep a voice memory', 'Voice', 'mic'],
    ];
    for (const [a11y, label, icon] of keeps) {
      const target = screen.getByLabelText(a11y) as HTMLElement;
      expect(target.textContent).toContain(label);
      expect(container.querySelector(`[data-icon="${icon}"]`)).toBeTruthy();
      expect(target.style.minHeight).toMatch(/64/);
      expect(target.style.minWidth).toMatch(/44/);
    }
    // Unified routes: every Keep target goes to Memories composer intents.
    fireEvent.click(screen.getByLabelText('Keep a photo memory'));
    expect(pushSpy).toHaveBeenCalledWith({
      pathname: '/(app)/(tabs)/(memories)',
      params: { compose: 'photos' },
    });
    fireEvent.click(screen.getByLabelText('Keep a note memory'));
    expect(pushSpy).toHaveBeenLastCalledWith({
      pathname: '/(app)/(tabs)/(memories)',
      params: { compose: 'note' },
    });
    expect(screen.queryByText('Keep a note')).toBeNull();
    // Current contract: small centered squeeze heart pill (44px min-height,
    // 44px min-width, pill radius, centered) mirror together-cute/sheets.
    const pill = screen.getByLabelText('Send a squeeze to your partner') as HTMLElement;
    expect(pill.style.minHeight).toMatch(/44/);
    expect(pill.style.minWidth).toMatch(/44/);
    expect(pill.style.borderRadius).toMatch(/999/);
    expect(pill.style.alignSelf).toMatch(/center/);
    expect(container.querySelector('[data-icon="heart"]')).toBeTruthy();
    // Voice is a plain tap to Memories — no Us overlay, no hold timers.
    fireEvent.click(screen.getByLabelText('Keep a voice memory'));
    expect(pushSpy).toHaveBeenLastCalledWith({
      pathname: '/(app)/(tabs)/(memories)',
      params: { compose: 'voice' },
    });
    expect(screen.queryByLabelText('Recording voice note. Release to finish.')).toBeNull();
    expect(screen.queryByLabelText('Voice note ready to send.')).toBeNull();
  });

  it('sends a squeeze from the centered compact pill', async () => {
    const { default: TogetherScreen } = await import('@/app/(app)/(tabs)/together');
    const { container } = render(<TogetherScreen />);
    // Current contract is a small centered squeeze heart pill, not a
    // secondary-row button — assert the pill sizing before sending.
    const pill = screen.getByLabelText('Send a squeeze to your partner') as HTMLElement;
    expect(pill.style.minHeight).toMatch(/44/);
    expect(pill.style.minWidth).toMatch(/44/);
    expect(pill.style.borderRadius).toMatch(/999/);
    expect(pill.style.alignSelf).toMatch(/center/);
    expect(container.querySelector('[data-icon="heart"]')).toBeTruthy();
    expect(screen.getByText('Squeeze')).toBeTruthy();
    fireEvent.click(screen.getByLabelText('Send a squeeze to your partner'));
    // Production sends via Promise.resolve().then — flush the microtask.
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(sendSqueezeSpy).toHaveBeenCalledTimes(1);
  });
});

describe('P2A Memories ownership', () => {
  it('owns the pinned header in-screen: title, search chrome, Space entry, and the Add-memory FAB; no archive menu', async () => {
    const { default: MemoriesScreen } = await import('@/app/(app)/(tabs)/(memories)/index');
    render(<MemoriesScreen />);
    // One stream, no separate destinations: no title-menu, no Photos row.
    // The screen renders its own pinned title (the native header is off).
    expect(screen.getByText('Memories')).toBeTruthy();
    expect(screen.queryByLabelText('Memories, open archive menu')).toBeNull();
    // One archive: the four kinds are filters, never separate destinations.
    // Filters ride with the on-demand search control (the archive opens
    // clean), so open search before asserting them.
    fireEvent.click(screen.getByLabelText('Search memories'));
    expect(screen.getByLabelText('Photos filter')).toBeTruthy();
    expect(screen.getByLabelText('Search memories')).toBeTruthy();
    // Capture is back on the screen itself: the round glass FAB over the feed.
    const fab = screen.getByLabelText('Add memory') as HTMLElement;
    expect(fab.style.width).toBe('56px');
    expect(fab.style.height).toBe('56px');
    expect(fab.style.borderRadius).toBe('28px');
    // The Space entry rides the in-screen header now.
    expect(screen.getByLabelText('Open Space settings')).toBeTruthy();
    // No persistent composer footer — capture lives in the dedicated editor.
    expect(screen.queryByTestId('inline-composer')).toBeNull();
  });

  it('opens the dedicated editor from the header Add-memory entry', async () => {
    const { default: MemoriesScreen } = await import('@/app/(app)/(tabs)/(memories)/index');
    render(<MemoriesScreen />);
    fireEvent.click(screen.getByLabelText('Add memory'));
    expect(pushSpy).toHaveBeenCalledWith('/(app)/moment/new');
  });

  it('reaches the month chapter from Memories', async () => {
    const { default: MemoriesScreen } = await import('@/app/(app)/(tabs)/(memories)/index');
    render(<MemoriesScreen />);
    const at = new Date(storyMoments[0].occurredAt);
    const monthKey = `${at.getFullYear()}-${String(at.getMonth() + 1).padStart(2, '0')}`;
    const monthLabel = at.toLocaleDateString('en-US', { month: 'long', year: 'numeric' });
    fireEvent.click(await screen.findByLabelText(`Open ${monthLabel} chapter`));
    expect(pushSpy).toHaveBeenCalledWith(`/(app)/chapter/month:${monthKey}`);
  });

  it('groups the stream oldest-first under month sections, dates live in the list', async () => {
    const { default: MemoriesScreen } = await import('@/app/(app)/(tabs)/(memories)/index');
    await act(async () => {
      render(<MemoriesScreen />);
    });
    // Month sections derive from each memory's ACTUAL occurredAt (long
    // month + year) with a per-month count — chapters inline, never a
    // separate discovery list.
    const at = new Date(storyMoments[0].occurredAt);
    const expectedMonth = at.toLocaleDateString('en-US', {
      month: 'long',
      year: 'numeric',
    });
    await act(async () => {});
    await act(async () => {});
    // Capture is the screen's own FAB, not a stream-header composer.
    expect(screen.getByLabelText('Add memory')).toBeTruthy();
    expect(screen.queryByTestId('inline-composer')).toBeNull();
    expect(screen.queryByLabelText('Capture a moment')).toBeNull();
    // The date lives once as a month section in the list under the
    // in-screen pinned header; the header owns the single "Memories" title.
    expect(screen.getByText('Memories')).toBeTruthy();
    expect(await screen.findByText(expectedMonth)).toBeTruthy();
    expect(screen.getAllByText(expectedMonth)).toHaveLength(1);
    expect(screen.queryByText('1 memory')).toBeNull();
  });
});

describe('P2A Plans ownership', () => {
  it('exposes Someday and the avatar entry', async () => {
    const { default: CalendarScreen } = await import('@/app/(app)/(tabs)/plans');
    render(<CalendarScreen />);
    expect(screen.getByText('Someday')).toBeTruthy();
    expect(screen.getByLabelText('Open Space settings')).toBeTruthy();
  });

  it('reaches Someday and Space from Plans', async () => {
    const { default: CalendarScreen } = await import('@/app/(app)/(tabs)/plans');
    render(<CalendarScreen />);
    fireEvent.click(screen.getByText('Open list'));
    expect(pushSpy).toHaveBeenCalledWith('/(app)/someday');
    fireEvent.click(screen.getByLabelText('Open Space settings'));
    expect(pushSpy).toHaveBeenCalledWith('/(app)/space', { withAnchor: true });
  });
});

describe('P2A Space surface', () => {
  it('keeps relationship content with a Space/Account switch and no location UI', async () => {
    const { default: SpaceScreen } = await import('@/app/(app)/space');
    render(<SpaceScreen />);
    expect(screen.getAllByText('Space').length).toBeGreaterThanOrEqual(1);
    expect(screen.getByText('Edit relationship')).toBeTruthy();
    // One screen, two segments — no nested settings route.
    expect(screen.getByText('Account')).toBeTruthy();
    expect(screen.queryByText('App settings')).toBeNull();
    expect(screen.queryByText('Location sharing settings')).toBeNull();
    expect(screen.queryByText('Location')).toBeNull();
  });

  it('reveals account controls on the same screen without navigating', async () => {
    const { default: SpaceScreen } = await import('@/app/(app)/space');
    render(<SpaceScreen />);
    expect(screen.queryByText('Sign out')).toBeNull();
    fireEvent.click(screen.getByText('Account'));
    expect(screen.getByText('Sign out')).toBeTruthy();
    expect(screen.getByText('Leave space')).toBeTruthy();
    expect(pushSpy).not.toHaveBeenCalledWith('/(app)/settings');
  });
});

describe('P2A legacy redirects', () => {
  // Real route discovery: Expo Router registers every file in the tab
  // group, so the directory listing IS the tab candidate set — this fails
  // if anyone drops another screen into (tabs), mock or not.
  const tabsDir = join(import.meta.dirname, '../../../app/(app)/(tabs)');
  const discoveredTabScreens = () =>
    readdirSync(tabsDir)
      .filter((entry) => entry.endsWith('.tsx') && entry !== '_layout.tsx')
      .map((entry) => entry.replace(/\.tsx$/, ''))
      .sort();

  it('tab routes are the memories group plus the Us and Plans screens', () => {
    expect(discoveredTabScreens()).toEqual(['plans', 'together']);
    const memoriesDir = join(tabsDir, '(memories)');
    expect(readdirSync(memoriesDir).sort()).toEqual(['_layout.tsx', 'index.tsx']);
  });

  it('declared triggers match the route structure, Memories first', async () => {
    await renderTabsLayout();
    expect(capturedTabTriggers.map((entry) => entry.name)).toEqual([
      '(memories)',
      'together',
      'plans',
    ]);
  });

  it('legacy profile redirect lives outside the tab group with the same deep link', async () => {
    // Route groups are URL-transparent: (app)/profile serves the same
    // /profile deep link the tab-group file used to serve.
    expect(existsSync(join(import.meta.dirname, '../../../app/(app)/(tabs)/profile.tsx'))).toBe(false);
    expect(existsSync(join(import.meta.dirname, '../../../app/(app)/profile.tsx'))).toBe(true);
    const { default: LegacyProfileRedirect } = await import('@/app/(app)/profile');
    render(<LegacyProfileRedirect />);
    expect(capturedRedirect.href).toBe('/(app)/space');
  });

  it('legacy settings redirects into the Space account segment, not a second screen', async () => {
    // The standalone settings screen is gone: account controls live in the
    // Space screen's Account segment, so /settings resolves to /(app)/space.
    expect(existsSync(join(import.meta.dirname, '../../../app/(app)/(tabs)/settings.tsx'))).toBe(false);
    expect(existsSync(join(import.meta.dirname, '../../../app/(app)/settings.tsx'))).toBe(true);
    const { default: LegacySettingsRedirect } = await import('@/app/(app)/settings');
    render(<LegacySettingsRedirect />);
    expect(capturedRedirect.href).toBe('/(app)/space');
  });
});

const capturedStackScreens: Array<{ name: string; options?: Record<string, unknown> }> = [];
const capturedStackOptions: Record<string, unknown> = {};

// The memories stack layout imports Stack from the real
// 'expo-router/stack' entrypoint — mirror that submodule so the test
// reflects the production import graph.
vi.mock('expo-router/stack', () => {
  function MockStack({ children, screenOptions }: { children?: unknown; screenOptions?: Record<string, unknown> }) {
    Object.assign(capturedStackOptions, screenOptions ?? {});
    return createElement('div', { 'data-testid': 'memories-stack' }, children);
  }
  function MockStackScreen(props: { name: string; options?: Record<string, unknown> }) {
    capturedStackScreens.push(props);
    return null;
  }
  (MockStack as Record<string, unknown>).Screen = MockStackScreen;
  return { Stack: MockStack };
});

describe('Memories stack layout', () => {
  beforeEach(() => {
    capturedStackScreens.length = 0;
    for (const key of Object.keys(capturedStackOptions)) delete capturedStackOptions[key];
  });

  it('hides the native header so the screen owns the pinned title', async () => {
    const { default: MemoriesStack } = await import('@/app/(app)/(tabs)/(memories)/_layout');
    render(<MemoriesStack />);
    expect(capturedStackOptions.headerShown).toBe(false);
    expect(capturedStackScreens.map((entry) => entry.name)).toEqual(['index']);
    // No native title/chrome: the screen renders the title itself.
    expect(capturedStackScreens[0].options?.title).toBeUndefined();
    expect(capturedStackOptions.headerLargeTitle).toBeUndefined();
  });

  it('keeps the Space entry on the screen, not the native header', async () => {
    const { default: MemoriesScreen } = await import('@/app/(app)/(tabs)/(memories)/index');
    render(<MemoriesScreen />);
    fireEvent.click(screen.getByLabelText('Open Space settings'));
    expect(pushSpy).toHaveBeenCalledWith('/(app)/space', { withAnchor: true });
  });
});

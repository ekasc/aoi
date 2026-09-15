import { act, fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createElement, isValidElement } from 'react';

import type { Moment } from '@/features/moments/types';

/**
 * Regression tests for the Memories feed's paging edge.
 *
 * The feed is chronological (oldest at the top) and older pages are
 * prepended above the current rows, so the top edge is the only edge that
 * may fetch. A bottom-edge trigger (FlatList onEndReached) fetches the wrong
 * direction, and on a feed shorter than the viewport it fires during layout
 * and pages through history nobody asked for. These tests drive the real
 * screen's real scroll handler and assert the trigger contract: nothing on
 * mount, nothing at the bottom, exactly one fetch per leave-and-return to
 * the top, nothing while in flight, and — for a list with no scroll range at
 * all — an explicit control instead of a silent dead end.
 */

function moment(id: string, occurredAt: string, extra: Partial<Moment> = {}): Moment {
  return {
    id,
    type: 'note',
    title: '',
    body: `memory ${id}`,
    occurredAt,
    createdAt: occurredAt,
    updatedAt: occurredAt,
    authorId: 'user_you',
    authorRole: 'you',
    authorName: 'You',
    isOwn: true,
    ...extra,
  };
}

/** Three rows, two months, one photo — both presentations populated. */
const MOMENTS: Moment[] = [
  moment('m-1', '2026-01-04T10:00:00.000Z', { mediaPreview: 'https://cdn.test/a.jpg' }),
  moment('m-2', '2026-01-19T10:00:00.000Z'),
  moment('m-3', '2026-02-02T10:00:00.000Z'),
];

const loadMoreMoments = vi.fn(async () => false);
let hasMoreMoments = true;
/** Mirrors the context's paging failure, so the header states are testable. */
let pagingError: string | null = null;

/** Captured FlatList props per presentation, so the wiring is assertable. */
const capturedLists: Record<string, Record<string, any>> = {};

/**
 * React strips `key`, so the two lists are told apart by their row shapes:
 * the Feed carries pending/moment rows, the Gallery carries grid rows.
 */
function listVariant(data: unknown): 'feed' | 'gallery' | 'unknown' {
  if (!Array.isArray(data) || data.length === 0) return 'unknown';
  if (data.some((row: any) => row?.kind === 'grid')) return 'gallery';
  if (data.some((row: any) => row?.kind === 'moment' || row?.kind === 'pending')) return 'feed';
  return 'unknown';
}

vi.mock('react-native', () => {
  const React = require('react');

  function flattenStyle(style: any): any {
    if (Array.isArray(style)) {
      const merged: Record<string, any> = {};
      for (const entry of style) {
        const flat = flattenStyle(entry);
        if (flat && typeof flat === 'object') Object.assign(merged, flat);
      }
      return merged;
    }
    return style;
  }

  // RN props are not DOM attributes: mirror the ones tests query and drop
  // the rest, so the mocked tree stays quiet.
  const RN_ONLY = new Set([
    'accessible',
    'accessibilityHint',
    'accessibilityRole',
    'accessibilityState',
    'accessibilityLabel',
    'accessibilityLiveRegion',
    'accessibilityViewIsModal',
    'accessibilityElementsHidden',
    'importantForAccessibility',
    'onPress',
    'onPressIn',
    'onPressOut',
    'onLongPress',
  ]);

  function withAriaProps(props: Record<string, any>): Record<string, any> {
    const next: Record<string, any> = {};
    for (const [key, value] of Object.entries(props)) {
      if (!RN_ONLY.has(key)) next[key] = value;
    }
    if (typeof props.accessibilityLabel === 'string') next['aria-label'] = props.accessibilityLabel;
    if (typeof props.testID === 'string') next['data-testid'] = props.testID;
    if (typeof props.onPress === 'function') next.onClick = props.onPress;
    return next;
  }

  const View = ({ children, style, ...rest }: any) =>
    React.createElement('div', { style: flattenStyle(style), ...withAriaProps(rest) }, children);

  const Text = ({ children, style, ...rest }: any) =>
    React.createElement('span', { style: flattenStyle(style), ...withAriaProps(rest) }, children);

  const Pressable = ({ children, style, ...rest }: any) => {
    const resolved = typeof style === 'function' ? style({ pressed: false }) : style;
    const content = typeof children === 'function' ? children({ pressed: false }) : children;
    return React.createElement('div', { style: flattenStyle(resolved), ...withAriaProps(rest) }, content);
  };

  const TextInput = ({ style, value, onChangeText, ...rest }: any) =>
    React.createElement('input', {
      style: flattenStyle(style),
      value: value ?? '',
      onChange: (event: any) => onChangeText?.(event.target.value),
      ...withAriaProps(rest),
    });

  const ScrollView = ({ children, style, ...rest }: any) =>
    React.createElement('div', { style: flattenStyle(style), ...withAriaProps(rest) }, children);

  function FlatList(props: any) {
    const {
      // List props RN owns: captured above, kept out of the DOM.
      ListHeaderComponent,
      ListFooterComponent,
      ListEmptyComponent,
      contentContainerStyle,
      contentInsetAdjustmentBehavior,
      keyboardDismissMode,
      scrollEventThrottle,
      showsVerticalScrollIndicator,
      alwaysBounceVertical,
      bounces,
      refreshing,
      onRefresh,
      onLayout,
      onContentSizeChange,
      maintainVisibleContentPosition,
      onScroll,
      onScrollEndDrag,
      onMomentumScrollBegin,
      onMomentumScrollEnd,
      data,
      renderItem,
      keyExtractor,
      style,
      children,
      ...rest
    } = props;
    void contentContainerStyle;
    void contentInsetAdjustmentBehavior;
    void keyboardDismissMode;
    void scrollEventThrottle;
    void showsVerticalScrollIndicator;
    void alwaysBounceVertical;
    void bounces;
    void refreshing;
    void onRefresh;
    void onLayout;
    void onContentSizeChange;
    void maintainVisibleContentPosition;
    void onScrollEndDrag;
    void onMomentumScrollBegin;
    void onMomentumScrollEnd;

    capturedLists[listVariant(data)] = {
      ...rest,
      ListHeaderComponent,
      ListFooterComponent,
      ListEmptyComponent,
      maintainVisibleContentPosition,
      onScroll,
      onLayout,
      onContentSizeChange,
      data,
    };

    const header = isValidElement(ListHeaderComponent) ? ListHeaderComponent : null;
    const footer = isValidElement(ListFooterComponent) ? ListFooterComponent : null;
    const rows =
      Array.isArray(data) && typeof renderItem === 'function'
        ? data.map((item: unknown, index: number) =>
            React.createElement(
              'div',
              { key: typeof keyExtractor === 'function' ? keyExtractor(item, index) : index },
              renderItem({ item, index, separators: {} })
            )
          )
        : null;

    return React.createElement(
      'div',
      { 'data-testid': 'list', style: flattenStyle(style) },
      header ? React.createElement('div', { 'data-testid': 'list-header' }, header) : null,
      rows,
      children,
      footer ? React.createElement('div', { 'data-testid': 'list-footer' }, footer) : null
    );
  }

  class AnimatedValue {
    setValue(): void {}
    addListener(): string {
      return '0';
    }
    removeListener(): void {}
    removeAllListeners(): void {}
    interpolate(): Record<string, never> {
      return {};
    }
  }

  function animation() {
    return {
      start: (callback?: (result: { finished: boolean }) => void) =>
        callback?.({ finished: true }),
      stop: () => {},
      reset: () => {},
    };
  }

  return {
    StyleSheet: {
      create: (styles: Record<string, unknown>) => styles,
      hairlineWidth: 1,
      absoluteFill: {},
    },
    Animated: {
      View,
      Text,
      Value: AnimatedValue,
      timing: animation,
      spring: animation,
      delay: () => animation(),
      parallel: animation,
      sequence: animation,
      event: () => () => {},
      createAnimatedComponent: (component: unknown) => component,
    },
    Easing: {
      bezier: () => ({}),
      in: (v: unknown) => v,
      out: (v: unknown) => v,
      inOut: (v: unknown) => v,
      linear: {},
    },
    View,
    Text,
    Pressable,
    TextInput,
    ScrollView,
    FlatList,
    ActivityIndicator: View,
    Modal: View,
    KeyboardAvoidingView: View,
    AppState: { currentState: 'active', addEventListener: () => ({ remove: () => {} }) },
    Platform: { OS: 'ios', select: (options: { ios?: unknown }) => options.ios },
    Dimensions: { get: () => ({ width: 390, height: 844 }) },
    useWindowDimensions: () => ({ width: 390, height: 844, scale: 3, fontScale: 1 }),
    AccessibilityInfo: {
      isReduceMotionEnabled: () => Promise.resolve(false),
      isReduceTransparencyEnabled: () => Promise.resolve(false),
      addEventListener: () => ({ remove: () => {} }),
    },
  };
});

vi.mock('react-native-reanimated', () => ({
  default: { View: ({ children }: { children?: unknown }) => createElement('div', {}, children) },
  useReducedMotion: () => false,
  useSharedValue: (initial: unknown) => ({ value: initial }),
  useAnimatedStyle: () => ({}),
  withTiming: (value: unknown) => value,
  withSpring: (value: unknown) => value,
}));

vi.mock('react-native-safe-area-context', () => ({
  useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }),
}));

vi.mock('expo-router', () => ({
  useRouter: () => ({ push: vi.fn(), back: vi.fn(), replace: vi.fn(), setParams: vi.fn() }),
  useLocalSearchParams: () => ({}),
  useIsFocused: () => true,
  useFocusEffect: (effect: () => void | (() => void)) => {
    const React = require('react');
    React.useEffect(() => effect(), []);
  },
}));

vi.mock('@/features/moments/moments-context', () => ({
  useMoments: () => ({
    moments: MOMENTS,
    removeMoment: vi.fn(),
    isLoading: false,
    error: null,
    refresh: vi.fn(async () => {}),
    hasMoreMoments,
    pagingError,
    loadMoreMoments: (...args: unknown[]) => loadMoreMoments(...(args as [])),
    loadChapterRange: vi.fn(async () => []),
    loadGoals: vi.fn(async () => []),
  }),
}));

vi.mock('@/features/composer/composer-context', () => ({
  useComposer: () => ({ pending: [], sendingIds: [], acknowledgeDelivered: vi.fn(async () => {}) }),
  userSafeMessage: () => 'Could not keep this. Please try again.',
}));

vi.mock('@/features/moments/use-resurface-notification', () => ({
  useResurfaceNotification: () => {},
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

vi.mock('@/hooks/use-theme-color', () => ({ useThemeColor: () => '#000000' }));

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

vi.mock('@/features/haptics/haptics', () => ({
  haptics: { select: () => {}, impact: () => {}, tap: () => {}, notify: () => {} },
}));

vi.mock('expo-haptics', () => ({
  selectionAsync: async () => {},
  impactAsync: async () => {},
  notificationAsync: async () => {},
  ImpactFeedbackStyle: { Light: 'light', Medium: 'medium', Heavy: 'heavy' },
  NotificationFeedbackType: { Success: 'success', Warning: 'warning', Error: 'error' },
}));

vi.mock('expo-blur', () => ({
  BlurView: ({ children }: { children?: unknown }) => createElement('div', {}, children),
}));

vi.mock('expo-glass-effect', () => ({
  GlassView: ({ children }: { children?: unknown }) => createElement('div', {}, children),
  isLiquidGlassAvailable: () => false,
}));

// The screen's own chrome is out of scope here: stub everything that is not
// a list, a row, or the fetch controls so only the paging contract is under
// test.
vi.mock('@/components/home/memory-sky', () => ({
  MemorySky: () => null,
  fabBottomOffset: (inset: number) => inset + 8,
}));

vi.mock('@/components/space/space-avatar-button', () => ({
  SpaceAvatarButton: () => null,
}));

vi.mock('@/components/ui/frosted-backdrop', () => ({ FrostedBackdrop: () => null }));

vi.mock('@/components/ui/glass-surface', () => ({
  GlassSurface: ({ children }: { children?: unknown }) => createElement('div', {}, children),
}));

vi.mock('@/components/moments/moment-card', () => ({ MomentCard: () => null }));

vi.mock('@/components/moments/gallery-tile', () => ({ GalleryTile: () => null }));

vi.mock('@/components/moments/pending-memory-row', () => ({ PendingMemoryRow: () => null }));

vi.mock('@/components/moments/photo-viewer', () => ({
  PhotoViewer: () => null,
}));

vi.mock('@/components/ui/action-sheet', () => ({ ActionSheet: () => null }));

// The Feed/Gallery switch is a two-option control; render it as buttons so
// the tests can read the same list wiring in both presentations.
vi.mock('@/components/ui/segmented-control', () => ({
  SegmentedControl: ({
    options,
    value,
    onChange,
    accessibilityLabel,
  }: {
    options: { value: string; label: string }[];
    value: string;
    onChange: (value: string) => void;
    accessibilityLabel?: string;
  }) =>
    createElement(
      'div',
      { 'aria-label': accessibilityLabel },
      options.map((option) =>
        createElement(
          'button',
          {
            key: option.value,
            'data-selected': String(option.value === value),
            onClick: () => onChange(option.value),
          },
          option.label
        )
      )
    ),
}));

const VIEWPORT = 844;

type Captured = Record<string, any>;

function feedList(): Captured {
  const list = capturedLists.feed;
  if (!list) throw new Error('the feed list did not render');
  return list;
}

function galleryList(): Captured {
  const list = capturedLists.gallery;
  if (!list) throw new Error('the gallery list did not render');
  return list;
}

/**
 * One scroll event, with the geometry the native event carries. `range` is
 * content height minus viewport height, which is what the arm measures
 * itself against.
 */
function scrollList(list: Captured, y: number, options: { range?: number } = {}): void {
  const range = options.range ?? 4000;
  const onScroll = list.onScroll;
  if (typeof onScroll !== 'function') throw new Error('this list has no scroll handler');
  act(() => {
    onScroll({
      nativeEvent: {
        contentOffset: { x: 0, y },
        contentSize: { width: 390, height: VIEWPORT + range },
        layoutMeasurement: { width: 390, height: VIEWPORT },
      },
    });
  });
}

function scroll(y: number, options: { range?: number } = {}): void {
  scrollList(feedList(), y, options);
}

async function renderMemories() {
  const { default: MemoriesScreen } = await import('@/app/(app)/(tabs)/(memories)/index');
  return render(<MemoriesScreen />);
}

/** Older history pages one bounded chunk at a time; hold it open on demand. */
let releasePage: (() => void) | null = null;

beforeEach(() => {
  for (const key of Object.keys(capturedLists)) delete capturedLists[key];
  loadMoreMoments.mockReset();
  loadMoreMoments.mockImplementation(
    () =>
      new Promise<boolean>((resolve) => {
        releasePage = () => resolve(false);
      })
  );
  releasePage = null;
  hasMoreMoments = true;
  pagingError = null;
});

async function settlePage(): Promise<void> {
  await act(async () => {
    releasePage?.();
    await Promise.resolve();
  });
}

describe('Memories feed paging edge', () => {
  it('wires the feed list to the top edge only', async () => {
    await renderMemories();
    const list = feedList();
    expect(list.onEndReached).toBeUndefined();
    expect(list.onEndReachedThreshold).toBeUndefined();
    // The row the reader is on is held while older rows prepend above.
    expect(list.maintainVisibleContentPosition).toEqual({ minIndexForVisible: 0 });
    // Nothing measures the list to decide whether to show the fetch control:
    // the control's own height is part of the content it would be measuring,
    // so a fit test on content size can flap between shown and hidden.
    expect(list.onContentSizeChange).toBeUndefined();
    expect(list.onLayout).toBeUndefined();
  });

  it('gives the gallery, which shares the same archive, the same wiring', async () => {
    await renderMemories();
    fireEvent.click(screen.getByText('Gallery'));
    const list = galleryList();
    expect(list.data.length).toBeGreaterThan(0);
    expect(list.onEndReached).toBeUndefined();
    expect(list.onEndReachedThreshold).toBeUndefined();
    expect(list.maintainVisibleContentPosition).toEqual({ minIndexForVisible: 0 });
  });

  it('does not page when the reader reaches the bottom', async () => {
    await renderMemories();
    scroll(0);
    scroll(4000);
    scroll(9000);
    expect(loadMoreMoments).not.toHaveBeenCalled();
  });

  it('pages exactly once when the reader leaves the top and comes back', async () => {
    await renderMemories();
    scroll(0);
    expect(loadMoreMoments).not.toHaveBeenCalled();

    scroll(320);
    scroll(0);
    expect(loadMoreMoments).toHaveBeenCalledTimes(1);

    // A page is in flight: further scroll events must not stack requests.
    scroll(0);
    scroll(0);
    scroll(1);
    expect(loadMoreMoments).toHaveBeenCalledTimes(1);

    await settlePage();

    // The arm was spent on that page; resting at the top is not a trigger.
    scroll(0);
    expect(loadMoreMoments).toHaveBeenCalledTimes(1);

    // Leaving the top again re-arms exactly one more page.
    scroll(320);
    scroll(0);
    expect(loadMoreMoments).toHaveBeenCalledTimes(2);
  });

  it('shows the fetch caption at the top of the list, above the rows', async () => {
    await renderMemories();
    scroll(320);
    scroll(0);
    const header = screen.getByTestId('list-header');
    expect(header.textContent).toContain('Loading earlier');
    expect(screen.queryByTestId('list-footer')).toBeNull();

    // The caption gives way to the resting control, never to nothing.
    await settlePage();
    expect(screen.queryByText('Loading earlier…')).toBeNull();
    expect(screen.getByLabelText('Load earlier memories')).toBeTruthy();
  });

  it('arms a short feed at the range it actually has', async () => {
    await renderMemories();
    // Scrollable, but by less than the usual arm distance.
    const range = 36;

    scroll(20, { range });
    expect(loadMoreMoments).not.toHaveBeenCalled();

    // Reaching this feed's own maximum is what arms it.
    scroll(range, { range });
    scroll(0, { range });
    expect(loadMoreMoments).toHaveBeenCalledTimes(1);
    await settlePage();

    // The arm is still spent afterwards: resting at the top is not a
    // trigger, only another leave-and-return is.
    scroll(0, { range });
    expect(loadMoreMoments).toHaveBeenCalledTimes(1);
    scroll(range, { range });
    scroll(0, { range });
    expect(loadMoreMoments).toHaveBeenCalledTimes(2);
  });

  it('never pages on mount, and offers the control instead', async () => {
    await renderMemories();
    scroll(0, { range: 0 });
    expect(loadMoreMoments).not.toHaveBeenCalled();

    fireEvent.click(screen.getByLabelText('Load earlier memories'));
    expect(loadMoreMoments).toHaveBeenCalledTimes(1);

    // While the page is in flight the control gives way to the caption, so
    // it cannot be pressed twice.
    expect(screen.queryByLabelText('Load earlier memories')).toBeNull();
    expect(screen.getByTestId('list-header').textContent).toContain('Loading earlier');

    await settlePage();

    // The archive still has more, so the control is back and asking again is
    // one more page — never a cascade on its own.
    fireEvent.click(screen.getByLabelText('Load earlier memories'));
    expect(loadMoreMoments).toHaveBeenCalledTimes(2);
    await settlePage();
    expect(loadMoreMoments).toHaveBeenCalledTimes(2);
  });

  it('keeps the top edge paging while the control is offered', async () => {
    await renderMemories();
    expect(screen.getByLabelText('Load earlier memories')).toBeTruthy();
    // The control is an addition to the top edge, not a replacement for it:
    // a scrollable feed still pages by leaving and returning to the top.
    scroll(320);
    scroll(0);
    expect(loadMoreMoments).toHaveBeenCalledTimes(1);
    await settlePage();
    expect(loadMoreMoments).toHaveBeenCalledTimes(1);
  });

  it('disarms the top edge when the presentation changes', async () => {
    await renderMemories();
    // Arm the top edge on the Feed, then switch: the Gallery mounts at y = 0,
    // where a stale arm would spend itself on a page nobody asked for.
    scroll(320);
    fireEvent.click(screen.getByText('Gallery'));
    scrollList(galleryList(), 0);
    expect(loadMoreMoments).not.toHaveBeenCalled();
    await act(async () => {});
    expect(loadMoreMoments).not.toHaveBeenCalled();
  });

  it('disarms the top edge when the query narrows the archive', async () => {
    await renderMemories();
    scroll(320);
    fireEvent.click(screen.getByLabelText('Search memories'));
    const field = screen.getByPlaceholderText('Search memories');
    fireEvent.change(field, { target: { value: 'lake' } });
    // A filter can clamp the list back to the top; the stale arm may not fire.
    scroll(0);
    expect(loadMoreMoments).not.toHaveBeenCalled();
  });

  it('offers a retry when a page fails, and re-asks for the same page', async () => {
    // A page that failed keeps its cursor and says so, instead of looking
    // like a page that simply has not arrived.
    pagingError = 'offline';
    await renderMemories();
    const retry = screen.getByLabelText("Couldn't load earlier memories. Try again");
    expect(screen.queryByLabelText('Load earlier memories')).toBeNull();

    fireEvent.click(retry);
    expect(loadMoreMoments).toHaveBeenCalledTimes(1);
  });

  it('never pages once the archive is exhausted', async () => {
    hasMoreMoments = false;
    await renderMemories();
    scroll(320);
    scroll(0);
    expect(loadMoreMoments).not.toHaveBeenCalled();
    expect(screen.queryByLabelText('Load earlier memories')).toBeNull();
  });
});

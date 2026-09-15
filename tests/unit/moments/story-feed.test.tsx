import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, act } from '@testing-library/react';
import { createElement } from 'react';

import {
  sortFeedNewestFirst,
  groupFeedByMonth,
  formatFeedMonthHeading,
  feedMonthKey,
  visiblePendingRecords,
  countFeedTypes,
  feedTypeOf,
  filterFeedMoments,
  matchesFeedQuery,
  monthJumpTargets,
} from '@/features/moments/story-feed';

// ── Shared fixtures ────────────────────────────────────────────────────

function makeMoment(overrides: Record<string, any> = {}) {
  return {
    id: 'm-1',
    type: 'note' as const,
    title: 'Title',
    body: 'Body',
    occurredAt: '2026-03-15T10:00:00.000Z',
    targetAt: null,
    createdAt: '2026-03-15T10:00:00.000Z',
    updatedAt: '2026-03-15T10:00:00.000Z',
    authorId: 'user_you',
    authorRole: 'you' as const,
    authorName: 'You',
    isOwn: true,
    isRead: true,
    mediaPreview: undefined,
    audioUri: null,
    mediaId: null,
    ...overrides,
  };
}

function makePending(overrides: Record<string, any> = {}) {
  return {
    clientId: 'pending-1',
    body: 'Unsent words',
    occurredAt: '2026-03-16T10:00:00.000Z',
    slots: [],
    status: 'queued' as const,
    errorCode: null,
    errorMessage: null,
    attempts: 0,
    createdAt: '2026-03-16T10:00:00.000Z',
    updatedAt: '2026-03-16T10:00:00.000Z',
    scope: { viewerId: 'user_you', spaceId: 'space-1' },
    deliveredMoment: null,
    ...overrides,
  };
}

describe('story-feed pure helpers', () => {
  it('sorts newest-first with a deterministic id tie-break', () => {
    const b = makeMoment({ id: 'b', occurredAt: '2026-03-15T10:00:00.000Z' });
    const a = makeMoment({ id: 'a', occurredAt: '2026-03-15T10:00:00.000Z' });
    const older = makeMoment({ id: 'older', occurredAt: '2026-03-14T10:00:00.000Z' });
    const newer = makeMoment({ id: 'newer', occurredAt: '2026-03-16T10:00:00.000Z' });
    expect(sortFeedNewestFirst([older, b, newer, a]).map((m) => m.id)).toEqual([
      'newer',
      'a',
      'b',
      'older',
    ]);
  });

  it('excludes Plans-owned goals from the feed', () => {
    const goal = makeMoment({ id: 'goal-1', type: 'goal' });
    const note = makeMoment({ id: 'note-1', type: 'note' });
    expect(sortFeedNewestFirst([goal, note]).map((m) => m.id)).toEqual(['note-1']);
  });

  it('parks unparseable dates at the end instead of dropping them', () => {
    const bad = makeMoment({ id: 'bad', occurredAt: 'not-a-date' });
    const good = makeMoment({ id: 'good', occurredAt: '2026-03-15T10:00:00.000Z' });
    expect(sortFeedNewestFirst([bad, good]).map((m) => m.id)).toEqual(['good', 'bad']);
    expect(feedMonthKey('not-a-date')).toBeNull();
    expect(formatFeedMonthHeading('not-a-date')).toBe('');
  });

  it('groups months newest-first with counts and chapter ids', () => {
    const feed = sortFeedNewestFirst([
      makeMoment({ id: 'feb-1', occurredAt: '2026-02-10T10:00:00.000Z' }),
      makeMoment({ id: 'mar-1', occurredAt: '2026-03-10T10:00:00.000Z' }),
      makeMoment({ id: 'mar-2', occurredAt: '2026-03-20T10:00:00.000Z' }),
      makeMoment({ id: 'bad', occurredAt: 'nope' }),
    ]);
    const sections = groupFeedByMonth(feed);
    expect(sections.map((s) => s.id)).toEqual(['month:2026-03', 'month:2026-02', 'month:undated']);
    expect(sections[0].label).toBe('March 2026');
    expect(sections[0].countLabel).toBe('2 memories');
    expect(sections[0].moments.map((m) => m.id)).toEqual(['mar-2', 'mar-1']);
    expect(sections[1].countLabel).toBe('1 memory');
    expect(sections[2].label).toBe('Undated');
  });

  it('keeps unsent pending visible but hides delivered-once-in-feed', () => {
    const delivered = makePending({
      clientId: 'd-1',
      status: 'delivered',
      deliveredMoment: makeMoment({ id: 'real-1' }),
    });
    const queued = makePending({ clientId: 'q-1', status: 'queued' });
    const failed = makePending({ clientId: 'f-1', status: 'failed', errorMessage: 'Nope' });
    expect(visiblePendingRecords([delivered, queued, failed], new Set(['real-1'])).map((r) => r.clientId)).toEqual([
      'q-1',
      'f-1',
    ]);
    expect(visiblePendingRecords([delivered], new Set()).map((r) => r.clientId)).toEqual(['d-1']);
  });
});

// ── Screen mocks ───────────────────────────────────────────────────────

let feedMoments: any[] = [];
let feedPending: any[] = [];
let feedLoading = false;
let feedError: string | null = null;
let feedHasMore = false;
const loadMoreMoments = vi.fn(async () => false);
const refreshMoments = vi.fn(async () => {});
const removeMoment = vi.fn(async () => {});
const acknowledgeDelivered = vi.fn(async () => {});
const pushSpy = vi.fn();
const setParamsSpy = vi.fn();
let searchParams: Record<string, unknown> = {};
let capturedList: any = null;
const scrollToIndexSpy = vi.fn();
const scrollToOffsetSpy = vi.fn();
const flatListMountSpy = vi.fn();
const flatListUnmountSpy = vi.fn();

vi.mock('@/features/moments/moments-context', () => ({
  useMoments: () => ({
    moments: feedMoments,
    activity: [],
    isLoading: feedLoading,
    error: feedError,
    hasMoreMoments: feedHasMore,
    loadMoreMoments,
    loadBucketSummary: vi.fn(async () => ({ buckets: [], hasOlder: false })),
    loadChapterRange: vi.fn(async () => []),
    loadGoals: vi.fn(async () => []),
    addMoment: vi.fn(),
    updateMoment: vi.fn(),
    removeMoment,
    refresh: refreshMoments,
  }),
}));

vi.mock('@/features/composer/composer-context', () => ({
  useComposer: () => ({
    pending: feedPending,
    sendingIds: [],
    acknowledgeDelivered,
  }),
}));

vi.mock('@/features/space/space-context', () => ({
  useSpace: () => ({ space: { id: 'space-1', relationshipStartDate: null } }),
}));

vi.mock('@/features/session/session-context', () => ({
  useSession: () => ({
    user: { id: 'user_you', displayName: 'You', email: 'you@example.com' },
    signOut: vi.fn(),
  }),
}));

vi.mock('@/features/moments/use-resurface-notification', () => ({
  useResurfaceNotification: () => {},
}));

vi.mock('react-native', () => {
  const React = require('react');
  const View = ({ children, accessibilityLabel, accessibilityRole }: any) =>
    React.createElement(
      'div',
      {
        ...(typeof accessibilityLabel === 'string' ? { 'aria-label': accessibilityLabel } : {}),
        ...(typeof accessibilityRole === 'string' ? { role: accessibilityRole } : {}),
      },
      children
    );
  const Pressable = ({ children, onPress, accessibilityLabel }: any) =>
    React.createElement('div', { 'aria-label': accessibilityLabel, onClick: onPress }, children);
  const TextInput = ({ onChangeText, accessibilityLabel, value, placeholder }: any) =>
    React.createElement('input', {
      'aria-label': accessibilityLabel,
      placeholder,
      value: value ?? '',
      onChange: (event: any) => onChangeText?.(event.target.value),
    });
  const ScrollView = View;
  const FlatList = React.forwardRef(function MockFlatList(props: any, ref: any) {
    capturedList = props;
    React.useEffect(() => {
      flatListMountSpy();
      return () => {
        flatListUnmountSpy();
      };
    }, []);
    React.useImperativeHandle(ref, () => ({
      scrollToIndex: scrollToIndexSpy,
      scrollToOffset: scrollToOffsetSpy,
    }));
    const { data, renderItem, keyExtractor, ListEmptyComponent, ListHeaderComponent, ListFooterComponent } = props;
    const section = (node: unknown) =>
      React.isValidElement(node)
        ? node
        : typeof node === 'function'
          ? React.createElement(node as never)
          : node;
    return React.createElement(
      'div',
      { 'data-testid': 'story-feed' },
      section(ListHeaderComponent),
      data && data.length > 0
        ? data.map((item: any, index: number) =>
            React.createElement(
              'div',
              { key: keyExtractor ? keyExtractor(item, index) : index },
              renderItem({ item, index, separators: {} }),
            ),
          )
        : section(ListEmptyComponent),
      section(ListFooterComponent),
    );
  });
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
    View,
    Text: View,
    Pressable,
    TextInput,
    ScrollView,
    FlatList,
    // PhotoViewer is a Modal; render its children when visible so the
    // gallery's full-screen step is reachable in jsdom.
    Modal: ({ children, visible }: any) =>
      visible === false ? null : React.createElement('div', {}, children),
    StyleSheet: { create: (styles: any) => styles, hairlineWidth: 1, absoluteFill: {}, absoluteFillObject: {} },
    Platform: { OS: 'ios', select: (options: { ios?: unknown }) => options.ios },
    Dimensions: { get: () => ({ width: 390, height: 844 }) },
    useWindowDimensions: () => ({ width: 390, height: 844, scale: 3, fontScale: 1 }),
    useColorScheme: () => 'light',
    AppState: { currentState: 'active', addEventListener: () => ({ remove: () => {} }) },
  };
});

vi.mock('expo-router', () => ({
  useRouter: () => ({ push: pushSpy, back: vi.fn(), setParams: setParamsSpy }),
  useLocalSearchParams: () => searchParams,
  useIsFocused: () => true,
}));

vi.mock('react-native-safe-area-context', () => ({
  useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }),
}));

vi.mock('@/components/home/memory-sky', () => ({
  SYSTEM_TAB_BAR_IOS_CLEARANCE: 50,
  SYSTEM_TAB_BAR_BOTTOM_GAP: 8,
  SYSTEM_TAB_BAR_CONTENT_HEIGHT: 50,
  systemTabBarTopOffset: (bottomInset: number) => Math.max(bottomInset, 8) + 8 + 50,
  FAB_ABOVE_BAR_GAP: 16,
  fabBottomOffset: (bottomInset: number, isIos: boolean) =>
    (isIos && bottomInset >= 50 ? bottomInset : Math.max(bottomInset, 8) + 50) + 16,
  compactSkyHeightForWindow: () => 200,
  MemorySky: () => null,
}));

vi.mock('@/features/space/space-context', () => ({
  useSpace: () => ({ space: { relationshipStartDate: null } }),
}));

vi.mock('@/components/moments/moment-card', () => ({
  MomentCard: ({ moment, onLongPress, onActions, nativeActionsMenu, onPhotoPress }: any) =>
    createElement(
      'div',
      {
        'data-testid': `moment-${moment.id}`,
        'data-actions': onLongPress ? 'yes' : 'no',
        'data-native-actions': nativeActionsMenu ? 'yes' : 'no',
      },
      // Mirrors the real card's contract: the ellipsis trigger rides the
      // native popover (label + action buttons) on iOS, and the sheet
      // fallback Pressable everywhere else.
      nativeActionsMenu
        ? createElement(
            'div',
            { 'data-testid': 'native-actions-menu' },
            createElement('div', { 'aria-label': 'More actions', role: 'button' }, '…'),
            ...(nativeActionsMenu.actions ?? []).map((a: any) =>
              createElement(
                'button',
                {
                  key: a.id,
                  'data-menu-action': a.id,
                  onClick: () => nativeActionsMenu.onAction?.(a.id),
                },
                a.title,
              ),
            ),
          )
        : onActions
          ? createElement(
              'div',
              {
                'aria-label': 'More actions',
                role: 'button',
                onClick: () => onActions(moment.id),
              },
              '…',
            )
          : null,
      onPhotoPress
        ? createElement(
            'div',
            {
              'aria-label': 'Open feed photo',
              role: 'button',
              onClick: () => onPhotoPress(moment.id, 0),
            },
            'photo',
          )
        : null,
    ),
}));

vi.mock('@/components/moments/resurface-card', () => ({
  ResurfaceCard: ({ resurfaces }: any) =>
    createElement('div', { 'data-testid': 'resurface', 'data-count': resurfaces.length }),
}));

vi.mock('@/components/moments/pending-memory-row', () => ({
  PendingMemoryRow: ({ record }: any) =>
    createElement('div', { 'data-testid': `pending-${record.clientId}` }),
}));

vi.mock('@/components/themed-text', () => ({
  ThemedText: ({ children }: any) => createElement('span', {}, children),
}));

vi.mock('@/components/ui/action-sheet', () => ({
  ActionSheet: ({ visible, title, actions }: any) =>
    visible
      ? createElement(
          'div',
          { 'data-testid': `sheet:${title ?? ''}` },
          (actions ?? []).map((a: any) =>
            createElement('button', { key: a.label, onClick: a.onPress }, a.label),
          ),
        )
      : null,
}));

// Native context-menu stand-in: under vitest the real MenuView resolves to
// the default passthrough View (no .ios platform resolution), so the menu
// contract needs a mock that surfaces the actions and fires onPressAction
// with the same nativeEvent shape the native view emits.
vi.mock('@expo/ui/community/menu', () => ({
  MenuView: ({ actions, onPressAction, children, testID }: any) =>
    createElement(
      'div',
      { 'data-testid': testID ?? 'native-moment-menu' },
      children,
      ...(actions ?? []).map((a: any) =>
        createElement(
          'button',
          {
            key: a.id,
            'data-menu-action': a.id,
            onClick: () => onPressAction?.({ nativeEvent: { event: a.id } }),
          },
          a.title,
        ),
      ),
    ),
}));

vi.mock('@/components/ui/button', () => ({
  Button: ({ label, onPress, accessibilityLabel }: any) =>
    createElement('button', { onClick: onPress, 'aria-label': accessibilityLabel ?? label }, label),
}));

vi.mock('@/components/ui/frosted-backdrop', () => ({
  FrostedBackdrop: () => null,
}));

vi.mock('@/hooks/use-theme-color', () => ({
  useThemeColor: () => '#000000',
}));

vi.mock('@/features/theme/theme-context', () => ({
  useAoiTheme: () => ({ mode: 'light' as const, colors: {} }),
}));

vi.mock('@expo/vector-icons', () => ({
  Ionicons: () => null,
}));

describe('Memories story feed (oldest-first archive)', () => {
  beforeEach(() => {
    feedMoments = [];
    feedPending = [];
    feedLoading = false;
    feedError = null;
    feedHasMore = false;
    searchParams = {};
    capturedList = null;
    pushSpy.mockClear();
    setParamsSpy.mockClear();
    loadMoreMoments.mockClear();
    refreshMoments.mockClear();
    removeMoment.mockClear();
    acknowledgeDelivered.mockClear();
  });

  it('renders memories oldest-first under oldest-first month sections', async () => {
    feedMoments = [
      makeMoment({ id: 'older', occurredAt: '2026-02-14T10:00:00.000Z' }),
      makeMoment({ id: 'newer', occurredAt: '2026-03-16T10:00:00.000Z' }),
      makeMoment({ id: 'middle', occurredAt: '2026-03-15T10:00:00.000Z' }),
    ];
    const { default: MemoriesScreen } = await import('@/app/(app)/(tabs)/(memories)/index');
    render(createElement(MemoriesScreen));
    const cards = screen.getAllByTestId(/moment-/).map((n) => n.getAttribute('data-testid'));
    expect(cards).toEqual(['moment-older', 'moment-middle', 'moment-newer']);
    expect(screen.getByText('March 2026')).toBeTruthy();
    expect(screen.getByText('February 2026')).toBeTruthy();
    // Oldest month leads; the newest memory sits at the bottom.
    const html = screen.getByTestId('story-feed').innerHTML;
    expect(html.indexOf('February 2026')).toBeLessThan(html.indexOf('March 2026'));
  });

  it('opens the month chapter from its section header', async () => {
    feedMoments = [makeMoment({ id: 'm-1', occurredAt: '2026-03-15T10:00:00.000Z' })];
    const { default: MemoriesScreen } = await import('@/app/(app)/(tabs)/(memories)/index');
    render(createElement(MemoriesScreen));
    fireEvent.click(screen.getByLabelText('Open March 2026 chapter'));
    expect(pushSpy).toHaveBeenCalledWith('/(app)/chapter/month:2026-03');
  });

  it('keeps goals out of the feed', async () => {
    feedMoments = [
      makeMoment({ id: 'goal-1', type: 'goal', occurredAt: '2026-03-16T10:00:00.000Z' }),
      makeMoment({ id: 'note-1', type: 'note', occurredAt: '2026-03-15T10:00:00.000Z' }),
    ];
    const { default: MemoriesScreen } = await import('@/app/(app)/(tabs)/(memories)/index');
    render(createElement(MemoriesScreen));
    expect(screen.queryByTestId('moment-goal-1')).toBeNull();
    expect(screen.getByTestId('moment-note-1')).toBeTruthy();
  });

  it('pins unsent memories above the stream', async () => {
    feedMoments = [makeMoment({ id: 'm-1', occurredAt: '2026-03-15T10:00:00.000Z' })];
    feedPending = [makePending({ clientId: 'p-1' })];
    const { default: MemoriesScreen } = await import('@/app/(app)/(tabs)/(memories)/index');
    render(createElement(MemoriesScreen));
    const html = screen.getByTestId('story-feed').innerHTML;
    expect(html.indexOf('pending-p-1')).toBeLessThan(html.indexOf('moment-m-1'));
  });

  it('acknowledges a delivered save once its row lands in the feed', async () => {
    const real = makeMoment({ id: 'real-1', occurredAt: '2026-03-16T10:00:00.000Z' });
    feedMoments = [real];
    feedPending = [makePending({ clientId: 'd-1', status: 'delivered', deliveredMoment: real })];
    const { default: MemoriesScreen } = await import('@/app/(app)/(tabs)/(memories)/index');
    render(createElement(MemoriesScreen));
    // The delivered ack is deferred off the render commit; flush timers.
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 5));
    });
    expect(acknowledgeDelivered).toHaveBeenCalledWith('d-1');
    expect(screen.queryByTestId('pending-d-1')).toBeNull();
    expect(screen.getByTestId('moment-real-1')).toBeTruthy();
  });

  it('never leads the archive with an on-this-day dashboard block', async () => {
    const now = new Date();
    const past = new Date(now);
    past.setFullYear(now.getFullYear() - 2);
    feedMoments = [
      makeMoment({ id: 'oldie', type: 'note', isOwn: false, occurredAt: past.toISOString() }),
      makeMoment({ id: 'fresh', occurredAt: now.toISOString() }),
    ];
    const { default: MemoriesScreen } = await import('@/app/(app)/(tabs)/(memories)/index');
    render(createElement(MemoriesScreen));
    // A same-day anniversary is not a pinned post: no card precedes content.
    expect(screen.queryByTestId('resurface')).toBeNull();
    const html = screen.getByTestId('story-feed').innerHTML;
    expect(html.indexOf('moment-oldie')).toBeLessThan(html.indexOf('moment-fresh'));
  });

  it('pages earlier memories on scroll-end (infinite scroll owns paging)', async () => {
    feedMoments = [makeMoment({ id: 'm-1' })];
    feedHasMore = true;
    const { default: MemoriesScreen } = await import('@/app/(app)/(tabs)/(memories)/index');
    render(createElement(MemoriesScreen));
    await act(async () => {
      capturedList.onEndReached();
    });
    expect(loadMoreMoments).toHaveBeenCalledTimes(1);
    await act(async () => {
      capturedList.onEndReached();
    });
    expect(loadMoreMoments).toHaveBeenCalledTimes(2);
    // One paging mechanism: no second manual trigger beside onEndReached.
    expect(screen.queryByText('Load earlier memories')).toBeNull();
  });

  it('refreshes the feed on pull-to-refresh', async () => {
    feedMoments = [makeMoment({ id: 'm-1' })];
    const { default: MemoriesScreen } = await import('@/app/(app)/(tabs)/(memories)/index');
    render(createElement(MemoriesScreen));
    await act(async () => {
      capturedList.onRefresh();
    });
    expect(refreshMoments).toHaveBeenCalledTimes(1);
  });

  it('shows the first-memory empty state and the offline retry', async () => {
    const { default: MemoriesScreen } = await import('@/app/(app)/(tabs)/(memories)/index');
    const first = render(createElement(MemoriesScreen));
    expect(screen.getByText('Your first memory')).toBeTruthy();
    fireEvent.click(screen.getByText('Keep your first memory'));
    expect(pushSpy).toHaveBeenCalledWith('/(app)/moment/new');
    first.unmount();

    feedError = 'Nope';
    render(createElement(MemoriesScreen));
    fireEvent.click(screen.getByText('Try again'));
    expect(refreshMoments).toHaveBeenCalled();
  });

  it('forwards Us-tab capture intents to the editor exactly once', async () => {
    feedMoments = [makeMoment({ id: 'm-1' })];
    searchParams = { compose: 'photos' };
    const { default: MemoriesScreen } = await import('@/app/(app)/(tabs)/(memories)/index');
    render(createElement(MemoriesScreen));
    await act(async () => {});
    expect(setParamsSpy).toHaveBeenCalledWith({ compose: undefined });
    expect(pushSpy).toHaveBeenCalledWith({
      pathname: '/(app)/moment/new',
      params: { compose: 'photos' },
    });
  });

  it('gates edit actions to own memories only', async () => {
    feedMoments = [
      makeMoment({ id: 'mine', isOwn: true, occurredAt: '2026-03-16T10:00:00.000Z' }),
      makeMoment({ id: 'theirs', isOwn: false, occurredAt: '2026-03-15T10:00:00.000Z' }),
    ];
    const { default: MemoriesScreen } = await import('@/app/(app)/(tabs)/(memories)/index');
    render(createElement(MemoriesScreen));
    expect(screen.getByTestId('moment-mine').getAttribute('data-actions')).toBe('yes');
    expect(screen.getByTestId('moment-theirs').getAttribute('data-actions')).toBe('no');
  });
});

describe('own-moment native context menu (iOS @expo/ui MenuView)', () => {
  // The native menu only mounts on iOS; other platforms keep the
  // long-press ActionSheet path asserted above.
  afterEach(() => {
    (process.env as any).EXPO_OS = undefined;
  });

  it('wraps own moments in the native menu only, owning the long-press', async () => {
    (process.env as any).EXPO_OS = 'ios';
    feedMoments = [
      makeMoment({ id: 'mine', isOwn: true, occurredAt: '2026-03-16T10:00:00.000Z' }),
      makeMoment({ id: 'theirs', isOwn: false, occurredAt: '2026-03-15T10:00:00.000Z' }),
    ];
    const { default: MemoriesScreen } = await import('@/app/(app)/(tabs)/(memories)/index');
    render(createElement(MemoriesScreen));
    const menu = screen.getByTestId('native-moment-menu');
    // Own moment inside the menu, with Edit + destructive Delete actions.
    expect(menu.querySelector('[data-testid="moment-mine"]')).toBeTruthy();
    expect(menu.querySelector('[data-menu-action="edit"]')).toBeTruthy();
    expect(menu.querySelector('[data-menu-action="delete"]')).toBeTruthy();
    // Partner moments stay unwrapped and untouched by the menu.
    expect(screen.getByTestId('moment-theirs').closest('[data-testid="native-moment-menu"]')).toBeNull();
    // The native menu owns long-press on iOS, so no sheet handler attaches.
    expect(screen.getByTestId('moment-mine').getAttribute('data-actions')).toBe('no');
  });

  it('routes Edit from the native menu to the memory editor', async () => {
    (process.env as any).EXPO_OS = 'ios';
    feedMoments = [
      makeMoment({ id: 'mine', isOwn: true, occurredAt: '2026-03-16T10:00:00.000Z' }),
    ];
    const { default: MemoriesScreen } = await import('@/app/(app)/(tabs)/(memories)/index');
    render(createElement(MemoriesScreen));
    fireEvent.click(
      screen.getByTestId('native-moment-menu').querySelector('[data-menu-action="edit"]') as HTMLElement,
    );
    expect(pushSpy).toHaveBeenCalledWith({
      pathname: '/(app)/moment/edit/[id]',
      params: { id: 'mine', at: '2026-03-16T10:00:00.000Z' },
    });
  });

  it('confirms Delete from the native menu before removing anything', async () => {
    (process.env as any).EXPO_OS = 'ios';
    feedMoments = [
      makeMoment({ id: 'mine', isOwn: true, occurredAt: '2026-03-16T10:00:00.000Z' }),
    ];
    const { default: MemoriesScreen } = await import('@/app/(app)/(tabs)/(memories)/index');
    render(createElement(MemoriesScreen));
    fireEvent.click(
      screen.getByTestId('native-moment-menu').querySelector('[data-menu-action="delete"]') as HTMLElement,
    );
    // Destructive actions confirm first — nothing is removed yet.
    const confirm = screen.getByTestId('sheet:Remove this moment?');
    expect(removeMoment).not.toHaveBeenCalled();
    fireEvent.click(confirm.querySelector('button') as HTMLElement);
    await act(async () => {});
    expect(removeMoment).toHaveBeenCalledWith('mine');
  });

  it('opens the ellipsis as a native popover menu on iOS, never the sheet', async () => {
    (process.env as any).EXPO_OS = 'ios';
    feedMoments = [
      makeMoment({ id: 'mine', isOwn: true, title: 'Lake day', occurredAt: '2026-03-16T10:00:00.000Z' }),
    ];
    const { default: MemoriesScreen } = await import('@/app/(app)/(tabs)/(memories)/index');
    render(createElement(MemoriesScreen));
    const menu = screen.getByTestId('native-actions-menu');
    // The More actions trigger rides the native menu, with Edit + Delete.
    expect(menu.querySelector('[aria-label="More actions"]')).toBeTruthy();
    expect(menu.querySelector('[data-menu-action="edit"]')).toBeTruthy();
    expect(menu.querySelector('[data-menu-action="delete"]')).toBeTruthy();
    // Tapping the trigger opens the popover, not the sheet fallback.
    fireEvent.click(screen.getByLabelText('More actions'));
    expect(screen.queryByTestId('sheet:Lake day')).toBeNull();
    // Edit routes straight to the editor.
    fireEvent.click(menu.querySelector('[data-menu-action="edit"]') as HTMLElement);
    expect(pushSpy).toHaveBeenCalledWith({
      pathname: '/(app)/moment/edit/[id]',
      params: { id: 'mine', at: '2026-03-16T10:00:00.000Z' },
    });
  });

  it('keeps the ellipsis on the ActionSheet fallback off iOS', async () => {
    (process.env as any).EXPO_OS = undefined;
    feedMoments = [
      makeMoment({ id: 'mine', isOwn: true, title: 'Lake day', occurredAt: '2026-03-16T10:00:00.000Z' }),
    ];
    const { default: MemoriesScreen } = await import('@/app/(app)/(tabs)/(memories)/index');
    render(createElement(MemoriesScreen));
    expect(screen.queryByTestId('native-actions-menu')).toBeNull();
    fireEvent.click(screen.getByLabelText('More actions'));
    const sheet = screen.getByTestId('sheet:Lake day');
    // Edit is the first sheet action.
    fireEvent.click(sheet.querySelector('button') as HTMLElement);
    expect(pushSpy).toHaveBeenCalledWith({
      pathname: '/(app)/moment/edit/[id]',
      params: { id: 'mine', at: '2026-03-16T10:00:00.000Z' },
    });
  });

  it('opens feed photos fullscreen with the whole set, back to its memory', async () => {
    feedMoments = [
      makeMoment({
        id: 'trip',
        type: 'media',
        mediaPreview: 'file:///cover.jpg',
        title: 'Trip',
        occurredAt: '2026-03-16T10:00:00.000Z',
        attachments: [
          { mediaId: 'p1', kind: 'image', url: 'file:///one.jpg' },
          { mediaId: 'p2', kind: 'image', url: 'file:///two.jpg' },
          { mediaId: 'p3', kind: 'image', url: 'file:///three.jpg' },
        ],
      }),
    ];
    const { default: MemoriesScreen } = await import('@/app/(app)/(tabs)/(memories)/index');
    render(createElement(MemoriesScreen));
    fireEvent.click(screen.getByLabelText('Open feed photo'));
    await act(async () => {});
    // Full screen with the set counter; swiping stays in the viewer.
    expect(screen.getByLabelText('Close photo')).toBeTruthy();
    expect(screen.getByText('Photo 1 of 3')).toBeTruthy();
    // ...and its parent link returns to the memory it came from.
    fireEvent.click(screen.getByLabelText('Open memory'));
    expect(pushSpy).toHaveBeenCalledWith({
      pathname: '/(app)/moment/[id]',
      params: { id: 'trip', at: '2026-03-16T10:00:00.000Z' },
    });
  });
});

describe('archive search, filters, and month index (pure)', () => {
  const photo = makeMoment({
    id: 'p1',
    type: 'media',
    mediaPreview: 'file:///p.jpg',
    title: 'Evening at the lake',
  });
  const note = makeMoment({ id: 'n1', type: 'note', body: 'You left the porch light on' });
  const voice = makeMoment({ id: 'v1', type: 'trace', audioUri: 'file:///v.m4a', body: 'Humming a song' });
  const partner = makeMoment({
    id: 'x1',
    type: 'note',
    body: 'Rain on the windows',
    authorRole: 'partner',
    authorName: 'June',
  });

  it('buckets each memory into an archive type', () => {
    expect(feedTypeOf(photo)).toBe('photos');
    expect(feedTypeOf(voice)).toBe('voice');
    expect(feedTypeOf(note)).toBe('notes');
  });

  it('matches a query on title, body, author, and tags', () => {
    expect(matchesFeedQuery(photo, 'lake')).toBe(true);
    expect(matchesFeedQuery(note, 'PORCH')).toBe(true);
    expect(matchesFeedQuery(partner, 'june')).toBe(true);
    expect(matchesFeedQuery(makeMoment({ tags: ['inside-joke'] }), 'inside')).toBe(true);
    expect(matchesFeedQuery(photo, 'zzz')).toBe(false);
    expect(matchesFeedQuery(photo, '   ')).toBe(true);
  });

  it('applies type and query together, preserving order', () => {
    const all = [photo, note, voice, partner];
    expect(filterFeedMoments(all, { query: '', type: 'photos' }).map((m) => m.id)).toEqual(['p1']);
    expect(filterFeedMoments(all, { query: 'windows', type: 'all' }).map((m) => m.id)).toEqual(['x1']);
    expect(filterFeedMoments(all, { query: 'porch', type: 'voice' })).toHaveLength(0);
  });

  it('counts each type for the chips', () => {
    expect(countFeedTypes([photo, note, voice, partner])).toEqual({
      all: 4,
      photos: 1,
      notes: 2,
      voice: 1,
      letters: 0,
    });
  });

  it('indexes each month row for the jump targets', () => {
    const rows = [
      { kind: 'moment', key: 'a' },
      { kind: 'month', key: 'month:2026-03', section: { monthKey: '2026-03', label: 'March 2026' } },
      { kind: 'moment', key: 'b' },
      { kind: 'month', key: 'month:2026-02', section: { monthKey: '2026-02', label: 'February 2026' } },
    ];
    expect(monthJumpTargets(rows)).toEqual([
      { monthKey: '2026-03', label: 'March 2026', shortLabel: 'Mar 2026', index: 1 },
      { monthKey: '2026-02', label: 'February 2026', shortLabel: 'Feb 2026', index: 3 },
    ]);
  });
});

describe('archive controls on the Memories screen', () => {
  beforeEach(() => {
    scrollToIndexSpy.mockClear();
  });

  async function renderScreen() {
    const { default: MemoriesScreen } = await import('@/app/(app)/(tabs)/(memories)/index');
    render(createElement(MemoriesScreen));
  }

  it('narrows the archive by search text', async () => {
    feedMoments = [
      makeMoment({ id: 'lake', type: 'media', mediaPreview: 'file:///l.jpg', title: 'Lake day' }),
      makeMoment({ id: 'porch', type: 'note', body: 'porch light' }),
    ];
    await renderScreen();
    expect(screen.getByTestId('moment-lake')).toBeTruthy();
    // The archive opens clean: the field is behind the on-demand Search
    // control, so the button is tapped before the input exists.
    fireEvent.click(screen.getByLabelText('Search memories'));
    fireEvent.change(screen.getByLabelText('Search memories'), { target: { value: 'porch' } });
    await act(async () => {});
    expect(screen.getByTestId('moment-porch')).toBeTruthy();
    expect(screen.queryByTestId('moment-lake')).toBeNull();
  });

  it('narrows the archive by type chip', async () => {
    feedMoments = [
      makeMoment({ id: 'lake', type: 'media', mediaPreview: 'file:///l.jpg', title: 'Lake day' }),
      makeMoment({ id: 'porch', type: 'note', body: 'porch light' }),
    ];
    await renderScreen();
    // Filters ride with search; open it before tapping a type chip.
    fireEvent.click(screen.getByLabelText('Search memories'));
    fireEvent.click(screen.getByLabelText('Photos filter'));
    await act(async () => {});
    expect(screen.getByTestId('moment-lake')).toBeTruthy();
    expect(screen.queryByTestId('moment-porch')).toBeNull();
  });

  it('switches to the Gallery grid and links a full-screen photo back to its memory', async () => {
    feedMoments = [
      makeMoment({ id: 'lake', type: 'media', mediaPreview: 'file:///l.jpg', title: 'Lake day' }),
      makeMoment({ id: 'porch', type: 'note', occurredAt: '2026-03-15T09:00:00.000Z' }),
    ];
    await renderScreen();
    fireEvent.click(screen.getByLabelText('Gallery'));
    await act(async () => {});
    // The grid is month-grouped and tiles only real photos.
    expect(screen.getByText('March 2026')).toBeTruthy();
    expect(screen.queryByTestId('moment-lake')).toBeNull();
    fireEvent.click(screen.getByLabelText('Open photo 1 from March 2026'));
    await act(async () => {});
    // Full screen: the viewer's controls prove the photo opened...
    expect(screen.getByLabelText('Close photo')).toBeTruthy();
    // ...and its parent link returns to the memory it came from.
    fireEvent.click(screen.getByLabelText('Open memory'));
    expect(pushSpy).toHaveBeenCalledWith({
      pathname: '/(app)/moment/[id]',
      params: { id: 'lake', at: '2026-03-15T10:00:00.000Z' },
    });
  });

  it('shows a clear affordance when a search matches nothing', async () => {
    feedMoments = [makeMoment({ id: 'lake', title: 'Lake day' })];
    await renderScreen();
    fireEvent.click(screen.getByLabelText('Search memories'));
    fireEvent.change(screen.getByLabelText('Search memories'), { target: { value: 'nope' } });
    await act(async () => {});
    expect(screen.getByText('Clear filters')).toBeTruthy();
    fireEvent.click(screen.getByText('Clear filters'));
    await act(async () => {});
    expect(screen.getByTestId('moment-lake')).toBeTruthy();
  });
});

describe('archive native scroll view (inset ownership, no offset reset)', () => {
  beforeEach(() => {
    scrollToOffsetSpy.mockClear();
    flatListMountSpy.mockClear();
    flatListUnmountSpy.mockClear();
  });

  async function renderScreen() {
    const { default: MemoriesScreen } = await import('@/app/(app)/(tabs)/(memories)/index');
    render(createElement(MemoriesScreen));
  }

  it('lets the native scroll view own its inset: never commands offset 0', async () => {
    feedMoments = [
      makeMoment({ id: 'lake', type: 'media', mediaPreview: 'file:///l.jpg', title: 'Lake day' }),
    ];
    await renderScreen();
    await act(async () => {});
    expect(scrollToOffsetSpy).not.toHaveBeenCalled();

    fireEvent.click(screen.getByLabelText('Gallery'));
    await act(async () => {});
    expect(scrollToOffsetSpy).not.toHaveBeenCalled();

    fireEvent.click(screen.getByLabelText('Feed'));
    await act(async () => {});
    expect(scrollToOffsetSpy).not.toHaveBeenCalled();
  });

  it('remounts the native scroll view per view so each keeps automatic insets', async () => {
    feedMoments = [
      makeMoment({ id: 'lake', type: 'media', mediaPreview: 'file:///l.jpg', title: 'Lake day' }),
    ];
    await renderScreen();
    expect(flatListMountSpy).toHaveBeenCalledTimes(1);
    expect(flatListUnmountSpy).not.toHaveBeenCalled();

    fireEvent.click(screen.getByLabelText('Gallery'));
    await act(async () => {});
    // A fresh scroll view, not the feed's stale offset.
    expect(flatListMountSpy).toHaveBeenCalledTimes(2);
    expect(flatListUnmountSpy).toHaveBeenCalledTimes(1);

    fireEvent.click(screen.getByLabelText('Feed'));
    await act(async () => {});
    expect(flatListMountSpy).toHaveBeenCalledTimes(3);
    expect(flatListUnmountSpy).toHaveBeenCalledTimes(2);
  });

  it('preserves the mounted list and focused input across query edits', async () => {
    feedMoments = [makeMoment({ id: 'porch', type: 'note', body: 'porch light' })];
    await renderScreen();
    fireEvent.click(screen.getByLabelText('Search memories'));
    await act(async () => {});
    const input = screen.getByLabelText('Search memories');
    input.focus();

    const mountsBefore = flatListMountSpy.mock.calls.length;
    const unmountsBefore = flatListUnmountSpy.mock.calls.length;

    fireEvent.change(input, { target: { value: 'p' } });
    await act(async () => {});
    fireEvent.change(input, { target: { value: 'po' } });
    await act(async () => {});

    // Filtering keeps the same native scroll view (and the input) mounted.
    expect(flatListMountSpy).toHaveBeenCalledTimes(mountsBefore);
    expect(flatListUnmountSpy).toHaveBeenCalledTimes(unmountsBefore);
    expect(screen.getByLabelText('Search memories')).toBe(document.activeElement);
  });

  it('keeps automatic keyboard insets off the archive in both views', async () => {
    feedMoments = [
      makeMoment({ id: 'lake', type: 'media', mediaPreview: 'file:///l.jpg', title: 'Lake day' }),
    ];
    await renderScreen();
    await act(async () => {});
    expect(capturedList.automaticallyAdjustKeyboardInsets).toBeFalsy();
    expect(capturedList.contentInsetAdjustmentBehavior).toBe('never');

    fireEvent.click(screen.getByLabelText('Gallery'));
    await act(async () => {});
    expect(capturedList.automaticallyAdjustKeyboardInsets).toBeFalsy();
    expect(capturedList.contentInsetAdjustmentBehavior).toBe('never');
  });
});

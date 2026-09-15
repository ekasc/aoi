import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, act, fireEvent } from '@testing-library/react';
import { createElement } from 'react';

vi.mock('@/components/moments/chapter-photo-stack', () => ({ ChapterPhotoStack: () => <div data-testid="chapter-photo-stack" /> }));

const pushSpy = vi.fn();
const backSpy = vi.fn();
let searchParams: Record<string, string | string[]> = {};

vi.mock('expo-router', () => ({
  Stack: { Screen: () => null },
  useRouter: () => ({ push: pushSpy, back: backSpy, replace: vi.fn() }),
  useLocalSearchParams: () => searchParams,
}));

vi.mock('react-native-safe-area-context', () => ({
  useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }),
}));

vi.mock('@/hooks/use-theme-color', () => ({
  useThemeColor: () => '#000000',
}));

vi.mock('@/features/moments/moments-context', () => ({
  useMoments: () => ({
    loadChapterRange,
  }),
}));

vi.mock('@/features/space/space-context', () => ({
  useSpace: () => ({ space: { relationshipStartDate: '2024-06-15' } }),
}));

vi.mock('@/components/themed-text', () => ({
  ThemedText: ({ children }: any) => <span>{children}</span>,
}));

vi.mock('@/components/ui/button', () => ({
  Button: ({ label, onPress }: any) => <button onClick={onPress}>{label}</button>,
}));

vi.mock('@/components/moments/moment-card', () => ({
  MomentCard: ({ moment }: any) => <div data-testid={`chapter-member-${moment.id}`} />,
}));

vi.mock('@/components/moments/chapter-cover', () => ({
  ChapterCover: ({ chapter }: any) => <div data-testid={`chapter-cover-${chapter.id}`} />,
}));

vi.mock('@/features/export/keepsake-export', () => ({
  exportChapterKeepsake: (...args: unknown[]) => exportChapterKeepsakeSpy(...args),
}));

vi.mock('@/features/subscription/subscription-context', () => ({
  useSubscription: () => ({
    serverPlus: mockServerPlus,
    refreshServerPlus: refreshServerPlusSpy,
  }),
}));

let mockServerPlus: Record<string, any> | null = {
  isPlus: true,
  status: 'active',
  expiresAt: null,
  mediaUsedBytes: 0,
  mediaLimitBytes: 5 * 1024 * 1024 * 1024,
  activeFutureLetters: 0,
  futureLetterLimit: null,
};
const refreshServerPlusSpy = vi.fn(async () => {});

const exportChapterKeepsakeSpy = vi.fn(async () => ({ status: 'shared' as const }));

// ChapterDetail uses ScrollView + View + StyleSheet only.
vi.mock('react-native', () => ({
  StyleSheet: {
    create: (styles: Record<string, unknown>) => styles,
    hairlineWidth: 1,
    flatten: (style: unknown) => style,
  },
  View: (props: Record<string, unknown>) => {
    const { children } = props as { children?: unknown };
    return createElement('div', {}, children);
  },
  ScrollView: (props: Record<string, unknown>) => {
    const { children } = props as { children?: unknown };
    return createElement('div', { 'data-testid': 'chapter-scroll' }, children);
  },
  Platform: { OS: 'ios', select: (options: { ios?: unknown }) => options.ios },
}));

const loadChapterRange = vi.fn(async (): Promise<Record<string, any>[]> => []);

function makeMoment(overrides: Record<string, any> = {}) {
  return {
    id: 'moment-1',
    type: 'note' as const,
    title: 'Test moment',
    body: 'Test body',
    occurredAt: '2026-03-15T10:00:00.000Z',
    targetAt: null,
    createdAt: '2026-03-15T10:00:00.000Z',
    authorId: 'user_you',
    authorRole: 'you' as const,
    authorName: 'You',
    mediaPreview: null,
    audioUri: null,
    ...overrides,
  };
}

/** A safely-completed local month: two months back always qualifies. */
function oldMonthDay(day: number): { stamp: string; key: string } {
  const now = new Date();
  const date = new Date(now.getFullYear(), now.getMonth() - 2, day, 12, 0, 0);
  const stamp = date.toISOString();
  const key = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;
  return { stamp, key };
}

beforeEach(() => {
  pushSpy.mockClear();
  backSpy.mockClear();
  searchParams = {};
  loadChapterRange.mockReset();
  loadChapterRange.mockResolvedValue([]);
  refreshServerPlusSpy.mockClear();
  exportChapterKeepsakeSpy.mockReset();
  exportChapterKeepsakeSpy.mockResolvedValue({ status: 'shared' } as const);
  mockServerPlus = {
    isPlus: true,
    status: 'active',
    expiresAt: null,
    mediaUsedBytes: 0,
    mediaLimitBytes: 5 * 1024 * 1024 * 1024,
    activeFutureLetters: 0,
    futureLetterLimit: null,
  };
});

describe('ChapterDetailScreen (range-loaded, Story-independent)', () => {
  it('opens an old month directly from a fresh context', async () => {
    // No discovery round trip: the ID describes its own absolute range.
    const { stamp, key } = oldMonthDay(10);
    loadChapterRange.mockImplementation(async (fromMs: number, toMs: number) => {
      expect(toMs - fromMs).toBeLessThanOrEqual(32 * 24 * 60 * 60 * 1000);
      return [
        makeMoment({ id: 'long-note', type: 'note', body: 'A very long note. '.repeat(40), occurredAt: stamp }),
        makeMoment({ id: 'portrait', type: 'media', mediaPreview: 'https://cdn.test/portrait.jpg', occurredAt: stamp }),
        makeMoment({ id: 'landscape', type: 'media', mediaPreview: 'https://cdn.test/landscape.jpg', occurredAt: stamp }),
        makeMoment({ id: 'voice', type: 'trace', audioUri: 'https://cdn.test/v.m4a', occurredAt: stamp }),
      ];
    });
    searchParams = { id: `month:${key}` };

    const { default: ChapterDetailScreen } = await import('@/app/(app)/chapter/[id]');
    const { container } = render(<ChapterDetailScreen />);

    await waitFor(() =>
      expect(screen.getByTestId("chapter-photo-stack")).toBeTruthy()
    );
    const members = container.querySelectorAll('[data-testid^="chapter-member-"]');
    expect(Array.from(members).map((node) => node.getAttribute('data-testid'))).toEqual([
      'chapter-member-long-note',
      'chapter-member-portrait',
      'chapter-member-landscape',
      'chapter-member-voice',
    ]);
    expect(loadChapterRange).toHaveBeenCalledTimes(1);
  });

  it('resolves an anniversary chapter from its ID plus the start date', async () => {
    loadChapterRange.mockResolvedValue([
      makeMoment({ id: 'y2', occurredAt: '2025-06-20T12:00:00.000Z' }),
    ]);
    searchParams = { id: 'anniversary:2:2026' };

    const { default: ChapterDetailScreen } = await import('@/app/(app)/chapter/[id]');
    render(<ChapterDetailScreen />);

    await waitFor(() =>
      expect(screen.getByTestId('chapter-cover-anniversary:2:2026')).toBeTruthy()
    );
    expect(screen.getByTestId('chapter-member-y2')).toBeTruthy();
    expect(loadChapterRange).toHaveBeenCalledTimes(1);
    // The range is the absolute anniversary window, not Story state.
    const [fromMs, toMs] = loadChapterRange.mock.calls[0];
    expect(new Date(fromMs)).toEqual(new Date(2025, 5, 15));
    expect(new Date(toMs)).toEqual(new Date(2026, 5, 15));
  });

  it('explains a missing chapter without crashing', async () => {
    searchParams = { id: 'month:1999-01' };

    const { default: ChapterDetailScreen } = await import('@/app/(app)/chapter/[id]');
    render(<ChapterDetailScreen />);

    // 1999-01 is a valid range that simply holds nothing here.
    await waitFor(() =>
      expect(screen.getByTestId('chapter-cover-month:1999-01')).toBeTruthy()
    );
    expect(loadChapterRange).toHaveBeenCalledTimes(1);
  });

  it('explains an unresolvable ID without any range read', async () => {
    searchParams = { id: 'week:2026-32' };

    const { default: ChapterDetailScreen } = await import('@/app/(app)/chapter/[id]');
    render(<ChapterDetailScreen />);

    await waitFor(() =>
      expect(screen.getByText('This chapter is no longer available')).toBeTruthy()
    );
    expect(loadChapterRange).not.toHaveBeenCalled();
  });

  it('retries after a range failure', async () => {
    const { key } = oldMonthDay(10);
    loadChapterRange.mockRejectedValueOnce(new Error('network down'));
    loadChapterRange.mockResolvedValueOnce([
      makeMoment({ id: 'recovered', occurredAt: `${key}-10T12:00:00.000Z` }),
    ]);
    searchParams = { id: `month:${key}` };

    const { default: ChapterDetailScreen } = await import('@/app/(app)/chapter/[id]');
    render(<ChapterDetailScreen />);

    await waitFor(() => expect(screen.getByText('Try again')).toBeTruthy());
    await act(async () => {
      fireEvent.click(screen.getByText('Try again'));
    });
    await waitFor(() => expect(screen.getByTestId('chapter-member-recovered')).toBeTruthy());
  });
});

describe('ChapterDetailScreen export action', () => {
  async function renderReadyChapter() {
    const { key } = oldMonthDay(10);
    loadChapterRange.mockResolvedValue([
      makeMoment({ id: 'm-note', type: 'note', title: 'Lake note', body: 'Still water.', occurredAt: `${key}-05T12:00:00.000Z` }),
      makeMoment({ id: 'm-photo', type: 'media', mediaPreview: 'https://cdn.test/p.jpg', occurredAt: `${key}-10T12:00:00.000Z` }),
      makeMoment({ id: 'm-voice', type: 'trace', audioUri: 'https://cdn.test/v.m4a', occurredAt: `${key}-15T12:00:00.000Z` }),
    ]);
    searchParams = { id: `month:${key}` };

    const { default: ChapterDetailScreen } = await import('@/app/(app)/chapter/[id]');
    render(<ChapterDetailScreen />);
    await waitFor(() => expect(screen.getByTestId("chapter-photo-stack")).toBeTruthy());
    return key;
  }

  it('exports through the authenticated pipeline with range members', async () => {
    const key = await renderReadyChapter();

    await act(async () => {
      fireEvent.click(screen.getByText('Keep as PDF'));
    });

    // One call carrying the authoritative members — auth, staging, and
    // cleanup all happen inside the orchestration (pinned downstream).
    expect(exportChapterKeepsakeSpy).toHaveBeenCalledTimes(1);
    const [input] = exportChapterKeepsakeSpy.mock.calls[0];
    expect(input.filename).toContain(`month-${key}`);
    expect(input.members.map((member: { id: string }) => member.id)).toEqual([
      'm-note',
      'm-photo',
      'm-voice',
    ]);
    expect(screen.queryByText('No ink.')).toBeNull();
  });

  it('surfaces render failure without claiming success', async () => {
    await renderReadyChapter();
    exportChapterKeepsakeSpy.mockResolvedValueOnce({ status: 'failed', error: 'No ink.' });

    await act(async () => {
      fireEvent.click(screen.getByText('Keep as PDF'));
    });

    expect(await screen.findByText('No ink.')).toBeTruthy();
  });

  it('treats share-sheet cancellation as a quiet no-op', async () => {
    await renderReadyChapter();
    exportChapterKeepsakeSpy.mockResolvedValueOnce({ status: 'cancelled' });

    await act(async () => {
      fireEvent.click(screen.getByText('Keep as PDF'));
    });

    expect(screen.queryByText('No ink.')).toBeNull();
    expect(screen.getByText('Keep as PDF')).toBeTruthy();
  });

  it('known Free routes export to upgrade instead of exporting', async () => {
    mockServerPlus = {
      isPlus: false,
      status: 'inactive',
      expiresAt: null,
      mediaUsedBytes: 0,
      mediaLimitBytes: 250 * 1024 * 1024,
      activeFutureLetters: 0,
      futureLetterLimit: 1,
    };
    await renderReadyChapter();

    await act(async () => {
      fireEvent.click(screen.getByText('Keep as PDF · Plus'));
    });

    expect(pushSpy).toHaveBeenCalledWith('/(app)/paywall');
    expect(exportChapterKeepsakeSpy).not.toHaveBeenCalled();
  });

  it('unknown serverPlus is never displayed as authoritative Free', async () => {
    mockServerPlus = null;
    await renderReadyChapter();

    expect(screen.queryByText('Keep as PDF · Plus')).toBeNull();
    expect(screen.getByText('Check Plus status')).toBeTruthy();
    expect(
      screen.getByText(/Couldn't confirm Plus status/)
    ).toBeTruthy();

    await act(async () => {
      fireEvent.click(screen.getByText('Check Plus status'));
    });
    expect(refreshServerPlusSpy).toHaveBeenCalledTimes(1);
    expect(exportChapterKeepsakeSpy).not.toHaveBeenCalled();
  });

  it('Free chapter viewing stays fully readable; only export is gated', async () => {
    mockServerPlus = {
      isPlus: false,
      status: 'inactive',
      expiresAt: null,
      mediaUsedBytes: 0,
      mediaLimitBytes: 250 * 1024 * 1024,
      activeFutureLetters: 0,
      futureLetterLimit: 1,
    };
    const key = await renderReadyChapter();

    // Entries (photo/note/voice) render with no Plus requirement…
    expect(screen.getByTestId("chapter-photo-stack")).toBeTruthy();
    expect(screen.getByTestId('chapter-member-m-note')).toBeTruthy();
    expect(screen.getByTestId('chapter-member-m-photo')).toBeTruthy();
    expect(screen.getByTestId('chapter-member-m-voice')).toBeTruthy();

    // …while export offers the upgrade path instead.
    await act(async () => {
      fireEvent.click(screen.getByText('Keep as PDF · Plus'));
    });
    expect(pushSpy).toHaveBeenCalledWith('/(app)/paywall');
    expect(exportChapterKeepsakeSpy).not.toHaveBeenCalled();
  });
});

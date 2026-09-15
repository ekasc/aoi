import { vi, describe, it, expect, beforeEach } from 'vitest';
import { renderHook, act, waitFor } from '@testing-library/react';

const mockAppStateListeners: Array<(state: string) => void> = [];

vi.mock('react-native', () => ({
  AppState: {
    currentState: 'active',
    addEventListener: (_event: string, listener: (state: string) => void) => {
      mockAppStateListeners.push(listener);
      return {
        remove: () => {
          const index = mockAppStateListeners.indexOf(listener);
          if (index >= 0) {
            mockAppStateListeners.splice(index, 1);
          }
        },
      };
    },
  },
}));

vi.mock('@/features/api-client', () => ({
  isStubMode: () => false,
}));

const mockFetchMoments = vi.fn();
const mockFetchActivity = vi.fn();
const mockFetchBucketSummary = vi.fn();
const mockCreateMoment = vi.fn();
const mockUpdateMoment = vi.fn();
const mockDeleteMoment = vi.fn();

vi.mock('@/features/moments/remote-moments-api', () => ({
  fetchMoments: (...args: unknown[]) => mockFetchMoments(...args),
  fetchActivity: (...args: unknown[]) => mockFetchActivity(...args),
  fetchBucketSummary: (...args: unknown[]) => mockFetchBucketSummary(...args),
  createMoment: (...args: unknown[]) => mockCreateMoment(...args),
  updateMoment: (...args: unknown[]) => mockUpdateMoment(...args),
  deleteMoment: (...args: unknown[]) => mockDeleteMoment(...args),
}));

vi.mock('@/features/session/session-context', () => ({
  useSession: () => ({ user: null }),
}));

vi.mock('@/features/space/space-context', () => ({
  useSpace: () => ({ importedMilestones: [] }),
}));

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((r) => {
    resolve = r;
  });
  return { promise, resolve };
}

type Page = { moments: any[]; nextCursor?: string };

function remoteMoment(id: string, title: string) {
  return {
    id,
    type: 'note' as const,
    title,
    body: '',
    occurredAt: '2026-03-15T10:00:00.000Z',
    targetAt: null,
    createdAt: '2026-03-15T10:00:00.000Z',
    updatedAt: '2026-03-15T10:00:00.000Z',
    authorId: 'user_you',
    authorRole: 'you' as const,
    authorName: 'You',
    isOwn: true,
  };
}

describe('useMoments (remote refresh guards)', () => {
  beforeEach(() => {
    vi.resetModules();
    mockAppStateListeners.length = 0;
    mockFetchMoments.mockReset();
    mockFetchActivity.mockReset();
    mockFetchActivity.mockResolvedValue({ activity: [] });
    mockCreateMoment.mockReset();
    mockUpdateMoment.mockReset();
    mockDeleteMoment.mockReset();
  });

  async function renderRemoteMoments() {
    const { MomentsProvider, useMoments } = await import(
      '@/features/moments/moments-context'
    );
    return renderHook(() => useMoments(), {
      wrapper: ({ children }) => <MomentsProvider>{children}</MomentsProvider>,
    });
  }

  function triggerFocus() {
    act(() => {
      mockAppStateListeners.forEach((listener) => listener('active'));
    });
  }

  it('drops a stale response so it cannot overwrite fresher state', async () => {
    const firstLoad = deferred<Page>();
    const focusLoad = deferred<Page>();
    mockFetchMoments
      .mockReturnValueOnce(firstLoad.promise)
      .mockReturnValueOnce(focusLoad.promise);

    const { result } = await renderRemoteMoments();
    expect(mockFetchMoments).toHaveBeenCalledTimes(1);

    // Overlapping focus refresh while the initial load is still in flight.
    triggerFocus();
    await waitFor(() => expect(mockFetchMoments).toHaveBeenCalledTimes(2));

    // The newer request resolves first with fresh data...
    await act(async () => {
      focusLoad.resolve({ moments: [remoteMoment('m2', 'Fresh')] });
    });
    await waitFor(() => expect(result.current.moments).toHaveLength(1));
    expect(result.current.moments[0].title).toBe('Fresh');

    // ...then the stale one resolves and must be dropped.
    await act(async () => {
      firstLoad.resolve({ moments: [remoteMoment('m1', 'Stale')] });
    });
    expect(result.current.moments).toHaveLength(1);
    expect(result.current.moments[0].title).toBe('Fresh');
  });

  it('keeps background refreshes silent once data exists', async () => {
    const firstPage: Page = { moments: [remoteMoment('m1', 'First')] };
    const focusLoad = deferred<Page>();
    mockFetchMoments
      .mockResolvedValueOnce(firstPage)
      .mockReturnValueOnce(focusLoad.promise);

    const { result } = await renderRemoteMoments();
    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(result.current.moments).toHaveLength(1);

    // A focus refresh in flight must not flip the spinner back on.
    triggerFocus();
    await waitFor(() => expect(mockFetchMoments).toHaveBeenCalledTimes(2));
    expect(result.current.isLoading).toBe(false);

    await act(async () => {
      focusLoad.resolve({ moments: [remoteMoment('m2', 'Second')] });
    });
    await waitFor(() => expect(result.current.moments[0].title).toBe('Second'));
    expect(result.current.isLoading).toBe(false);
  });

  it('does not resurrect a deleted moment when a stale in-flight refresh resolves', async () => {
    const firstPage: Page = { moments: [remoteMoment('m1', 'First')] };
    const focusLoad = deferred<Page>();
    mockFetchMoments
      .mockResolvedValueOnce(firstPage)
      .mockReturnValueOnce(focusLoad.promise);
    mockDeleteMoment.mockResolvedValue(undefined);

    const { result } = await renderRemoteMoments();
    await waitFor(() => expect(result.current.moments).toHaveLength(1));

    // A focus refresh is now in flight with a snapshot that still includes m1...
    triggerFocus();
    await waitFor(() => expect(mockFetchMoments).toHaveBeenCalledTimes(2));

    // ...while the user deletes m1.
    await act(async () => {
      await result.current.removeMoment('m1');
    });
    expect(mockDeleteMoment).toHaveBeenCalledWith('m1');
    expect(result.current.moments).toHaveLength(0);

    // The stale snapshot resolves afterwards and must be dropped — it may not
    // resurrect the deleted row.
    await act(async () => {
      focusLoad.resolve({ moments: [remoteMoment('m1', 'First')] });
    });
    expect(result.current.moments).toHaveLength(0);
  });

  it('does not overwrite an updated moment when a stale in-flight refresh resolves', async () => {
    const firstPage: Page = { moments: [remoteMoment('m1', 'Before')] };
    const focusLoad = deferred<Page>();
    mockFetchMoments
      .mockResolvedValueOnce(firstPage)
      .mockReturnValueOnce(focusLoad.promise);
    mockUpdateMoment.mockResolvedValue(remoteMoment('m1', 'After'));

    const { result } = await renderRemoteMoments();
    await waitFor(() => expect(result.current.moments).toHaveLength(1));

    // A focus refresh is now in flight with a snapshot that predates the edit...
    triggerFocus();
    await waitFor(() => expect(mockFetchMoments).toHaveBeenCalledTimes(2));

    // ...while the user edits m1.
    await act(async () => {
      await result.current.updateMoment('m1', { title: 'After' });
    });
    expect(result.current.moments[0].title).toBe('After');

    // The stale snapshot resolves afterwards and must be dropped — it may not
    // roll the moment back to its pre-edit state.
    await act(async () => {
      focusLoad.resolve({ moments: [remoteMoment('m1', 'Before')] });
    });
    expect(result.current.moments).toHaveLength(1);
    expect(result.current.moments[0].title).toBe('After');
  });
});

describe('useMoments cursor pagination (Wall-driven)', () => {
  beforeEach(() => {
    mockAppStateListeners.length = 0;
    mockFetchMoments.mockReset();
    mockFetchActivity.mockReset();
    mockFetchActivity.mockResolvedValue({ activity: [] });
  });

  async function renderRemoteMoments() {
    const { MomentsProvider, useMoments } = await import(
      '@/features/moments/moments-context'
    );
    return renderHook(() => useMoments(), {
      wrapper: ({ children }) => <MomentsProvider>{children}</MomentsProvider>,
    });
  }

  it('loads the first bounded page and reports a remaining cursor', async () => {
    mockFetchMoments.mockResolvedValueOnce({
      moments: [remoteMoment('m1', 'First')],
      nextCursor: 'cursor-1',
    });

    const { result } = await renderRemoteMoments();
    await waitFor(() => expect(result.current.moments).toHaveLength(1));

    expect(mockFetchMoments).toHaveBeenCalledTimes(1);
    expect(mockFetchMoments).toHaveBeenCalledWith(undefined, 100);
    expect(result.current.hasMoreMoments).toBe(true);
  });

  it('advances the cursor, dedupes, terminates, and never refetches', async () => {
    mockFetchMoments.mockResolvedValueOnce({
      moments: [remoteMoment('m1', 'First')],
      nextCursor: 'cursor-1',
    });

    const { result } = await renderRemoteMoments();
    await waitFor(() => expect(result.current.hasMoreMoments).toBe(true));

    mockFetchMoments.mockResolvedValueOnce({
      // m1 repeats (overlap) plus the genuinely new m2.
      moments: [remoteMoment('m1', 'First'), remoteMoment('m2', 'Second')],
    });

    let more: boolean | undefined;
    await act(async () => {
      more = await result.current.loadMoreMoments();
    });

    expect(more).toBe(false);
    expect(mockFetchMoments).toHaveBeenCalledTimes(2);
    expect(mockFetchMoments).toHaveBeenLastCalledWith('cursor-1', 100);
    expect(result.current.moments.map((moment) => moment.id)).toEqual(['m1', 'm2']);
    expect(result.current.hasMoreMoments).toBe(false);

    // Exhausted: further calls never touch the network.
    await act(async () => {
      more = await result.current.loadMoreMoments();
    });
    expect(more).toBe(false);
    expect(mockFetchMoments).toHaveBeenCalledTimes(2);
  });

  it('retries the same page after a failure without skipping it', async () => {
    mockFetchMoments.mockResolvedValueOnce({
      moments: [remoteMoment('m1', 'First')],
      nextCursor: 'cursor-1',
    });

    const { result } = await renderRemoteMoments();
    await waitFor(() => expect(result.current.hasMoreMoments).toBe(true));

    mockFetchMoments.mockRejectedValueOnce(new Error('network down'));
    await act(async () => {
      await result.current.loadMoreMoments();
    });
    expect(result.current.hasMoreMoments).toBe(true);
    expect(result.current.moments).toHaveLength(1);

    mockFetchMoments.mockResolvedValueOnce({
      moments: [remoteMoment('m2', 'Second')],
    });
    await act(async () => {
      await result.current.loadMoreMoments();
    });
    // The retry re-requested the unadvanced cursor, not the next page.
    expect(mockFetchMoments).toHaveBeenLastCalledWith('cursor-1', 100);
    expect(result.current.moments.map((moment) => moment.id)).toEqual(['m1', 'm2']);
    expect(result.current.hasMoreMoments).toBe(false);
  });
});

describe('useMoments chapter reads (range + summary, Story-independent)', () => {
  beforeEach(() => {
    mockAppStateListeners.length = 0;
    mockFetchMoments.mockReset();
    mockFetchActivity.mockReset();
    mockFetchActivity.mockResolvedValue({ activity: [] });
    mockFetchBucketSummary.mockReset();
  });

  async function renderRemoteMoments() {
    const { MomentsProvider, useMoments } = await import(
      '@/features/moments/moments-context'
    );
    return renderHook(() => useMoments(), {
      wrapper: ({ children }) => <MomentsProvider>{children}</MomentsProvider>,
    });
  }

  it('pages a chapter range to completion without touching the Story cursor', async () => {
    mockFetchMoments.mockResolvedValueOnce({ moments: [] });
    const { result } = await renderRemoteMoments();
    await waitFor(() => expect(result.current.isLoading).toBe(false));
    mockFetchMoments.mockClear();

    const from = Date.parse('2026-08-01T00:00:00.000Z');
    const to = Date.parse('2026-09-01T00:00:00.000Z');
    mockFetchMoments
      .mockResolvedValueOnce({
        moments: [remoteMoment('m2', 'Second')],
        nextCursor: 'range-cursor',
      })
      .mockResolvedValueOnce({ moments: [remoteMoment('m1', 'First')] });

    let members: { id: string }[] = [];
    await act(async () => {
      members = await result.current.loadChapterRange(from, to);
    });

    expect(mockFetchMoments).toHaveBeenCalledTimes(2);
    expect(mockFetchMoments).toHaveBeenNthCalledWith(1, undefined, 100, { fromMs: from, toMs: to });
    expect(mockFetchMoments).toHaveBeenNthCalledWith(2, 'range-cursor', 100, { fromMs: from, toMs: to });
    // Oldest-first regardless of page arrival order; Story list untouched.
    expect(members.map((moment) => moment.id)).toEqual(['m1', 'm2']);
    expect(result.current.moments).toHaveLength(0);
    expect(result.current.hasMoreMoments).toBe(false);
  });

  it('passes bucket bounds through without touching moment pagination', async () => {
    mockFetchMoments.mockResolvedValueOnce({ moments: [] });
    const { result } = await renderRemoteMoments();
    await waitFor(() => expect(result.current.isLoading).toBe(false));
    mockFetchMoments.mockClear();
    mockFetchBucketSummary.mockResolvedValueOnce({
      buckets: [{ fromMs: 1, toMs: 2, count: 3, cover: null }],
      hasOlder: true,
    });

    let summary: { buckets: unknown[]; hasOlder: boolean } | undefined;
    await act(async () => {
      summary = await result.current.loadBucketSummary([{ fromMs: 1, toMs: 2 }]);
    });

    expect(mockFetchBucketSummary).toHaveBeenCalledTimes(1);
    expect(mockFetchBucketSummary).toHaveBeenCalledWith([{ fromMs: 1, toMs: 2 }]);
    expect(summary).toEqual({
      buckets: [{ fromMs: 1, toMs: 2, count: 3, cover: null }],
      hasOlder: true,
    });
    expect(mockFetchMoments).not.toHaveBeenCalled();
  });
});

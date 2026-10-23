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
const mockCreateMoment = vi.fn();
const mockUpdateMoment = vi.fn();
const mockDeleteMoment = vi.fn();
const mockReconcileMoments = vi.fn();

vi.mock('@/features/moments/remote-moments-api', () => ({
  fetchMoments: (...args: unknown[]) => mockFetchMoments(...args),
  createMoment: (...args: unknown[]) => mockCreateMoment(...args),
  updateMoment: (...args: unknown[]) => mockUpdateMoment(...args),
  deleteMoment: (...args: unknown[]) => mockDeleteMoment(...args),
  reconcileMoments: (...args: unknown[]) => mockReconcileMoments(...args),
}));

vi.mock('@/features/session/session-context', () => ({
  useSession: () => ({ user: null }),
}));

const spaceMock = vi.hoisted(() => ({ space: { id: 'space-1' } as { id: string } | null }));

vi.mock('@/features/space/space-context', () => ({
  useSpace: () => ({ space: spaceMock.space }),
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
  return remoteMomentAt(id, title, '2026-03-15T10:00:00.000Z');
}

function remoteMomentAt(id: string, title: string, occurredAt: string) {
  return {
    id,
    type: 'note' as const,
    title,
    body: '',
    occurredAt,
    targetAt: null,
    createdAt: occurredAt,
    updatedAt: occurredAt,
    authorId: 'user_you',
    authorRole: 'you' as const,
    authorName: 'You',
    isOwn: true,
  };
}

describe('useMoments (remote refresh guards)', () => {
  beforeEach(() => {
    vi.resetModules();
    spaceMock.space = { id: 'space-1' };
    mockAppStateListeners.length = 0;
    mockFetchMoments.mockReset();
    mockCreateMoment.mockReset();
    mockUpdateMoment.mockReset();
    mockDeleteMoment.mockReset();
    mockReconcileMoments.mockReset().mockImplementation(async (moments) => moments);
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
    // The head page landed, and the row it does not mention is older than the
    // page's oldest row: the loaded archive keeps it rather than rewinding.
    await waitFor(() => expect(result.current.moments).toHaveLength(2));
    expect(result.current.moments.map((moment) => moment.title)).toEqual(['First', 'Second']);
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
      const target = result.current.moments[0];
      await result.current.removeMoment('m1', target.updatedAt ?? target.createdAt);
    });
    expect(mockDeleteMoment).toHaveBeenCalledWith('m1', firstPage.moments[0].updatedAt ?? firstPage.moments[0].createdAt);
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
      const target = result.current.moments[0];
      await result.current.updateMoment('m1', { title: 'After', expectedUpdatedAt: target.updatedAt ?? target.createdAt });
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

  it('fires no fetch before the space is ready', async () => {
    // The regression: the provider fetched on mount, before session restore
    // published credentials, so every cold boot 401d with no tokens and the
    // feed stuck on "Offline" until a manual retry.
    spaceMock.space = null;
    mockFetchMoments.mockResolvedValue({ moments: [] });

    const { result, rerender } = await renderRemoteMoments();
    await act(async () => {
      await Promise.resolve();
    });
    expect(mockFetchMoments).not.toHaveBeenCalled();
    expect(result.current.error).toBeNull();

    // The space arriving starts the first load.
    spaceMock.space = { id: 'space-1' };
    rerender({});
    await waitFor(() => expect(mockFetchMoments).toHaveBeenCalledTimes(1));
  });

  it('drops the previous archive when the space changes', async () => {
    mockFetchMoments.mockResolvedValueOnce({ moments: [remoteMoment('a1', 'A one')] });

    const { result, rerender } = await renderRemoteMoments();
    await waitFor(() => expect(result.current.moments).toHaveLength(1));
    expect(result.current.moments[0].title).toBe('A one');

    mockFetchMoments.mockResolvedValueOnce({ moments: [remoteMoment('b1', 'B one')] });
    spaceMock.space = { id: 'space-2' };
    rerender({});
    await waitFor(() => expect(mockFetchMoments).toHaveBeenCalledTimes(2));
    // B's archive replaces A's — A's rows neither linger nor merge in.
    await waitFor(() =>
      expect(result.current.moments.map((moment) => moment.title)).toEqual(['B one']),
    );
  });
});

describe('useMoments cursor pagination (Wall-driven)', () => {
  beforeEach(() => {
    spaceMock.space = { id: 'space-1' };
    mockAppStateListeners.length = 0;
    mockFetchMoments.mockReset();
    mockReconcileMoments.mockReset().mockImplementation(async (moments) => moments);
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

  it('keeps the paged depth across a focus refresh', async () => {
    mockFetchMoments.mockResolvedValueOnce({
      moments: [remoteMomentAt('m3', 'Newest', '2026-03-15T10:00:00.000Z')],
      nextCursor: 'cursor-1',
    });

    const { result } = await renderRemoteMoments();
    await waitFor(() => expect(result.current.hasMoreMoments).toBe(true));

    mockFetchMoments.mockResolvedValueOnce({
      moments: [remoteMomentAt('m2', 'Older', '2026-02-15T10:00:00.000Z')],
      nextCursor: 'cursor-2',
    });
    await act(async () => {
      await result.current.loadMoreMoments();
    });
    expect(result.current.moments.map((moment) => moment.title)).toEqual(['Older', 'Newest']);

    // A focus refresh re-reads the head; the deeper page the reader opened
    // must survive it.
    mockFetchMoments.mockResolvedValueOnce({
      moments: [
        remoteMomentAt('m3', 'Newest', '2026-03-15T10:00:00.000Z'),
        remoteMomentAt('m4', 'Fresh', '2026-03-20T10:00:00.000Z'),
      ],
      nextCursor: 'cursor-1',
    });
    triggerFocus();
    await waitFor(() =>
      expect(result.current.moments.map((moment) => moment.title)).toEqual([
        'Older',
        'Newest',
        'Fresh',
      ]),
    );

    // And paging continues from the deepest cursor, not the head's, so the
    // rows in between can never go missing.
    mockFetchMoments.mockResolvedValueOnce({
      moments: [remoteMomentAt('m1', 'Oldest', '2026-01-15T10:00:00.000Z')],
    });
    await act(async () => {
      await result.current.loadMoreMoments();
    });
    expect(mockFetchMoments).toHaveBeenLastCalledWith('cursor-2', 100);
    expect(result.current.moments.map((moment) => moment.title)).toEqual([
      'Oldest',
      'Older',
      'Newest',
      'Fresh',
    ]);
  });

  it('drops a row the refreshed window no longer reports', async () => {
    mockFetchMoments.mockResolvedValueOnce({
      moments: [
        remoteMomentAt('m4', 'Newest', '2026-03-20T10:00:00.000Z'),
        remoteMomentAt('m2', 'Deleted', '2026-03-01T10:00:00.000Z'),
        remoteMomentAt('m1', 'Oldest', '2026-01-05T10:00:00.000Z'),
      ],
      nextCursor: 'cursor-1',
    });

    const { result } = await renderRemoteMoments();
    await waitFor(() => expect(result.current.moments).toHaveLength(3));

    // The partner deletes a memory that sits inside the window the head page
    // covers (newer than the page's oldest row): it disappears on refresh.
    mockReconcileMoments.mockResolvedValueOnce([
      remoteMomentAt('m4', 'Newest', '2026-03-20T10:00:00.000Z'),
      remoteMomentAt('m1', 'Oldest', '2026-01-05T10:00:00.000Z'),
    ]);
    mockFetchMoments.mockResolvedValueOnce({
      moments: [
        remoteMomentAt('m4', 'Newest', '2026-03-20T10:00:00.000Z'),
        remoteMomentAt('m1', 'Oldest', '2026-01-05T10:00:00.000Z'),
      ],
      nextCursor: 'cursor-1',
    });
    triggerFocus();
    await waitFor(() =>
      expect(result.current.moments.map((moment) => moment.title)).toEqual(['Oldest', 'Newest']),
    );
  });

  it('lands a memory that moved into the refreshed window exactly once', async () => {
    mockFetchMoments.mockResolvedValueOnce({
      moments: [
        remoteMomentAt('m3', 'Newest', '2026-03-15T10:00:00.000Z'),
        remoteMomentAt('m2', 'Old', '2026-01-10T10:00:00.000Z'),
      ],
      nextCursor: 'cursor-1',
    });

    const { result } = await renderRemoteMoments();
    await waitFor(() => expect(result.current.moments).toHaveLength(2));

    // The partner redates the old memory into the head window: the refresh
    // returns it once, and the deep copy must not survive as a duplicate.
    mockReconcileMoments.mockResolvedValueOnce([
      remoteMomentAt('m3', 'Newest', '2026-03-15T10:00:00.000Z'),
      remoteMomentAt('m2', 'Old', '2026-03-14T10:00:00.000Z'),
    ]);
    mockFetchMoments.mockResolvedValueOnce({
      moments: [
        remoteMomentAt('m3', 'Newest', '2026-03-15T10:00:00.000Z'),
        remoteMomentAt('m2', 'Old', '2026-03-14T10:00:00.000Z'),
      ],
      nextCursor: 'cursor-1',
    });
    triggerFocus();
    await waitFor(() =>
      expect(result.current.moments.map((moment) => moment.title)).toEqual(['Old', 'Newest']),
    );
    expect(result.current.moments.filter((moment) => moment.id === 'm2')).toHaveLength(1);
  });

  it('reconciles deep edits and deletions while retaining the paging cursor', async () => {
    const newest = remoteMomentAt('new', 'Newest', '2026-03-15T10:00:00.000Z');
    const older = remoteMomentAt('old', 'Older', '2025-01-15T10:00:00.000Z');
    const removed = remoteMomentAt('removed', 'Remove me', '2025-01-14T10:00:00.000Z');
    mockFetchMoments.mockResolvedValueOnce({ moments: [newest], nextCursor: 'head' });
    const { result } = await renderRemoteMoments();
    await waitFor(() => expect(result.current.hasMoreMoments).toBe(true));
    mockFetchMoments.mockResolvedValueOnce({ moments: [older, removed], nextCursor: 'deep' });
    await act(async () => { await result.current.loadMoreMoments(); });

    mockFetchMoments.mockResolvedValueOnce({ moments: [newest], nextCursor: 'head' });
    mockReconcileMoments.mockResolvedValueOnce([newest, { ...older, body: 'Edited by partner' }]);
    await act(async () => { await result.current.refresh(); });
    expect(result.current.moments.map((moment) => moment.id)).toEqual(['old', 'new']);
    expect(result.current.moments[0].body).toBe('Edited by partner');
    mockFetchMoments.mockResolvedValueOnce({ moments: [] });
    await act(async () => { await result.current.loadMoreMoments(); });
    expect(mockFetchMoments).toHaveBeenLastCalledWith('deep', 100);
  });

  it('retains a loaded memory redated behind the deepest cursor', async () => {
    const newest = remoteMomentAt('new', 'Newest', '2026-03-15T10:00:00.000Z');
    const moved = remoteMomentAt('moved', 'Moved', '2026-03-14T10:00:00.000Z');
    mockFetchMoments.mockResolvedValueOnce({ moments: [newest, moved], nextCursor: 'head' });
    const { result } = await renderRemoteMoments();
    await waitFor(() => expect(result.current.moments).toHaveLength(2));
    const backdated = { ...moved, occurredAt: '2020-01-01T00:00:00.000Z' };
    mockFetchMoments.mockResolvedValueOnce({ moments: [newest], nextCursor: 'head' });
    mockReconcileMoments.mockResolvedValueOnce([newest, backdated]);
    await act(async () => { await result.current.refresh(); });
    expect(result.current.moments).toEqual([backdated, newest]);
  });

  it('keeps the full window and reports failure if reconciliation fails', async () => {
    const older = remoteMomentAt('old', 'Older', '2025-01-15T10:00:00.000Z');
    mockFetchMoments.mockResolvedValueOnce({ moments: [older], nextCursor: 'head' });
    const { result } = await renderRemoteMoments();
    await waitFor(() => expect(result.current.moments).toHaveLength(1));
    mockFetchMoments.mockResolvedValueOnce({ moments: [] });
    mockReconcileMoments.mockRejectedValueOnce(new Error('Revalidation failed'));
    await act(async () => { await result.current.refresh(); });
    expect(result.current.moments).toEqual([older]);
    expect(result.current.error).toBe('Revalidation failed');
    expect(result.current.hasMoreMoments).toBe(true);
  });

  it('revalidates a conflicting memory without retrying the rejected write', async () => {
    const original = remoteMoment('memory', 'Before');
    const latest = { ...original, title: 'Newer version', updatedAt: '2026-03-15T10:00:00.001Z' };
    mockFetchMoments.mockResolvedValueOnce({ moments: [original] });
    const { result } = await renderRemoteMoments();
    await waitFor(() => expect(result.current.moments).toHaveLength(1));
    const conflict = Object.assign(new Error('Changed on another device'), { status: 409, code: 'CONFLICT' });
    mockUpdateMoment.mockRejectedValueOnce(conflict);
    mockReconcileMoments.mockResolvedValueOnce([latest]);
    await act(async () => {
      await expect(result.current.updateMoment(original.id, {
        expectedUpdatedAt: original.updatedAt, title: 'My draft',
      })).rejects.toBe(conflict);
    });
    expect(mockUpdateMoment).toHaveBeenCalledTimes(1);
    expect(result.current.moments).toEqual([latest]);
  });

  it('keeps a conflicting delete rejected and refreshes the row for reopening confirmation', async () => {
    const original = remoteMoment('memory', 'Before');
    const latest = { ...original, title: 'Newer version', updatedAt: '2026-03-15T10:00:00.001Z' };
    mockFetchMoments.mockResolvedValueOnce({ moments: [original] });
    const { result } = await renderRemoteMoments();
    await waitFor(() => expect(result.current.moments).toHaveLength(1));
    const conflict = Object.assign(new Error('Changed on another device'), { status: 409, code: 'CONFLICT' });
    mockDeleteMoment.mockRejectedValueOnce(conflict);
    mockReconcileMoments.mockResolvedValueOnce([latest]);
    await act(async () => {
      await expect(result.current.removeMoment(original.id, original.updatedAt)).rejects.toBe(conflict);
    });
    expect(mockDeleteMoment).toHaveBeenCalledTimes(1);
    expect(result.current.moments).toEqual([latest]);
  });

  it('does not resurrect a row deleted after the head snapshot', async () => {
    const removed = remoteMoment('removed', 'Removed');
    mockFetchMoments.mockResolvedValueOnce({ moments: [removed] });
    const { result } = await renderRemoteMoments();
    await waitFor(() => expect(result.current.moments).toHaveLength(1));
    mockFetchMoments.mockResolvedValueOnce({ moments: [removed] });
    mockReconcileMoments.mockResolvedValueOnce([]);
    await act(async () => { await result.current.refresh(); });
    expect(result.current.moments).toEqual([]);
  });

  it('drops reconciliation after a local mutation supersedes its snapshot', async () => {
    const old = remoteMoment('memory', 'Before');
    mockFetchMoments.mockResolvedValueOnce({ moments: [old] });
    const { result } = await renderRemoteMoments();
    await waitFor(() => expect(result.current.moments).toHaveLength(1));
    const reconciliation = deferred<ReturnType<typeof remoteMoment>[]>();
    mockFetchMoments.mockResolvedValueOnce({ moments: [old] });
    mockReconcileMoments.mockReturnValueOnce(reconciliation.promise);
    let refresh: Promise<void>;
    act(() => { refresh = result.current.refresh(); });
    await waitFor(() => expect(mockReconcileMoments).toHaveBeenCalledTimes(2));
    mockUpdateMoment.mockResolvedValueOnce({ ...old, title: 'After' });
    await act(async () => { await result.current.updateMoment(old.id, { title: 'After', expectedUpdatedAt: old.updatedAt ?? old.createdAt }); });
    await act(async () => { reconciliation.resolve([old]); await refresh; });
    expect(result.current.moments[0].title).toBe('After');
  });

  it('drops reconciliation from the previous space after switching archives', async () => {
    const old = remoteMoment('old-space', 'Old space');
    mockFetchMoments.mockResolvedValueOnce({ moments: [old] });
    const { result, rerender } = await renderRemoteMoments();
    await waitFor(() => expect(result.current.moments).toHaveLength(1));
    const reconciliation = deferred<ReturnType<typeof remoteMoment>[]>();
    mockFetchMoments.mockResolvedValueOnce({ moments: [old] });
    mockReconcileMoments.mockReturnValueOnce(reconciliation.promise);
    let refresh: Promise<void>;
    act(() => { refresh = result.current.refresh(); });
    await waitFor(() => expect(mockReconcileMoments).toHaveBeenCalledTimes(2));
    const next = remoteMoment('new-space', 'New space');
    mockFetchMoments.mockResolvedValueOnce({ moments: [next] });
    spaceMock.space = { id: 'space-2' };
    rerender({});
    await waitFor(() => expect(result.current.moments).toEqual([next]));
    await act(async () => { reconciliation.resolve([old]); await refresh; });
    expect(result.current.moments).toEqual([next]);
    expect(result.current.error).toBeNull();
  });

  it('keeps paging alive when the head refresh fails', async () => {
    mockFetchMoments.mockResolvedValueOnce({
      moments: [remoteMoment('m1', 'First')],
      nextCursor: 'cursor-1',
    });

    const { result } = await renderRemoteMoments();
    await waitFor(() => expect(result.current.hasMoreMoments).toBe(true));

    mockFetchMoments.mockRejectedValueOnce(new Error('offline'));
    triggerFocus();
    await waitFor(() => expect(result.current.error).toBe('offline'));

    // The failed head load must not silently end history paging.
    expect(result.current.hasMoreMoments).toBe(true);
    mockFetchMoments.mockResolvedValueOnce({ moments: [remoteMoment('m2', 'Older')] });
    await act(async () => {
      await result.current.loadMoreMoments();
    });
    expect(mockFetchMoments).toHaveBeenLastCalledWith('cursor-1', 100);
    expect(result.current.moments).toHaveLength(2);
  });

  it('reports a paging failure and retries the same page', async () => {
    mockFetchMoments.mockResolvedValueOnce({
      moments: [remoteMoment('m1', 'First')],
      nextCursor: 'cursor-1',
    });

    const { result } = await renderRemoteMoments();
    await waitFor(() => expect(result.current.hasMoreMoments).toBe(true));
    expect(result.current.pagingError).toBeNull();

    mockFetchMoments.mockRejectedValueOnce(new Error('boom'));
    await act(async () => {
      await result.current.loadMoreMoments();
    });
    expect(result.current.pagingError).toBe('boom');

    mockFetchMoments.mockResolvedValueOnce({
      moments: [remoteMoment('m2', 'Second')],
      nextCursor: 'cursor-2',
    });
    await act(async () => {
      await result.current.loadMoreMoments();
    });
    expect(mockFetchMoments).toHaveBeenLastCalledWith('cursor-1', 100);
    expect(result.current.pagingError).toBeNull();
    expect(result.current.moments).toHaveLength(2);
  });

  it('ends the first paint spinner even when a mutation supersedes the load', async () => {
    const firstLoad = deferred<Page>();
    mockFetchMoments.mockReturnValueOnce(firstLoad.promise);
    mockCreateMoment.mockResolvedValue(remoteMoment('m-new', 'New'));

    const { result } = await renderRemoteMoments();
    expect(result.current.isLoading).toBe(true);

    // The user saves something before the first page lands: the mutation
    // supersedes the load, and the response is dropped as stale.
    await act(async () => {
      await result.current.addMoment({ type: 'note', title: 'New', body: '' });
    });
    await act(async () => {
      firstLoad.resolve({ moments: [remoteMoment('m1', 'First')] });
    });
    await waitFor(() => expect(result.current.isLoading).toBe(false));
  });

  it('keeps paging suppressed until the last overlapping head load settles', async () => {
    mockFetchMoments.mockResolvedValueOnce({
      moments: [remoteMoment('m1', 'First')],
      nextCursor: 'cursor-1',
    });

    const { result } = await renderRemoteMoments();
    await waitFor(() => expect(result.current.hasMoreMoments).toBe(true));

    // Two head loads overlap: the first settles while the second still runs,
    // and its completion may not re-open paging.
    const first = deferred<Page>();
    const second = deferred<Page>();
    mockFetchMoments.mockReturnValueOnce(first.promise).mockReturnValueOnce(second.promise);
    triggerFocus();
    await waitFor(() => expect(mockFetchMoments).toHaveBeenCalledTimes(2));
    triggerFocus();
    await waitFor(() => expect(mockFetchMoments).toHaveBeenCalledTimes(3));

    await act(async () => {
      first.resolve({ moments: [remoteMoment('m1', 'First')], nextCursor: 'cursor-1' });
    });

    const callsBefore = mockFetchMoments.mock.calls.length;
    await act(async () => {
      await result.current.loadMoreMoments();
    });
    expect(mockFetchMoments.mock.calls.length).toBe(callsBefore);

    // Once the newest head load settles, paging resumes normally.
    await act(async () => {
      second.resolve({ moments: [remoteMoment('m1', 'First')], nextCursor: 'cursor-1' });
    });
    mockFetchMoments.mockResolvedValueOnce({ moments: [remoteMoment('m2', 'Older')] });
    await act(async () => {
      await result.current.loadMoreMoments();
    });
    expect(mockFetchMoments).toHaveBeenLastCalledWith('cursor-1', 100);
  });

  it('never pages against a head refresh that is still in flight', async () => {
    mockFetchMoments.mockResolvedValueOnce({
      moments: [remoteMoment('m1', 'First')],
      nextCursor: 'cursor-1',
    });

    const { result } = await renderRemoteMoments();
    await waitFor(() => expect(result.current.hasMoreMoments).toBe(true));

    const focusLoad = deferred<Page>();
    mockFetchMoments.mockReturnValueOnce(focusLoad.promise);
    triggerFocus();
    await waitFor(() => expect(mockFetchMoments).toHaveBeenCalledTimes(2));

    const callsBefore = mockFetchMoments.mock.calls.length;
    let more = false;
    await act(async () => {
      more = await result.current.loadMoreMoments();
    });
    // Suppressed, and still reports the cursor as usable.
    expect(mockFetchMoments.mock.calls.length).toBe(callsBefore);
    expect(more).toBe(true);

    await act(async () => {
      focusLoad.resolve({
        moments: [remoteMoment('m1', 'First')],
        nextCursor: 'cursor-1',
      });
    });
    expect(result.current.pagingError).toBeNull();
  });

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

});

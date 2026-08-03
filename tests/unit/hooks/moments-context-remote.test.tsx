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

vi.mock('@/features/moments/remote-moments-api', () => ({
  fetchMoments: (...args: unknown[]) => mockFetchMoments(...args),
  fetchActivity: (...args: unknown[]) => mockFetchActivity(...args),
  createMoment: vi.fn(),
  updateMoment: vi.fn(),
  deleteMoment: vi.fn(),
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
});

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act, waitFor } from '@testing-library/react';

vi.mock('@/features/api-client', () => ({
  isStubMode: () => true,
}));

vi.mock('@/features/space/space-context', () => ({
  useSpace: () => ({ importedMilestones: [] }),
}));

describe('useMoments (stub)', () => {
  beforeEach(() => {
    vi.resetModules();
  });

  it('returns moments from mock data', async () => {
    const { MomentsProvider, useMoments } = await import('@/features/moments/moments-context');
    const { mockMoments } = await import('@/features/moments/mock-data');

    const { result } = renderHook(() => useMoments(), {
      wrapper: ({ children }) => <MomentsProvider>{children}</MomentsProvider>,
    });

    await waitFor(() => {
      expect(result.current.moments.length).toBeGreaterThan(0);
    });

    expect(result.current.isLoading).toBe(false);
    expect(result.current.error).toBeNull();
  });

  it('addMoment adds to the list', async () => {
    const { MomentsProvider, useMoments } = await import('@/features/moments/moments-context');

    const { result } = renderHook(() => useMoments(), {
      wrapper: ({ children }) => <MomentsProvider>{children}</MomentsProvider>,
    });

    await waitFor(() => {
      expect(result.current.moments.length).toBeGreaterThan(0);
    });

    const initialCount = result.current.moments.length;

    await act(async () => {
      await result.current.addMoment({
        type: 'note',
        title: 'New test moment',
        body: 'Added via test',
      });
    });

    expect(result.current.moments.length).toBe(initialCount + 1);
    const added = result.current.moments.find((m: any) => m.title === 'New test moment');
    expect(added).toBeTruthy();
  });

  it('removeMoment removes from the list', async () => {
    const { MomentsProvider, useMoments } = await import('@/features/moments/moments-context');

    const { result } = renderHook(() => useMoments(), {
      wrapper: ({ children }) => <MomentsProvider>{children}</MomentsProvider>,
    });

    await waitFor(() => {
      expect(result.current.moments.length).toBeGreaterThan(0);
    });

    const idToRemove = result.current.moments[0].id;

    await act(async () => {
      await result.current.removeMoment(idToRemove);
    });

    const stillExists = result.current.moments.find((m: any) => m.id === idToRemove);
    expect(stillExists).toBeUndefined();
  });

  it('updateMoment edits an existing moment and stamps updatedAt', async () => {
    const { MomentsProvider, useMoments } = await import('@/features/moments/moments-context');

    const { result } = renderHook(() => useMoments(), {
      wrapper: ({ children }) => <MomentsProvider>{children}</MomentsProvider>,
    });

    await waitFor(() => {
      expect(result.current.moments.length).toBeGreaterThan(0);
    });

    const target = result.current.moments[0];

    await act(async () => {
      await result.current.updateMoment(target.id, { title: 'Edited title' });
    });

    const edited = result.current.moments.find((m: any) => m.id === target.id);
    expect(edited?.title).toBe('Edited title');
    // Edited marker contract: updatedAt moves beyond the 1s tolerance.
    expect(new Date(edited!.updatedAt!).getTime()).toBeGreaterThan(
      new Date(edited!.createdAt).getTime() + 1000,
    );
  });

  it('updateMoment applies partial patches without clobbering other fields', async () => {
    const { MomentsProvider, useMoments } = await import('@/features/moments/moments-context');

    const { result } = renderHook(() => useMoments(), {
      wrapper: ({ children }) => <MomentsProvider>{children}</MomentsProvider>,
    });

    await waitFor(() => {
      expect(result.current.moments.length).toBeGreaterThan(0);
    });

    const target = result.current.moments[0];

    await act(async () => {
      await result.current.updateMoment(target.id, { body: 'Only the body changed' });
    });

    const edited = result.current.moments.find((m: any) => m.id === target.id);
    expect(edited?.body).toBe('Only the body changed');
    expect(edited?.title).toBe(target.title);
    expect(edited?.type).toBe(target.type);
  });

  it('removeMoment synthesizes a tombstone activity item in stub mode', async () => {
    const { MomentsProvider, useMoments } = await import('@/features/moments/moments-context');

    const { result } = renderHook(() => useMoments(), {
      wrapper: ({ children }) => <MomentsProvider>{children}</MomentsProvider>,
    });

    await waitFor(() => {
      expect(result.current.moments.length).toBeGreaterThan(0);
    });

    expect(result.current.activity).toEqual([]);

    const idToRemove = result.current.moments[0].id;

    await act(async () => {
      await result.current.removeMoment(idToRemove);
    });

    expect(result.current.activity).toHaveLength(1);
    const tombstone = result.current.activity[0];
    expect(tombstone.kind).toBe('moment_deleted');
    expect(tombstone.actorName).toBe('You');
    // Privacy: the tombstone carries fact + actor only.
    expect(Object.keys(tombstone).sort()).toEqual(
      ['actorName', 'id', 'kind', 'occurredAt'].sort(),
    );
  });

  it('refresh resolves without mutating local stub data', async () => {
    const { MomentsProvider, useMoments } = await import('@/features/moments/moments-context');

    const { result } = renderHook(() => useMoments(), {
      wrapper: ({ children }) => <MomentsProvider>{children}</MomentsProvider>,
    });

    await waitFor(() => {
      expect(result.current.moments.length).toBeGreaterThan(0);
    });

    const before = result.current.moments.length;

    await act(async () => {
      await result.current.refresh();
    });

    expect(result.current.moments.length).toBe(before);
  });

  it('throws when used outside provider', async () => {
    const { useMoments } = await import('@/features/moments/moments-context');

    expect(() => {
      renderHook(() => useMoments());
    }).toThrow('useMoments must be used within MomentsProvider');
  });
});

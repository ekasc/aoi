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

  it('throws when used outside provider', async () => {
    const { useMoments } = await import('@/features/moments/moments-context');

    expect(() => {
      renderHook(() => useMoments());
    }).toThrow('useMoments must be used within MomentsProvider');
  });
});

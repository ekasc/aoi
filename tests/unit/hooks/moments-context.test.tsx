import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act, waitFor } from '@testing-library/react';

vi.mock('@/features/api-client', () => ({
  isStubMode: () => true,
}));

vi.mock('@/features/space/space-context', () => ({
  useSpace: () => ({ space: null }),
}));

async function renderStubMoments() {
  const { MomentsProvider, useMoments } = await import('@/features/moments/moments-context');

  return renderHook(() => useMoments(), {
    wrapper: ({ children }) => <MomentsProvider>{children}</MomentsProvider>,
  });
}

describe('useMoments (stub)', () => {
  beforeEach(() => {
    vi.resetModules();
  });

  it('starts empty: a space with no memories has no moments', async () => {
    const { result } = await renderStubMoments();

    await waitFor(() => {
      expect(result.current.isLoading).toBe(false);
    });

    expect(result.current.moments).toEqual([]);
    expect(result.current.error).toBeNull();
  });

  it('addMoment adds to the list', async () => {
    const { result } = await renderStubMoments();

    await act(async () => {
      await result.current.addMoment({
        type: 'note',
        title: 'New test moment',
        body: 'Added via test',
      });
    });

    expect(result.current.moments).toHaveLength(1);
    expect(result.current.moments[0].title).toBe('New test moment');
  });

  it('removeMoment removes from the list', async () => {
    const { result } = await renderStubMoments();

    await act(async () => {
      await result.current.addMoment({ type: 'note', title: 'Keep me' });
      await result.current.addMoment({ type: 'note', title: 'Remove me' });
    });

    const target = result.current.moments.find((m) => m.title === 'Remove me')!;
    const idToRemove = target.id;

    await act(async () => {
      await result.current.removeMoment(idToRemove, target.updatedAt ?? target.createdAt);
    });

    expect(result.current.moments.find((m) => m.id === idToRemove)).toBeUndefined();
    expect(result.current.moments).toHaveLength(1);
  });

  it('updateMoment edits a locally created moment', async () => {
    const { result } = await renderStubMoments();

    await act(async () => {
      await result.current.addMoment({ type: 'note', title: 'Original' });
    });

    const target = result.current.moments[0];

    await act(async () => {
      await result.current.updateMoment(target.id, { title: 'Edited title', expectedUpdatedAt: target.updatedAt ?? target.createdAt });
    });

    const edited = result.current.moments.find((m) => m.id === target.id);
    expect(edited?.title).toBe('Edited title');
  });

  it('updateMoment applies partial patches without clobbering other fields', async () => {
    const { result } = await renderStubMoments();

    await act(async () => {
      await result.current.addMoment({ type: 'note', title: 'Kept', body: 'Original body' });
    });

    const target = result.current.moments[0];

    await act(async () => {
      await result.current.updateMoment(target.id, { body: 'Only the body changed', expectedUpdatedAt: target.updatedAt ?? target.createdAt });
    });

    const edited = result.current.moments.find((m) => m.id === target.id);
    expect(edited?.body).toBe('Only the body changed');
    expect(edited?.title).toBe(target.title);
    expect(edited?.type).toBe(target.type);
  });

  it('rejects same-tick stale writes and deletes without losing the winning edit', async () => {
    const { result } = await renderStubMoments();
    await act(async () => {
      await result.current.addMoment({ type: 'note', body: 'Original' });
    });
    const original = result.current.moments[0];
    const version = original.updatedAt ?? original.createdAt;
    const clock = vi.spyOn(Date, 'now').mockReturnValueOnce(Date.parse(version));
    const conflict = 'This memory changed on another device. Reopen it before trying again.';
    await act(async () => {
      const first = result.current.updateMoment(original.id, { body: 'Winner', expectedUpdatedAt: version });
      const stale = result.current.updateMoment(original.id, { body: 'Loser', expectedUpdatedAt: version });
      await first;
      await expect(stale).rejects.toThrow(conflict);
      await expect(result.current.removeMoment(original.id, version)).rejects.toThrow(conflict);
    });
    const winner = result.current.moments[0];
    clock.mockRestore();
    expect(winner.body).toBe('Winner');
    expect(Date.parse(winner.updatedAt!)).toBe(Date.parse(version) + 1);
    await act(async () => {
      await result.current.removeMoment(winner.id, winner.updatedAt!);
      await expect(result.current.updateMoment(winner.id, { body: 'Resurrected', expectedUpdatedAt: winner.updatedAt! })).rejects.toThrow(conflict);
    });
    expect(result.current.moments).toEqual([]);
  });

  it('derives isOwn from authorRole', async () => {
    const { result } = await renderStubMoments();

    await act(async () => {
      await result.current.addMoment({ type: 'note', title: 'Mine', authorRole: 'you' });
      await result.current.addMoment({ type: 'note', title: 'Theirs', authorRole: 'partner' });
    });

    const own = result.current.moments.find((m) => m.authorRole === 'you');
    const partner = result.current.moments.find((m) => m.authorRole === 'partner');
    expect(own?.isOwn).toBe(true);
    expect(partner?.isOwn).toBe(false);
  });

  it('refresh resolves without mutating local stub data', async () => {
    const { result } = await renderStubMoments();

    await act(async () => {
      await result.current.addMoment({ type: 'note', title: 'Steady' });
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

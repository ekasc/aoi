import { act, renderHook, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { SpaceProvider, useSpace } from '@/features/space/space-context';
import type { RelationshipSpace } from '@/features/space/types';

const state = vi.hoisted(() => ({
  session: { status: 'signed_in', user: { id: 'user-1' } },
  read: vi.fn<(userId: string) => Promise<RelationshipSpace | null>>(),
  change: (_next: string) => {},
  remove: vi.fn(),
}));

vi.mock('@/features/session/session-context', () => ({ useSession: () => state.session }));
vi.mock('@/features/space/space-repository', () => ({
  getSpaceRepository: () => ({ getSpaceForUser: state.read }),
}));
vi.mock('react-native', () => ({
  AppState: {
    currentState: 'active',
    addEventListener: (_event: string, listener: (next: string) => void) => {
      state.change = listener;
      return { remove: state.remove };
    },
  },
}));

const space: RelationshipSpace = {
  id: 'space-1', name: 'Our space', createdByUserId: 'user-1',
  yourName: 'Maya', partnerName: 'June', relationshipStartDate: null,
  inviteCode: 'ABC123', partnerJoined: false, inviteExpiresAt: null,
  createdAt: '2026-01-01T00:00:00Z', updatedAt: '2026-01-01T00:00:00Z',
};

beforeEach(() => {
  state.session = { status: 'signed_in', user: { id: 'user-1' } };
  state.read.mockReset().mockResolvedValue(space);
  state.remove.mockReset();
});

describe('space refresh across two phones', () => {
  it('picks up a partner joining when returning to the foreground without push', async () => {
    const { result, unmount } = renderHook(() => useSpace(), { wrapper: SpaceProvider });
    await waitFor(() => expect(result.current.space?.id).toBe(space.id));
    state.read.mockResolvedValue({ ...space, partnerJoined: true });
    act(() => state.change('background'));
    await act(async () => state.change('active'));
    expect(result.current.space?.partnerJoined).toBe(true);
    expect(state.read).toHaveBeenCalledTimes(2);
    unmount();
    expect(state.remove).toHaveBeenCalledOnce();
  });

  it('retains the current space and reports a failed manual check to its caller', async () => {
    const { result } = renderHook(() => useSpace(), { wrapper: SpaceProvider });
    await waitFor(() => expect(result.current.space?.id).toBe(space.id));
    state.read.mockRejectedValueOnce(new Error('offline'));
    await act(async () => {
      await expect(result.current.refreshSpace()).rejects.toThrow('offline');
    });
    expect(result.current.space).toEqual(space);
    expect(result.current.status).toBe('ready');
  });

  it('ignores a refresh from the previous account after the user changes', async () => {
    const { result, rerender } = renderHook(() => useSpace(), { wrapper: SpaceProvider });
    await waitFor(() => expect(result.current.space?.id).toBe(space.id));
    let finish: (value: RelationshipSpace) => void = () => {};
    state.read.mockImplementationOnce(() => new Promise((resolve) => { finish = resolve; }));
    const pending = result.current.refreshSpace();
    state.session = { status: 'signed_in', user: { id: 'user-2' } };
    state.read.mockResolvedValue({ ...space, id: 'space-2' });
    rerender();
    await waitFor(() => expect(result.current.space?.id).toBe('space-2'));
    await act(async () => { finish(space); await pending; });
    expect(result.current.space?.id).toBe('space-2');
  });
});

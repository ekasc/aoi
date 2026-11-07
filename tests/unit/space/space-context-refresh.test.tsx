import { act, renderHook, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { SpaceProvider, useSpace } from '@/features/space/space-context';
import type { RelationshipSpace } from '@/features/space/types';

const state = vi.hoisted(() => ({
  session: { status: 'signed_in', user: { id: 'user-1' } },
  read: vi.fn<(userId: string) => Promise<RelationshipSpace | null>>(),
  leave: vi.fn<(userId: string) => Promise<void>>(),
  update: vi.fn<() => Promise<RelationshipSpace | null>>(),
  snapshot: vi.fn<(userId: string) => Promise<RelationshipSpace | null>>(),
  clearSnapshot: vi.fn(),
  change: (_next: string) => {},
  remove: vi.fn(),
}));

vi.mock('@/features/session/session-context', () => ({ useSession: () => state.session }));
vi.mock('@/features/space/space-repository', () => ({
  getSpaceRepository: () => ({ getSpaceForUser: state.read, leaveSpace: state.leave, updateSpaceForUser: state.update }),
}));
vi.mock('@/features/space/space-snapshot', () => ({
  readSpaceSnapshot: state.snapshot,
  writeSpaceSnapshot: vi.fn(async () => {}),
  clearSpaceSnapshot: state.clearSnapshot,
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
  state.snapshot.mockReset().mockResolvedValue(null);
  state.leave.mockReset().mockResolvedValue(undefined);
  state.update.mockReset().mockResolvedValue({ ...space, name: 'Renamed' });
  state.clearSnapshot.mockReset();
  state.remove.mockReset();
});

describe('space refresh across two phones', () => {
  it('keeps cached membership on restart when the server returns no space', async () => {
    state.snapshot.mockResolvedValue(space);
    state.read.mockResolvedValue(null);
    const { result } = renderHook(() => useSpace(), { wrapper: SpaceProvider });
    await waitFor(() => expect(state.read).toHaveBeenCalled());
    await act(async () => {});
    expect(result.current.space).toEqual(space);
    expect(result.current.status).toBe('ready');
    expect(state.clearSnapshot).not.toHaveBeenCalled();
  });

  it('retains the cached membership when leaving fails', async () => {
    const { result } = renderHook(() => useSpace(), { wrapper: SpaceProvider });
    await waitFor(() => expect(result.current.space?.id).toBe(space.id));
    state.leave.mockRejectedValueOnce(new Error('offline'));
    await act(async () => { await expect(result.current.leaveSpace()).rejects.toThrow('offline'); });
    expect(result.current.space).toEqual(space);
    expect(state.clearSnapshot).not.toHaveBeenCalled();
  });

  it('does not restore membership from a read that finishes after an explicit leave', async () => {
    const { result } = renderHook(() => useSpace(), { wrapper: SpaceProvider });
    await waitFor(() => expect(result.current.space?.id).toBe(space.id));
    let finish: (value: RelationshipSpace) => void = () => {};
    state.read.mockImplementationOnce(() => new Promise((resolve) => { finish = resolve; }));
    const pending = result.current.refreshSpace();
    await act(async () => { await result.current.leaveSpace(); });
    await act(async () => { finish(space); await pending; });
    expect(result.current.space).toBeNull();
    expect(result.current.status).toBe('none');
    expect(state.clearSnapshot).toHaveBeenCalledWith('user-1');
  });

  it('does not clear a new space when an old leave completes after an A-B-A account switch', async () => {
    const { result, rerender } = renderHook(() => useSpace(), { wrapper: SpaceProvider });
    await waitFor(() => expect(result.current.space?.id).toBe(space.id));
    let finishLeave: () => void = () => {};
    state.leave.mockImplementationOnce(() => new Promise((resolve) => { finishLeave = resolve; }));
    const pending = result.current.leaveSpace();
    state.session = { status: 'signed_in', user: { id: 'user-2' } };
    state.read.mockResolvedValue({ ...space, id: 'space-B' });
    rerender();
    await waitFor(() => expect(result.current.space?.id).toBe('space-B'));
    state.session = { status: 'signed_in', user: { id: 'user-1' } };
    state.read.mockResolvedValue({ ...space, id: 'new-space-A' });
    rerender();
    await waitFor(() => expect(result.current.space?.id).toBe('new-space-A'));
    await act(async () => { finishLeave(); await pending; });
    expect(result.current.space?.id).toBe('new-space-A');
    expect(state.clearSnapshot).not.toHaveBeenCalled();
  });

  it('still honors an explicit leave when an edit to the same space finishes first', async () => {
    const { result } = renderHook(() => useSpace(), { wrapper: SpaceProvider });
    await waitFor(() => expect(result.current.space?.id).toBe(space.id));
    let finishLeave: () => void = () => {};
    state.leave.mockImplementationOnce(() => new Promise((resolve) => { finishLeave = resolve; }));
    const pending = result.current.leaveSpace();
    await act(async () => { await result.current.updateSpace({ name: 'Renamed' }); });
    await act(async () => { finishLeave(); await pending; });
    expect(result.current.status).toBe('none');
    expect(result.current.space).toBeNull();
  });

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

  it('retains known membership when a background read returns no space', async () => {
    const { result } = renderHook(() => useSpace(), { wrapper: SpaceProvider });
    await waitFor(() => expect(result.current.space?.id).toBe(space.id));
    state.read.mockResolvedValueOnce(null);
    await act(async () => { await result.current.refreshSpace(); });
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

import { act, renderHook, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { SpaceProvider, useSpace } from '@/features/space/space-context';
import type { RelationshipSpace } from '@/features/space/types';

/**
 * MiroFish-lab scenario AOI-SIM-004: a join that started under one account
 * must never become the next account's space. This is the mutation-path
 * counterpart to the existing foreground-refresh guard.
 */
const state = vi.hoisted(() => ({
  session: { status: 'signed_in', user: { id: 'user-1' } },
  read: vi.fn<(userId: string) => Promise<RelationshipSpace | null>>(),
  join: vi.fn<(input: { userId: string; inviteCode: string }) => Promise<RelationshipSpace>>(),
}));

vi.mock('@/features/session/session-context', () => ({ useSession: () => state.session }));
vi.mock('@/features/space/space-repository', () => ({
  getSpaceRepository: () => ({
    getSpaceForUser: state.read,
    joinSpace: state.join,
  }),
}));
vi.mock('react-native', () => ({
  AppState: {
    currentState: 'active',
    addEventListener: () => ({ remove: () => {} }),
  },
}));

const spaceA: RelationshipSpace = {
  id: 'space-a',
  name: "Alice's space",
  createdByUserId: 'user-1',
  yourName: 'Alice',
  partnerName: 'Bob',
  relationshipStartDate: null,
  inviteCode: 'AAA111',
  partnerJoined: true,
  inviteExpiresAt: null,
  createdAt: '2026-01-01T00:00:00Z',
  updatedAt: '2026-01-01T00:00:00Z',
};

const spaceB: RelationshipSpace = {
  ...spaceA,
  id: 'space-b',
  name: "Blake's space",
  createdByUserId: 'user-2',
  yourName: 'Blake',
  partnerName: null,
  inviteCode: 'BBB222',
  partnerJoined: false,
};

beforeEach(() => {
  state.session = { status: 'signed_in', user: { id: 'user-1' } };
  state.read.mockReset().mockResolvedValue(spaceA);
  state.join.mockReset();
});

describe('space mutation across an account change', () => {
  it('[AOI-SIM-011] ignores a join that finishes after the previous account changes', async () => {
    const { result, rerender } = renderHook(() => useSpace(), { wrapper: SpaceProvider });
    await waitFor(() => expect(result.current.space?.id).toBe('space-a'));

    let finishJoin: (space: RelationshipSpace) => void = () => {};
    state.join.mockImplementationOnce(
      () =>
        new Promise<RelationshipSpace>((resolve) => {
          finishJoin = resolve;
        })
    );

    let pending: Promise<RelationshipSpace> | undefined;
    act(() => {
      pending = result.current.joinSpace({ userId: 'user-1', inviteCode: 'AAA111' });
    });

    state.session = { status: 'signed_in', user: { id: 'user-2' } };
    state.read.mockResolvedValue(spaceB);
    rerender();
    await waitFor(() => expect(result.current.space?.id).toBe('space-b'));

    await act(async () => {
      finishJoin(spaceA);
      await pending;
    });

    expect(result.current.space?.id).toBe('space-b');
    expect(result.current.space?.yourName).toBe('Blake');
  });
});

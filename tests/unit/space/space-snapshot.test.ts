import { describe, expect, it, vi } from 'vitest';

import { clearSpaceSnapshot, readSpaceSnapshot, writeSpaceSnapshot } from '@/features/space/space-snapshot';
import type { RelationshipSpace } from '@/features/space/types';

const storage = vi.hoisted(() => ({
  getItem: vi.fn(), setItem: vi.fn(), removeItem: vi.fn(),
}));
vi.mock('@react-native-async-storage/async-storage', () => ({ default: storage }));

describe('space snapshot ordering', () => {
  it('does not restore a left space when an earlier cache write finishes late', async () => {
    let saved: string | null = null;
    let finishWrite: () => void = () => {};
    const gate = new Promise<void>((resolve) => { finishWrite = resolve; });
    storage.getItem.mockImplementation(async () => saved);
    storage.setItem.mockImplementation(async (_key: string, value: string) => { await gate; saved = value; });
    storage.removeItem.mockImplementation(async () => { saved = null; });
    const space: RelationshipSpace = {
      id: 'space-1', name: 'Ours', createdByUserId: 'user-1', yourName: 'Maya',
      partnerName: 'June', relationshipStartDate: null, inviteCode: '', partnerJoined: true,
      inviteExpiresAt: null, createdAt: '2026-01-01', updatedAt: '2026-01-01',
    };
    const pendingWrite = writeSpaceSnapshot('user-1', space);
    const pendingClear = clearSpaceSnapshot('user-1');
    finishWrite();
    await Promise.all([pendingWrite, pendingClear]);
    expect(await readSpaceSnapshot('user-1')).toBeNull();
  });
});

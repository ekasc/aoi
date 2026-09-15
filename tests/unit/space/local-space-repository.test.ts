import { describe, it, expect, beforeEach, vi } from 'vitest';

const store = new Map<string, string>();

vi.mock('@react-native-async-storage/async-storage', () => ({
  default: {
    getItem: vi.fn(async (key: string) => store.get(key) ?? null),
    setItem: vi.fn(async (key: string, value: string) => {
      store.set(key, value);
    }),
    removeItem: vi.fn(async (key: string) => {
      store.delete(key);
    }),
    multiRemove: vi.fn(async (keys: string[]) => {
      for (const key of keys) {
        store.delete(key);
      }
    }),
  },
}));

import { localSpaceRepository } from '@/features/space/local-space-repository';

beforeEach(() => {
  store.clear();
});

describe('local space repository partnership truth', () => {
  it('creates waiting spaces with no joined partner', async () => {
    const space = await localSpaceRepository.createSpace({
      name: 'Our Space',
      createdByUserId: 'user-1',
      yourName: 'Aoi',
    });

    expect(space.partnerJoined).toBe(false);
    expect(space.partnerName).toBeNull();
    expect(space.inviteExpiresAt).toBeNull();
  });

  it('join marks every stored copy joined (joiner, creator, invite slot)', async () => {
    const created = await localSpaceRepository.createSpace({
      name: 'Our Space',
      createdByUserId: 'user-1',
      yourName: 'Aoi',
    });

    const joined = await localSpaceRepository.joinSpace({
      userId: 'user-2',
      inviteCode: created.inviteCode,
    });
    expect(joined.partnerJoined).toBe(true);

    // The creator's copy flips too — no split-brain waiting state.
    const creatorCopy = await localSpaceRepository.getSpaceForUser('user-1');
    expect(creatorCopy?.partnerJoined).toBe(true);
  });

  it('leave clears only the leaver, regenerate returns the live code', async () => {
    const created = await localSpaceRepository.createSpace({
      name: 'Our Space',
      createdByUserId: 'user-1',
      yourName: 'Aoi',
    });
    await localSpaceRepository.joinSpace({ userId: 'user-2', inviteCode: created.inviteCode });

    await localSpaceRepository.leaveSpace('user-2');
    expect(await localSpaceRepository.getSpaceForUser('user-2')).toBeNull();
    expect((await localSpaceRepository.getSpaceForUser('user-1'))?.partnerJoined).toBe(true);

    const code = await localSpaceRepository.regenerateInvite('user-1');
    expect(code).toBe(created.inviteCode);
  });
});

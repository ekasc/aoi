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
import { parsePartnerName, type PartnerName } from '@/features/space/partner-name';

beforeEach(() => {
  store.clear();
});

describe('local space repository partnership truth', () => {
  it('creates a waiting space with the partner named but nobody joined', async () => {
    const space = await localSpaceRepository.createSpace({
      name: 'Our Space',
      createdByUserId: 'user-1',
      yourName: 'Aoi',
      partnerName: parsePartnerName('June') as PartnerName,
    });

    // Named at create, waiting at create. The name is what every screen
    // addresses, so it cannot wait for the join; `partnerJoined` is the
    // separate, honest signal that nobody has arrived.
    expect(space.partnerName).toBe('June');
    expect(space.partnerJoined).toBe(false);
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
      yourName: 'June',
    });
    expect(joined.partnerJoined).toBe(true);
    // Each side reads the space from its own side of the pair: the joiner's
    // own name is theirs, and the person they joined is named as their
    // partner. One shared record would have made "partnerName" the joiner's
    // own name and left the creator unnamed.
    expect(joined.yourName).toBe('June');
    expect(joined.partnerName).toBe('Aoi');

    // The creator's copy flips too — no split-brain waiting state — and now
    // names the person who arrived.
    const creatorCopy = await localSpaceRepository.getSpaceForUser('user-1');
    expect(creatorCopy?.partnerJoined).toBe(true);
    expect(creatorCopy?.yourName).toBe('Aoi');
    expect(creatorCopy?.partnerName).toBe('June');
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

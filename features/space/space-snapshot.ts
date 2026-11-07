import AsyncStorage from '@react-native-async-storage/async-storage';

import type { RelationshipSpace } from '@/features/space/types';

/**
 * The last known space, per account, kept on the device.
 *
 * The space is what the whole app tree is built on, and reading it from the
 * network costs a round trip before anything can be drawn: measured at
 * 230–450ms on a good connection, and it fails often enough (a fast 503) that
 * waiting on it meant staring at a spinner or being thrown back to onboarding.
 *
 * So the space is written down whenever it is read or changed, and the next
 * launch renders from this copy immediately while the network reconciles in
 * the background. Missing reads retain known membership; only a confirmed
 * leave clears it. The server still authorizes every protected read and write.
 *
 * Keyed by account, so two people on one device never see each other's space.
 */
const KEY_PREFIX = 'aoi.space.snapshot.v1.';
const writes = new Map<string, Promise<void>>();

function storeSnapshot(userId: string, operation: () => Promise<void>): Promise<void> {
  const pending = (writes.get(userId) ?? Promise.resolve()).then(operation).catch(() => {});
  writes.set(userId, pending);
  void pending.then(() => {
    if (writes.get(userId) === pending) writes.delete(userId);
  });
  return pending;
}

function key(userId: string) {
  return `${KEY_PREFIX}${userId}`;
}

export async function readSpaceSnapshot(
  userId: string
): Promise<RelationshipSpace | null> {
  try {
    await writes.get(userId);
    const raw = await AsyncStorage.getItem(key(userId));
    if (!raw) {
      return null;
    }
    const parsed = JSON.parse(raw) as RelationshipSpace;
    // A snapshot without an id is not a space; treat damage as absence.
    return typeof parsed?.id === 'string' && parsed.id.length > 0 ? parsed : null;
  } catch {
    // Unreadable or corrupt: fall through to the network rather than crash.
    return null;
  }
}

export function writeSpaceSnapshot(
  userId: string,
  space: RelationshipSpace
): Promise<void> {
  return storeSnapshot(userId, () => AsyncStorage.setItem(key(userId), JSON.stringify(space)));
}

export function clearSpaceSnapshot(userId: string): Promise<void> {
  return storeSnapshot(userId, () => AsyncStorage.removeItem(key(userId)));
}

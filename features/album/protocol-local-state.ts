import AsyncStorage from '@react-native-async-storage/async-storage';

import {
  parseWireSpaceTrustAnchor,
  toWireSpaceTrustAnchor,
  type SpaceTrustAnchor,
} from '@aoi/shared';

import { fromBase64, toBase64 } from '@/features/album/crypto';

/**
 * The small amount of protocol state that must survive a restart.
 *
 * Three things, all local for the same reason: each is something the server
 * must not be able to change behind our back.
 *
 *   pinned anchor     which root this device trusts. A response offering a
 *                     different one is a new trust root, and a new trust root
 *                     from the server is precisely the attack.
 *   deletions         the highest tombstone revision this device has
 *                     *authenticated*, so a withheld tombstone cannot
 *                     resurrect a photo.
 *   recovery entropy  the phrase's bytes, kept so this device can authorise a
 *                     replacement. Losing it loses recovery, not the archive.
 */

const ANCHOR_PREFIX = 'aoi.album.anchor.v1.';
const DELETION_PREFIX = 'aoi.album.deletions.v1.';

async function readJson<T>(key: string): Promise<T | null> {
  const raw = await AsyncStorage.getItem(key);
  if (!raw) return null;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return null;
  }
}

// ── the pinned trust anchor ──────────────────────────────────────────────

export async function readPinnedAnchor(spaceId: string): Promise<SpaceTrustAnchor | null> {
  const stored = await readJson<unknown>(`${ANCHOR_PREFIX}${spaceId}`);
  if (stored === null) return null;
  try {
    return parseWireSpaceTrustAnchor(stored);
  } catch {
    // A corrupt pin is not a pin. Refusing is the safe direction: the caller
    // will not trust a root it cannot read.
    return null;
  }
}

export async function pinAnchor(spaceId: string, anchor: SpaceTrustAnchor): Promise<void> {
  await AsyncStorage.setItem(
    `${ANCHOR_PREFIX}${spaceId}`,
    JSON.stringify(toWireSpaceTrustAnchor(anchor))
  );
}

/** Is this anchor the one this device already pinned? */
export function anchorsMatch(left: SpaceTrustAnchor, right: SpaceTrustAnchor): boolean {
  return (
    JSON.stringify(toWireSpaceTrustAnchor(left)) === JSON.stringify(toWireSpaceTrustAnchor(right))
  );
}

// ── authenticated deletions ──────────────────────────────────────────────

export type DeletionState = Record<string, number>;

export async function readDeletionState(spaceId: string): Promise<DeletionState> {
  const stored = await readJson<unknown>(`${DELETION_PREFIX}${spaceId}`);
  if (!stored || typeof stored !== 'object' || Array.isArray(stored)) return {};
  const state: DeletionState = {};
  for (const [mediaId, revision] of Object.entries(stored as Record<string, unknown>)) {
    if (typeof revision === 'number' && Number.isInteger(revision) && revision > 0) {
      state[mediaId] = revision;
    }
  }
  return state;
}

/**
 * Record one *authenticated* deletion, and only ever upward.
 *
 * The revision written here has already been checked against a signature, so it
 * is the client's own knowledge rather than the server's claim. That is the
 * whole point: persisting a raw revision from a response would let a forged
 * candidate pin a photo as deleted forever.
 */
export async function recordAuthenticatedDeletion(
  spaceId: string,
  mediaId: string,
  revision: number
): Promise<void> {
  const state = await readDeletionState(spaceId);
  if ((state[mediaId] ?? 0) >= revision) return;
  state[mediaId] = revision;
  await AsyncStorage.setItem(`${DELETION_PREFIX}${spaceId}`, JSON.stringify(state));
}

// ── recovery entropy ─────────────────────────────────────────────────────

const RECOVERY_PREFIX = 'aoi.album.recovery.v1.';

/**
 * The phrase's bytes live in the platform keystore, not app data.
 *
 * Whoever holds them can read the archive and authorise devices, so they are a
 * secret of the same rank as a device's private key, and they get the same
 * storage. On web there is no keystore; that fallback exists because the browser
 * is a development preview and must never be the production path.
 *
 * The module is imported lazily so a client that never touches recovery never
 * loads a native module it has no use for.
 */
async function protectedStore(): Promise<{
  get: (key: string) => Promise<string | null>;
  set: (key: string, value: string) => Promise<void>;
  remove: (key: string) => Promise<void>;
}> {
  const { Platform } = await import('react-native');
  if (Platform.OS === 'web') {
    return {
      get: (key) => AsyncStorage.getItem(key),
      set: (key, value) => AsyncStorage.setItem(key, value),
      remove: (key) => AsyncStorage.removeItem(key),
    };
  }
  const SecureStore = await import('expo-secure-store');
  return {
    get: (key) => SecureStore.getItemAsync(key),
    set: (key, value) =>
      SecureStore.setItemAsync(key, value, {
        keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY,
      }),
    remove: (key) => SecureStore.deleteItemAsync(key),
  };
}

export async function readRecoveryEntropy(spaceId: string): Promise<Uint8Array | null> {
  const store = await protectedStore();
  const stored = await store.get(`${RECOVERY_PREFIX}${spaceId}`);
  return stored === null ? null : fromBase64(stored);
}

export async function writeRecoveryEntropy(spaceId: string, entropy: Uint8Array): Promise<void> {
  const store = await protectedStore();
  await store.set(`${RECOVERY_PREFIX}${spaceId}`, toBase64(entropy));
}

/** Leaving a Space, sign-out, account removal: nothing here belongs to anyone else. */
export async function clearProtocolLocalState(spaceId: string): Promise<void> {
  await AsyncStorage.multiRemove([
    `${ANCHOR_PREFIX}${spaceId}`,
    `${DELETION_PREFIX}${spaceId}`,
  ]);
  const store = await protectedStore();
  await store.remove(`${RECOVERY_PREFIX}${spaceId}`);
}

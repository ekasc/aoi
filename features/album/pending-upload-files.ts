import AsyncStorage from '@react-native-async-storage/async-storage';

import { fromBase64, toBase64 } from '@/features/album/crypto';

/**
 * Pending ciphertext, on web.
 *
 * The browser has no app-private file system, so the preview keeps the bytes in
 * the key-value store. That is a development-only path: a photo is megabytes,
 * and a base64 copy in AsyncStorage is both slow and over the platform's
 * per-entry limits, which is exactly why native uses a file.
 */
const PREFIX = 'aoi.album.pending.bytes.';

export async function writePendingBytes(id: string, bytes: Uint8Array): Promise<void> {
  await AsyncStorage.setItem(`${PREFIX}${id}`, toBase64(bytes));
}

export async function readPendingBytes(id: string): Promise<Uint8Array | null> {
  const raw = await AsyncStorage.getItem(`${PREFIX}${id}`);
  return raw === null ? null : fromBase64(raw);
}

export async function removePendingBytes(id: string): Promise<void> {
  await AsyncStorage.removeItem(`${PREFIX}${id}`);
}

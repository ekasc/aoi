import AsyncStorage from '@react-native-async-storage/async-storage';

import {
  parseWireMediaManifest,
  toWireMediaManifest,
  type MediaManifest,
  type WireMediaManifest,
} from '@aoi/shared';

import { fromBase64, toBase64 } from '@/features/album/crypto';

/**
 * Unfinished uploads, so an interruption is recoverable rather than lost.
 *
 * An entry holds the *sealed ciphertext* and the signed manifest, both already
 * built: the ciphertext's AAD binds the media id, and the manifest is what the
 * server will authenticate, so a resumed upload has to reuse the same pair.
 * Re-sealing would produce bytes under a different media key that the original
 * manifest could never describe.
 *
 * Nothing here is secret — the ciphertext is opaque and the manifest is public
 * — but it is still scoped by the same account+space key as the photo cache, so
 * leaving a Space does not leave another account's work behind.
 */

const PREFIX = 'aoi.album.pending.v1.';

export type PendingProtocolUpload = {
  mediaId: string;
  manifest: MediaManifest;
  ciphertext: Uint8Array;
  uri: string;
  width: number;
  height: number;
  createdAt: string;
};

type WirePending = {
  mediaId: string;
  manifest: WireMediaManifest;
  ciphertext: string;
  uri: string;
  width: number;
  height: number;
  createdAt: string;
};

export async function readPendingUploads(scopeKey: string): Promise<PendingProtocolUpload[]> {
  const raw = await AsyncStorage.getItem(`${PREFIX}${scopeKey}`);
  if (!raw) return [];
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    const entries: PendingProtocolUpload[] = [];
    for (const value of parsed as WirePending[]) {
      entries.push({
        mediaId: value.mediaId,
        manifest: parseWireMediaManifest(value.manifest),
        ciphertext: fromBase64(value.ciphertext),
        uri: value.uri,
        width: value.width,
        height: value.height,
        createdAt: value.createdAt,
      });
    }
    return entries;
  } catch {
    // A corrupt journal is not a pending upload. Dropping it costs a retry of
    // an upload we can no longer reconstruct anyway.
    return [];
  }
}

async function writeJournal(
  scopeKey: string,
  entries: readonly PendingProtocolUpload[]
): Promise<void> {
  const wire: WirePending[] = entries.map((entry) => ({
    mediaId: entry.mediaId,
    manifest: toWireMediaManifest(entry.manifest),
    ciphertext: toBase64(entry.ciphertext),
    uri: entry.uri,
    width: entry.width,
    height: entry.height,
    createdAt: entry.createdAt,
  }));
  await AsyncStorage.setItem(`${PREFIX}${scopeKey}`, JSON.stringify(wire));
}

export async function rememberPendingUpload(
  scopeKey: string,
  entry: PendingProtocolUpload
): Promise<void> {
  const entries = await readPendingUploads(scopeKey);
  await writeJournal(scopeKey, [...entries.filter((e) => e.mediaId !== entry.mediaId), entry]);
}

/** Only after the manifest published, or the upload was deliberately dropped. */
export async function forgetPendingUpload(scopeKey: string, mediaId: string): Promise<void> {
  const entries = await readPendingUploads(scopeKey);
  await writeJournal(
    scopeKey,
    entries.filter((entry) => entry.mediaId !== mediaId)
  );
}

export async function clearPendingUploads(scopeKey: string): Promise<void> {
  await AsyncStorage.removeItem(`${PREFIX}${scopeKey}`);
}

import AsyncStorage from '@react-native-async-storage/async-storage';

import {
  parseWireMediaManifest,
  toWireMediaManifest,
  type MediaManifest,
  type WireMediaManifest,
} from '@aoi/shared';

import {
  readPendingBytes,
  removePendingBytes,
  writePendingBytes,
} from '@/features/album/pending-upload-files';

/**
 * Unfinished uploads, so a termination is recoverable rather than lost.
 *
 * An entry holds the *sealed ciphertext* and the signed manifest, both already
 * built: the ciphertext's AAD binds the media id, and the manifest is what the
 * server will authenticate, so a resumed upload has to reuse the same pair.
 * Re-sealing would produce bytes under a different media key that the original
 * manifest could never describe.
 *
 * The metadata is small and lives in the key-value store; the ciphertext is
 * megabytes and lives in an app-private file, one per upload. The order matters:
 * the bytes are written first, because an entry pointing at bytes that are not
 * there is not resumable, and a journal that promises more than it can deliver
 * is worse than no journal at all.
 *
 * Nothing here is secret — the ciphertext is opaque and the manifest is public
 * — but it is scoped by the same account+space key as the photo cache, so
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

/** The metadata half. The bytes live in a file beside it. */
type WirePending = {
  mediaId: string;
  manifest: WireMediaManifest;
  uri: string;
  width: number;
  height: number;
  createdAt: string;
};

export async function readPendingUploads(scopeKey: string): Promise<PendingProtocolUpload[]> {
  const raw = await AsyncStorage.getItem(`${PREFIX}${scopeKey}`);
  if (!raw) return [];
  let metadata: WirePending[];
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    metadata = parsed as WirePending[];
  } catch {
    // A corrupt journal is not a pending upload. Dropping it costs a retry of
    // an upload we can no longer reconstruct anyway.
    return [];
  }

  const entries: PendingProtocolUpload[] = [];
  for (const value of metadata) {
    let manifest: MediaManifest;
    let ciphertext: Uint8Array | null;
    try {
      manifest = parseWireMediaManifest(value.manifest);
      ciphertext = await readPendingBytes(value.mediaId);
    } catch {
      continue;
    }
    if (!ciphertext) {
      // The metadata outlived its bytes. Not resumable, so it is not an entry.
      continue;
    }
    entries.push({
      mediaId: value.mediaId,
      manifest,
      ciphertext,
      uri: value.uri,
      width: value.width,
      height: value.height,
      createdAt: value.createdAt,
    });
  }
  return entries;
}

async function writeJournal(
  scopeKey: string,
  entries: readonly PendingProtocolUpload[]
): Promise<void> {
  const metadata: WirePending[] = entries.map((entry) => ({
    mediaId: entry.mediaId,
    manifest: toWireMediaManifest(entry.manifest),
    uri: entry.uri,
    width: entry.width,
    height: entry.height,
    createdAt: entry.createdAt,
  }));
  await AsyncStorage.setItem(`${PREFIX}${scopeKey}`, JSON.stringify(metadata));
}

export async function rememberPendingUpload(
  scopeKey: string,
  entry: PendingProtocolUpload
): Promise<void> {
  // Bytes first: see the note above on ordering.
  await writePendingBytes(entry.mediaId, entry.ciphertext);
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
  await removePendingBytes(mediaId);
}

export async function clearPendingUploads(scopeKey: string): Promise<void> {
  const entries = await readPendingUploads(scopeKey);
  await AsyncStorage.removeItem(`${PREFIX}${scopeKey}`);
  for (const entry of entries) {
    await removePendingBytes(entry.mediaId);
  }
}

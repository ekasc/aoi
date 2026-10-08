import {
  encodeMediaContext,
  parseWireMediaManifest,
  parseWireMediaTombstone,
  type DeviceRecord,
  type MediaManifest,
  type MediaTombstone,
  type SpaceTrustAnchor,
  type WireMediaManifest,
  type WireMediaTombstone,
} from '@aoi/shared';

import {
  openMediaCiphertext,
  unwrapMediaKey,
  verifyMediaManifest,
  verifyMediaTombstone,
} from '@/features/album/protocol-crypto';
import { verifyDeviceProvenance } from '@/features/album/protocol-trust';

/**
 * Reading one signed-media object, in the only order that is safe.
 *
 * This module is deliberately isolated: it is not wired into Us, Memories, the
 * Gallery, or the existing photo store, and it knows nothing about the network,
 * React, or storage. It takes the pieces a caller already has — a *trusted*
 * anchor, device records, manifest and tombstone candidates exactly as the
 * server returned them, the Space key, and the sealed bytes — and returns either
 * plaintext or a named refusal.
 *
 * The order is the contract, because each step assumes the one before it:
 *
 *   1. trust      the anchor is the caller's, never the server's
 *   2. manifest   parse, identity, uploader provenance, signature
 *   3. tombstones authenticate each candidate; apply only newer ones
 *   4. ciphertext exact length, unwrap, decrypt with the media context as AAD
 *   5. publication only verified, non-deleted media may be shown or cached
 *
 * Two things this deliberately does not do. It cannot detect omission: a server
 * that never mentions a media id is indistinguishable from one that never had
 * it, which is the documented v1 limitation. And it never decides trust from
 * anything the server sent — a fresh anchor in a response is data, not a root.
 */

export type ArchiveReadFailure =
  /** The manifest is not the canonical wire shape. */
  | 'unparseable-manifest'
  /** The manifest names a different media than the one asked for. */
  | 'wrong-media'
  /** The manifest belongs to another Space. */
  | 'wrong-space'
  /** The uploader's key does not descend from the anchor. */
  | 'untrusted-uploader'
  /** The uploader's signature over the canonical bytes did not verify. */
  | 'bad-manifest-signature'
  /** The ciphertext is not the length the manifest declares. */
  | 'bad-ciphertext-length'
  /** The wrapped media key did not open under this Space key. */
  | 'bad-wrapped-key'
  /** The ciphertext failed its authentication tag under the media key. */
  | 'ciphertext-rejected';

export type ArchiveReadResult =
  | { status: 'visible'; mediaId: string; manifest: MediaManifest; plaintext: Uint8Array }
  | { status: 'deleted'; mediaId: string; manifest: MediaManifest }
  | { status: 'rejected'; mediaId: string; reason: ArchiveReadFailure };

/** The device record a device is currently described by: highest revision wins. */
function highestRevisionRecord(
  records: readonly DeviceRecord[],
  deviceId: string
): DeviceRecord | null {
  let best: DeviceRecord | null = null;
  for (const record of records) {
    if (record.deviceId !== deviceId) continue;
    if (!best || record.revision > best.revision) best = record;
  }
  return best;
}

export type AuthenticateTombstonesInput = {
  anchor: SpaceTrustAnchor;
  records: readonly DeviceRecord[];
  /** Candidates exactly as the server returned them, in any order. */
  tombstones: readonly WireMediaTombstone[];
};

/**
 * The tombstone candidates that are genuinely authenticated.
 *
 * Each is judged alone: right Space, a signer whose key descends from the
 * anchor, and a valid signature over its own canonical bytes. A candidate that
 * fails any of those is discarded — including one carrying an enormous
 * revision, which is the cheapest forgery to attempt precisely because a
 * last-write-wins server would have honoured it.
 *
 * Provenance, not current authority, is the question here: a device that signed
 * a deletion and was later revoked still signed it. Rotation is what excludes a
 * removed device going forward; revocation does not rewrite what it authored.
 */
export function authenticateMediaTombstones(
  input: AuthenticateTombstonesInput
): MediaTombstone[] {
  const authenticated: MediaTombstone[] = [];
  for (const candidate of input.tombstones) {
    let tombstone: MediaTombstone;
    try {
      tombstone = parseWireMediaTombstone(candidate);
    } catch {
      continue;
    }
    if (tombstone.spaceId !== input.anchor.spaceId) continue;

    const provenance = verifyDeviceProvenance(
      tombstone.deletedByDeviceId,
      input.anchor,
      input.records
    );
    if (!provenance.trusted) continue;

    const signer = highestRevisionRecord(input.records, tombstone.deletedByDeviceId);
    if (!signer) continue;
    if (!verifyMediaTombstone(tombstone, signer.signingPublicKey)) continue;

    authenticated.push(tombstone);
  }
  return authenticated;
}

/**
 * Does an authenticated tombstone remove this manifest?
 *
 * Order-independent by construction: it asks whether *any* authenticated
 * tombstone names this media at a higher revision, so the answer cannot be
 * changed by how the server ordered its rows. A resurrection — an older
 * manifest served after a newer deletion — is a lower revision and fails here.
 */
export function isMediaDeleted(
  manifest: MediaManifest,
  authenticated: readonly MediaTombstone[]
): boolean {
  return authenticated.some(
    (tombstone) =>
      tombstone.mediaId === manifest.mediaId && tombstone.revision > manifest.revision
  );
}

export type ArchiveReadInput = {
  /** The anchor the caller already trusts — pinned, or recovery-authenticated. */
  anchor: SpaceTrustAnchor;
  /** Device records from the snapshot. */
  records: readonly DeviceRecord[];
  /** Tombstone candidates from the snapshot, in any order. */
  tombstones: readonly WireMediaTombstone[];
  /** The Space key for `generation`. */
  spaceKey: Uint8Array;
  /** The Space-key generation this archive is sealed under. */
  generation: number;
  /** The media the caller is reading, from its completed reservation. */
  mediaId: string;
  /** The manifest exactly as the server returned it. */
  manifest: WireMediaManifest;
  /** The sealed ciphertext exactly as the server returned it. */
  ciphertext: Uint8Array;
};

export function readArchiveMedia(input: ArchiveReadInput): ArchiveReadResult {
  // 2. The manifest: parse the exact wire schema, then identity, provenance and
  //    signature — in that order, so a caller learns which of them failed.
  let manifest: MediaManifest;
  try {
    manifest = parseWireMediaManifest(input.manifest);
  } catch {
    return { status: 'rejected', mediaId: input.mediaId, reason: 'unparseable-manifest' };
  }
  if (manifest.mediaId !== input.mediaId) {
    return { status: 'rejected', mediaId: input.mediaId, reason: 'wrong-media' };
  }
  if (manifest.spaceId !== input.anchor.spaceId) {
    return { status: 'rejected', mediaId: input.mediaId, reason: 'wrong-space' };
  }

  const uploader = highestRevisionRecord(input.records, manifest.uploaderDeviceId);
  if (!uploader) {
    return { status: 'rejected', mediaId: input.mediaId, reason: 'untrusted-uploader' };
  }
  if (
    !verifyDeviceProvenance(manifest.uploaderDeviceId, input.anchor, input.records).trusted
  ) {
    return { status: 'rejected', mediaId: input.mediaId, reason: 'untrusted-uploader' };
  }
  if (!verifyMediaManifest(manifest, uploader.signingPublicKey)) {
    return { status: 'rejected', mediaId: input.mediaId, reason: 'bad-manifest-signature' };
  }

  // 3. Deletion: authenticated candidates only, and only newer than the
  //    manifest. Nothing is decrypted for a photo that is not displayable.
  const authenticated = authenticateMediaTombstones({
    anchor: input.anchor,
    records: input.records,
    tombstones: input.tombstones,
  });
  if (isMediaDeleted(manifest, authenticated)) {
    return { status: 'deleted', mediaId: input.mediaId, manifest };
  }

  // 4. The ciphertext: exact length, then the wrapped key, then the payload.
  //    The context binds both to this media and this generation, so bytes moved
  //    from another record fail rather than decrypt to something wrong.
  if (input.ciphertext.length !== manifest.byteLength) {
    return { status: 'rejected', mediaId: input.mediaId, reason: 'bad-ciphertext-length' };
  }

  const context = encodeMediaContext({ mediaId: manifest.mediaId, generation: input.generation });

  let mediaKey: Uint8Array;
  try {
    mediaKey = unwrapMediaKey({
      spaceKey: input.spaceKey,
      wrapped: manifest.wrappedKey,
      context,
    });
  } catch {
    return { status: 'rejected', mediaId: input.mediaId, reason: 'bad-wrapped-key' };
  }

  let plaintext: Uint8Array;
  try {
    plaintext = openMediaCiphertext({
      mediaKey,
      sealed: { nonce: manifest.sealedNonce, ciphertext: input.ciphertext },
      context,
    });
  } catch {
    return { status: 'rejected', mediaId: input.mediaId, reason: 'ciphertext-rejected' };
  }

  // 5. Publication is the caller's act, and it only ever sees this.
  return { status: 'visible', mediaId: input.mediaId, manifest, plaintext };
}

/**
 * Exhaust the manifest pages before treating a set as the whole archive.
 *
 * A partial page is indistinguishable from a small archive, so a caller that
 * presents one as complete is claiming something it cannot know. This refuses
 * to terminate on a cursor that does not advance, and refuses to run past a
 * bound, rather than returning a set that looks finished.
 *
 * It still cannot detect omission: a server that never lists a media id is
 * indistinguishable from one that never had it. That is the documented v1
 * limitation and no client-side loop can close it.
 */
export async function collectMediaPages<T>(
  fetchPage: (cursor: string | null) => Promise<{ manifests: T[]; nextCursor: string | null }>,
  options: { maxPages?: number } = {}
): Promise<T[]> {
  const maxPages = options.maxPages ?? 200;
  const all: T[] = [];
  const seen = new Set<string>();
  let cursor: string | null = null;

  for (let page = 0; page < maxPages; page += 1) {
    const result = await fetchPage(cursor);
    all.push(...result.manifests);
    if (result.nextCursor === null) {
      return all;
    }
    if (seen.has(result.nextCursor)) {
      throw new Error('media pagination did not advance');
    }
    seen.add(result.nextCursor);
    cursor = result.nextCursor;
  }

  throw new Error('media pagination exceeded its page bound');
}

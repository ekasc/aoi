import { describe, expect, it } from 'vitest';

import type { MediaManifest } from '@aoi/shared';

import { archiveVisibility } from '@/features/album/archive-visibility';
import type { ArchiveReadResult } from '@/features/album/protocol-read';

function manifest(mediaId: string): MediaManifest {
  return {
    mediaId,
    spaceId: 'space-1',
    generation: 1,
    revision: 1,
    wrappedKey: { nonce: new Uint8Array(12), ciphertext: new Uint8Array(48) },
    sealedNonce: new Uint8Array(12),
    byteLength: 3,
    mimeType: 'image/jpeg',
    width: 100,
    height: 200,
    uploaderDeviceId: 'device-a',
    createdAt: '2026-01-01T00:00:00.000Z',
    signature: new Uint8Array(64),
  };
}

describe('what the plaintext cache may show', () => {
  it('shows only verified, non-deleted media', () => {
    const results: ArchiveReadResult[] = [
      { status: 'visible', mediaId: 'a', manifest: manifest('a'), plaintext: new Uint8Array([1]) },
      { status: 'deleted', mediaId: 'b', manifest: manifest('b') },
      { status: 'rejected', mediaId: 'c', reason: 'bad-manifest-signature' },
    ];
    const view = archiveVisibility({ results, cachedIds: [] });
    expect(view.visible.map((photo) => photo.mediaId)).toEqual(['a']);
  });

  it('evicts a cached file with no authenticated manifest behind it', () => {
    // The cache is an optimisation, never an authority: a leftover file from
    // before an authenticated deletion must not be displayable.
    const results: ArchiveReadResult[] = [
      { status: 'visible', mediaId: 'a', manifest: manifest('a'), plaintext: new Uint8Array([1]) },
      { status: 'deleted', mediaId: 'b', manifest: manifest('b') },
    ];
    const view = archiveVisibility({ results, cachedIds: ['a', 'b', 'stale'] });
    expect(view.visible.map((photo) => photo.mediaId)).toEqual(['a']);
    expect(view.evict).toEqual(['b', 'stale']);
  });

  it('shows nothing and evicts everything when nothing verifies', () => {
    const results: ArchiveReadResult[] = [
      { status: 'rejected', mediaId: 'a', reason: 'ciphertext-rejected' },
    ];
    const view = archiveVisibility({ results, cachedIds: ['a'] });
    expect(view.visible).toEqual([]);
    expect(view.evict).toEqual(['a']);
  });

  it('carries the authenticated manifest metadata through', () => {
    const results: ArchiveReadResult[] = [
      { status: 'visible', mediaId: 'a', manifest: manifest('a'), plaintext: new Uint8Array([1]) },
    ];
    const view = archiveVisibility({ results, cachedIds: ['a'] });
    expect(view.visible[0]).toEqual({
      mediaId: 'a',
      addedAt: '2026-01-01T00:00:00.000Z',
      width: 100,
      height: 200,
    });
    expect(view.evict).toEqual([]);
  });
});

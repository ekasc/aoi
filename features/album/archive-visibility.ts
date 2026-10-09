import type { ArchiveReadResult } from '@/features/album/protocol-read';

/**
 * What the plaintext cache is allowed to show.
 *
 * A decrypted file on disk is an optimisation, never an authority, and this is
 * the boundary that says so: the displayable set comes only from verified,
 * non-deleted results, and every cached file that is not in it is evicted. A
 * file left over from before an authenticated deletion — or written by an older
 * build, or by a bug with no manifest behind it — has no route to the screen,
 * because nothing here consults the file itself to decide visibility.
 *
 * The cache lives under one directory per Space, so a scope change (sign-out,
 * leaving the Space, account removal) purges exactly that directory. Nothing
 * else in the app's Documents tree belongs to it, and a purge must never reach
 * outside `ALBUM_CACHE_DIRECTORY`.
 */
export const ALBUM_CACHE_DIRECTORY = 'album-cache';

export type VisibleArchivePhoto = {
  mediaId: string;
  addedAt: string;
  width?: number;
  height?: number;
};

export type ArchiveVisibility = {
  /** What may be shown, in the order the manifests arrived. */
  visible: VisibleArchivePhoto[];
  /** Cached files that are no longer authenticated: evict these. */
  evict: string[];
};

export function archiveVisibility(input: {
  results: readonly ArchiveReadResult[];
  /** The decrypted files that currently exist on disk, by media id. */
  cachedIds: readonly string[];
}): ArchiveVisibility {
  const visible: VisibleArchivePhoto[] = [];
  for (const result of input.results) {
    if (result.status !== 'visible') continue;
    const { width, height } = result.manifest;
    visible.push({
      mediaId: result.mediaId,
      addedAt: result.manifest.createdAt,
      ...(width !== null && width !== undefined ? { width } : {}),
      ...(height !== null && height !== undefined ? { height } : {}),
    });
  }

  const visibleIds = new Set(visible.map((photo) => photo.mediaId));
  return {
    visible,
    evict: input.cachedIds.filter((id) => !visibleIds.has(id)),
  };
}

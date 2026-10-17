import { Asset } from 'expo-asset';

import seedPhoto from '@/assets/images/midnight-window.jpg';
import { sealAlbumMedia } from '@/features/album/album';
import { establishAlbumSession } from '@/features/album/album-session';
import { fromBase64, generateMediaKey } from '@/features/album/crypto';
import { readPhotoBytes } from '@/features/album/photo-bytes';

/**
 * Dev-only sky seed for `EXPO_PUBLIC_DEV_SEED`.
 *
 * The seeded app runs the REAL Us screen, which reads the encrypted album —
 * not the preview fixtures. So the mock world has to put photos INTO that
 * album, through the same session/seal/upload path the screen uses. Otherwise
 * the seeded Us screen honestly reports "No photos yet."
 *
 * Idempotent per install: it only seeds when the album is empty, so relaunches
 * do not pile up duplicates.
 */

const SEED_COUNT = 6;

/**
 * Put photos into the encrypted album through the real seal-and-upload path.
 *
 * `count` exists for stress fixtures: the Us screen reads this album, so a
 * seeded sky with six stars cannot exercise the star field. `force` skips the
 * empty-album check for the same reason.
 */
export async function seedDevSkyPhotos(
  spaceId: string,
  userId: string,
  count = SEED_COUNT,
  force = false,
): Promise<{ seeded: number; existing: number }> {
  const session = await establishAlbumSession({ userId, spaceId });
  if (session.status !== 'ready') {
    return { existing: 0, seeded: 0 };
  }

  const existing = await session.client.list();
  if (existing.length > 0 && !force) {
    return { existing: existing.length, seeded: 0 };
  }

  const asset = Asset.fromModule(seedPhoto);
  await asset.downloadAsync();
  const uri = asset.localUri ?? asset.uri;
  if (!uri) {
    return { existing: existing.length, seeded: 0 };
  }

  let bytes: Uint8Array;
  try {
    bytes = await readPhotoBytes(uri);
  } catch {
    return { existing: existing.length, seeded: 0 };
  }

  let seeded = 0;
  for (let index = 0; index < count; index += 1) {
    try {
      const media = sealAlbumMedia(
        session.spaceKey,
        bytes,
        {
          createdAt: new Date(Date.now() - index * 86_400_000).toISOString(),
          mimeType: 'image/jpeg',
          width: 1600,
          height: 1200,
        },
        generateMediaKey,
      );
      const intent = await session.client.createIntent({
        mimeType: 'image/jpeg',
        // The sealed ciphertext's own length: the reservation, the completion
        // check, and the stored metadata all mean this number.
        byteLength: media.byteLength,
        sealedNonce: media.sealed.nonce,
        wrappedKey: media.wrappedKey,
        width: 1600,
        height: 1200,
      });
      await session.client.putObject(intent, fromBase64(media.sealed.ciphertext));
      await session.client.complete(intent.mediaId);
      seeded += 1;
    } catch {
      // Best-effort: a failed fixture just means fewer stars.
    }
  }

  return { existing: existing.length, seeded };
}

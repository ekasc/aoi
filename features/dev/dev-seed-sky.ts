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

export async function seedDevSkyPhotos(spaceId: string, userId: string): Promise<void> {
  const session = await establishAlbumSession({ userId, spaceId });
  if (session.status !== 'ready') {
    return;
  }

  const existing = await session.client.list();
  if (existing.length > 0) {
    return;
  }

  const asset = Asset.fromModule(seedPhoto);
  await asset.downloadAsync();
  const uri = asset.localUri ?? asset.uri;
  if (!uri) {
    return;
  }

  let bytes: Uint8Array;
  try {
    bytes = await readPhotoBytes(uri);
  } catch {
    return;
  }

  for (let index = 0; index < SEED_COUNT; index += 1) {
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
    } catch {
      // Best-effort: a failed fixture just means fewer stars.
    }
  }
}

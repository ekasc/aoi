import { apiFetch } from '@/features/api-client';
import type { AlbumMedia, AlbumRepository, SpaceBackup } from '@/features/album/types';

/**
 * The album, on the server.
 *
 * The server is a dumb pipe with one job: hold blobs it cannot read, and give
 * them back when a device asks. It never sees a space key, a media key or a
 * photo, because each of those is wrapped before it gets here, and it cannot
 * mint a device the partner has not signed.
 *
 * The endpoints do not exist yet. The shape follows the rest of the API, so
 * the client is complete and the local repository keeps the feature working
 * end to end until the route ships. The routes a person can check:
 *
 *   GET    /v1/spaces/current/album/media
 *   POST   /v1/spaces/current/album/media
 *   DELETE /v1/spaces/current/album/media/:id
 *   GET    /v1/spaces/current/album/backup
 *   PUT    /v1/spaces/current/album/backup
 *
 * What the server stores, and can read, per photo: an opaque blob, an opaque
 * wrapped key, a timestamp, a byte length, a MIME type, and which of the two
 * of you it is tagged to. That last group is metadata, not secrecy, and it
 * is the real cost of putting this in the cloud at all.
 */

type MediaListResponse = { media: AlbumMedia[] };

export const remoteAlbumRepository: AlbumRepository = {
  async listMedia() {
    const response = await apiFetch<MediaListResponse>('/v1/spaces/current/album/media');
    return response.media;
  },

  async putMedia(media) {
    await apiFetch<AlbumMedia>('/v1/spaces/current/album/media', {
      method: 'POST',
      body: JSON.stringify(media),
    });
  },

  async deleteMedia(mediaId) {
    await apiFetch<void>(`/v1/spaces/current/album/media/${encodeURIComponent(mediaId)}`, {
      method: 'DELETE',
    });
  },

  async getBackup() {
    const response = await apiFetch<SpaceBackup | null>('/v1/spaces/current/album/backup');
    return response;
  },

  async putBackup(backup) {
    await apiFetch<SpaceBackup>('/v1/spaces/current/album/backup', {
      method: 'PUT',
      body: JSON.stringify(backup),
    });
  },
};

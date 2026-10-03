import * as MediaLibrary from 'expo-media-library/legacy';

import type { PhotoLibrary } from '@/features/album/automatic-album';

export const automaticPhotoLibrary: PhotoLibrary = {
  async permission(request) {
    const permission = request ? await MediaLibrary.requestPermissionsAsync(false, ['photo']) : await MediaLibrary.getPermissionsAsync(false, ['photo']);
    if (!permission.granted) return 'denied';
    return permission.accessPrivileges === 'limited' ? 'limited' : 'full';
  },
  async page(after, since) {
    // PhotoKit uses a strict > predicate. Include photos at midnight on the start date.
    const page = await MediaLibrary.getAssetsAsync({ first: 40, after, mediaType: ['photo'], sortBy: [['creationTime', false]], ...(since !== undefined ? { createdAfter: since - 1 } : {}) });
    return { photos: page.assets.map((asset) => ({ id: asset.id, version: String(asset.modificationTime) })), next: page.hasNextPage ? page.endCursor : null, total: page.totalCount };
  },
  async localUri(id) {
    // Do not pull an entire iCloud library over the network as a side-effect of setup.
    const info = await MediaLibrary.getAssetInfoAsync(id, { shouldDownloadFromNetwork: false });
    return info.localUri?.startsWith('file:') ? info.localUri : null;
  },
  subscribe(changed) { const subscription = MediaLibrary.addListener(changed); return () => subscription.remove(); },
};

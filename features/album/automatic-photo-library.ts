import type { PhotoLibrary } from '@/features/album/automatic-album';

export const automaticPhotoLibrary: PhotoLibrary = {
  permission: async () => 'denied',
  page: async () => ({ photos: [], next: null }),
  localUri: async () => null,
  subscribe: () => () => {},
};

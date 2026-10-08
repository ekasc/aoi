import { useMemo, useState } from 'react';

import { skyPhotoContentId, type SkyPhoto } from '@/features/album/sky-photo-repository';
import type { useSkyPhotos } from '@/features/album/use-sky-photos';
import type { PreviewVariant } from '@/features/dev/preview';
import { previewImages } from '@/features/dev/preview-media';

export function usePreviewSkyPhotos(variant: PreviewVariant): ReturnType<typeof useSkyPhotos> {
  const fixtures = useMemo<SkyPhoto[]>(() => {
    const today = new Date();
    const images = Object.values(previewImages);
    return Array.from({ length: 80 }, (_, index) => ({
      id: skyPhotoContentId(new TextEncoder().encode(`preview-photo-${index}`)),
      addedAt: new Date(today.getFullYear(), today.getMonth() - 30 + Math.floor(index / 3), 15).toISOString(),
      uri: images[index % images.length].uri,
      width: 1600,
      height: 1200,
    }));
  }, []);
  const [photos, setPhotos] = useState(() => {
    if (variant === 'empty' || variant === 'sky-empty') return [];
    if (variant === 'sky-one') return fixtures.slice(0, 1);
    if (variant === 'sky-few') return fixtures.slice(0, 5);
    if (variant === 'sky-many') return Array.from({ length: 500 }, (_, index) => ({
      ...fixtures[index % fixtures.length],
      id: skyPhotoContentId(new TextEncoder().encode(`preview-photo-${index}`)),
    }));
    return fixtures;
  });
  return {
    photos,
    scopeKey: 'preview-sky',
    status: variant === 'pending' ? 'loading' : variant === 'failed' ? 'failed' : 'ready',
    readError: variant === 'failed' ? 'Could not open your local photos. Please try again.' : null,
    actionError: null,
    operation: null,
    protocolStatus: 'none' as const,
    reload: () => {},
    choosePhotos: async () => { setPhotos(fixtures); },
    removePhoto: async (id) => { setPhotos((current) => current.filter((photo) => photo.id !== id)); },
  };
}

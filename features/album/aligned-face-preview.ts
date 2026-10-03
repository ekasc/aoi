import type { DetectedPhotoFace } from '@/features/album/photo-face-detector';

export async function alignedFacePreview(_uri: string, _face: DetectedPhotoFace): Promise<string> {
  throw new Error('Aligned previews require an iOS dev build.');
}

import type { FacePipeline } from '@/features/album/face-pipeline';
import type { DetectedPhotoFace } from '@/features/album/photo-face-detector';

export type PhotoCheck =
  | { kind: 'ready'; detected: number; crops: { face: number; uri: string | null }[] }
  | { kind: 'failed'; message: string }
  | { kind: 'cancelled' };

export async function checkPhotoCrops({ engine, uri, signal, preview }: {
  engine: Pick<FacePipeline<DetectedPhotoFace>, 'isAvailable' | 'detect'>;
  uri: string; signal: AbortSignal; preview: (uri: string, face: DetectedPhotoFace) => Promise<string>;
}): Promise<PhotoCheck> {
  if (signal.aborted) return { kind: 'cancelled' };
  try {
    if (!await engine.isAvailable()) return { kind: 'failed', message: 'Photo checking is unavailable in this build.' };
    if (signal.aborted) return { kind: 'cancelled' };
    const faces = await engine.detect(uri);
    const crops: { face: number; uri: string | null }[] = [];
    for (const [index, face] of faces.slice(0, 8).entries()) {
      if (signal.aborted) return { kind: 'cancelled' };
      let crop: string | null = null;
      try { crop = await preview(uri, face); } catch { /* A missing crop must remain visible beside the detected face. */ }
      crops.push({ face: index + 1, uri: crop });
    }
    return signal.aborted ? { kind: 'cancelled' } : { kind: 'ready', detected: faces.length, crops };
  } catch {
    return signal.aborted ? { kind: 'cancelled' } : { kind: 'failed', message: 'Could not read this photo. Try choosing it again.' };
  }
}

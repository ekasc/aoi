import { fitFaceAlignment } from '@/features/album/face-alignment';
import type { FacePipeline } from '@/features/album/face-pipeline';
import type { DetectedPhotoFace } from '@/features/album/photo-face-detector';

export type PhotoDiagnosis =
  | { kind: 'failed'; stage: 'availability' | 'detection' }
  | { kind: 'cancelled' }
  | { kind: 'analyzed'; detected: number; faces: { face: number; width: number; height: number; rollAngle: number | null; alignmentUsable: boolean }[] };

/** Geometry only. No identity comparison, photo identifiers or biometric vectors. */
export async function diagnosePhotoFaces(engine: FacePipeline<DetectedPhotoFace>, uri: string, signal: AbortSignal): Promise<PhotoDiagnosis> {
  if (signal.aborted) return { kind: 'cancelled' };
  try {
    if (!await engine.isAvailable()) return { kind: 'failed', stage: 'availability' };
  } catch { return { kind: 'failed', stage: 'availability' }; }
  if (signal.aborted) return { kind: 'cancelled' };
  let faces: DetectedPhotoFace[];
  try { faces = await engine.detect(uri); }
  catch { return { kind: 'failed', stage: 'detection' }; }
  if (signal.aborted) return { kind: 'cancelled' };
  return { kind: 'analyzed', detected: faces.length, faces: faces.map((face, index) => ({
    face: index + 1, width: face.width, height: face.height, rollAngle: face.rollAngle,
    alignmentUsable: face.landmarks !== null && fitFaceAlignment(face.landmarks) !== null,
  })) };
}

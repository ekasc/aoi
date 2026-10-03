import type { FaceBox } from '@/features/album/face-pipeline';
import { fiveFaceLandmarks, parseFaceLandmarkRegions, type FiveFaceLandmarks } from '@/features/album/face-landmarks';

export type DetectedPhotoFace = FaceBox & { landmarks: FiveFaceLandmarks | null; captureQuality?: number };

export type DetectedPhotoFaces = {
  /** Coordinates use the full-resolution image after applying EXIF orientation. */
  width: number;
  height: number;
  faces: DetectedPhotoFace[];
};

export type NativePhotoFaceDetector = { detect: (uri: string) => Promise<unknown> };

export function parseDetectedPhotoFaces(value: unknown): DetectedPhotoFaces {
  if (!value || typeof value !== 'object' || !('width' in value) || !('height' in value) || !('faces' in value)
    || typeof value.width !== 'number' || !Number.isFinite(value.width) || value.width <= 0
    || typeof value.height !== 'number' || !Number.isFinite(value.height) || value.height <= 0
    || !Array.isArray(value.faces)) throw new Error('Invalid face detection result');
  const { width, height } = value;
  const faces = value.faces.map((face: unknown): DetectedPhotoFace => {
    if (!face || typeof face !== 'object' || !('x' in face) || !('y' in face) || !('width' in face) || !('height' in face) || !('rollAngle' in face)
      || typeof face.x !== 'number' || !Number.isFinite(face.x) || face.x < 0
      || typeof face.y !== 'number' || !Number.isFinite(face.y) || face.y < 0
      || typeof face.width !== 'number' || !Number.isFinite(face.width) || face.width <= 0
      || typeof face.height !== 'number' || !Number.isFinite(face.height) || face.height <= 0
      || face.x + face.width > width + 0.001 || face.y + face.height > height + 0.001
      || (face.rollAngle !== null && (typeof face.rollAngle !== 'number' || !Number.isFinite(face.rollAngle)))) {
      throw new Error('Invalid face detection result');
    }
    // Older binaries can still locate boxes, but cannot supply alignment landmarks.
    const regions = parseFaceLandmarkRegions('landmarkRegions' in face ? face.landmarkRegions : null, width, height);
    const quality: unknown = 'captureQuality' in face ? face.captureQuality : null;
    if (quality !== null && (typeof quality !== 'number' || !Number.isFinite(quality) || quality < 0 || quality > 1)) throw new Error('Invalid reference quality');
    return { x: face.x, y: face.y, width: face.width, height: face.height, rollAngle: face.rollAngle, landmarks: regions ? fiveFaceLandmarks(regions) : null, ...(typeof quality === 'number' ? { captureQuality: quality } : {}) };
  });
  return { width, height, faces };
}

export function createPhotoFaceDetector(native: NativePhotoFaceDetector | null) {
  return {
    isAvailable: () => native !== null,
    async detect(uri: string): Promise<DetectedPhotoFaces> {
      if (!native) throw new Error('On-device face detection is unavailable in this build');
      let url: URL;
      try { url = new URL(uri); } catch { throw new Error('Face detection requires a local photo file'); }
      if (url.protocol !== 'file:' || (url.hostname !== '' && url.hostname !== 'localhost') || url.search || url.hash) {
        throw new Error('Face detection requires a local photo file');
      }
      try {
        return parseDetectedPhotoFaces(await native.detect(uri));
      } catch {
        // Native failures can contain private paths. Never expose their text to callers.
        throw new Error('Could not detect faces in this local photo');
      }
    },
  };
}

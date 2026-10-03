import { createFaceRecognitionEngine } from '@/features/album/face-recognition-engine';

export function createLocalFaceRecognition() {
  return createFaceRecognitionEngine(null);
}

import { fitFaceAlignment, SFACE_SIZE, type FaceTransform } from '@/features/album/face-alignment';
import { matchByCosine, type FacePipeline } from '@/features/album/face-pipeline';
import type { DetectedPhotoFace, DetectedPhotoFaces } from '@/features/album/photo-face-detector';
import model from '@/features/album/sface-model.json';

export const SFACE_MODEL_ID = `${model.id}:${model.sha256}:vision-contours-v1:aligned-rgb112-v1`;
export const SFACE_EMBEDDING_SIZE = 128;
export const FACE_DETECTION_POLICY_VERSION = 'vision-rev3-fallback-v1';

export type SFaceSession = {
  embed: (input: Float32Array) => Promise<unknown>;
  release: () => Promise<void>;
};

export type RecognitionDependencies = {
  detect: (uri: string) => Promise<DetectedPhotoFaces>;
  prepare: (uri: string, transform: FaceTransform) => Promise<unknown>;
  loadSession: () => Promise<SFaceSession>;
};

export function parseFacePixels(value: unknown): Float32Array {
  if (!Array.isArray(value) || value.length !== SFACE_SIZE * SFACE_SIZE * 3
    || !value.every((pixel: unknown) => typeof pixel === 'number' && Number.isFinite(pixel) && pixel >= 0 && pixel <= 255)) {
    throw new Error('Invalid aligned face pixels');
  }
  return Float32Array.from(value);
}

export function normalizeFaceEmbedding(value: unknown): Float32Array {
  if (!(value instanceof Float32Array) || value.length !== SFACE_EMBEDDING_SIZE || !value.every(Number.isFinite)) {
    throw new Error('Invalid face model output');
  }
  const norm = Math.hypot(...value);
  if (norm === 0 || !Number.isFinite(norm)) throw new Error('Invalid face model output');
  return Float32Array.from(value, (number) => number / norm);
}

export function flipAlignedFacePixels(pixels: Float32Array): Float32Array {
  const plane = SFACE_SIZE * SFACE_SIZE;
  if (pixels.length !== plane * 3) throw new Error('Invalid aligned face pixels');
  const flipped = new Float32Array(pixels.length);
  for (let channel = 0; channel < 3; channel++) {
    for (let y = 0; y < SFACE_SIZE; y++) {
      for (let x = 0; x < SFACE_SIZE; x++) {
        flipped[channel * plane + y * SFACE_SIZE + x] = pixels[channel * plane + y * SFACE_SIZE + SFACE_SIZE - 1 - x];
      }
    }
  }
  return flipped;
}

export function fuseFaceEmbeddings(original: unknown, mirrored: unknown): Float32Array {
  if (!(original instanceof Float32Array) || !(mirrored instanceof Float32Array)) throw new Error('Invalid face model output');
  normalizeFaceEmbedding(original).fill(0);
  normalizeFaceEmbedding(mirrored).fill(0);
  const combined = Float32Array.from(original, (value, index) => value + mirrored[index]);
  try { return normalizeFaceEmbedding(combined); }
  finally { combined.fill(0); }
}

/** Caller owns this engine and must dispose it after a scan/enrollment session. */
export function createFaceRecognitionEngine(dependencies: RecognitionDependencies | null, { queryFlipFusion = false }: { queryFlipFusion?: boolean } = {}): FacePipeline<DetectedPhotoFace> & {
  modelId: string;
  dispose: () => Promise<void>;
} {
  let session: SFaceSession | null = null;
  let closed = false;
  let queue: Promise<unknown> = Promise.resolve();
  let disposal: Promise<void> | null = null;
  const run = <T,>(task: () => Promise<T>): Promise<T> => {
    const job = queue.catch(() => {}).then(async () => {
      if (closed) throw new Error('Face recognition session is closed');
      const value = await task();
      if (closed) throw new Error('Face recognition session is closed');
      return value;
    });
    queue = job;
    return job;
  };
  const getSession = async () => {
    if (!dependencies) throw new Error('Face recognition is unavailable in this build');
    if (!session) session = await dependencies.loadSession();
    return session;
  };
  const embedFace = (uri: string, face: DetectedPhotoFace, flip: boolean) => run(async () => {
    if (!dependencies) throw new Error('Face recognition is unavailable in this build');
    if (!face.landmarks) throw new Error('This face has no usable alignment landmarks');
    const transform = fitFaceAlignment(face.landmarks);
    if (!transform) throw new Error('This face has no usable alignment landmarks');
    const active = await getSession();
    if (closed) throw new Error('Face recognition session is closed');
    const pixels = parseFacePixels(await dependencies.prepare(uri, transform));
    const mirroredPixels = flip ? flipAlignedFacePixels(pixels) : null;
    let original: unknown, mirrored: unknown;
    try {
      if (closed) throw new Error('Face recognition session is closed');
      original = await active.embed(pixels);
      if (closed) throw new Error('Face recognition session is closed');
      if (!mirroredPixels) return normalizeFaceEmbedding(original);
      mirrored = await active.embed(mirroredPixels);
      if (closed) throw new Error('Face recognition session is closed');
      return fuseFaceEmbeddings(original, mirrored);
    } finally {
      pixels.fill(0); mirroredPixels?.fill(0);
      if (original instanceof Float32Array) original.fill(0);
      if (mirrored instanceof Float32Array) mirrored.fill(0);
    }
  });
  return {
    modelId: SFACE_MODEL_ID,
    isAvailable: () => run(async () => {
      if (!dependencies) return false;
      await getSession();
      return !closed;
    }),
    detect: (uri) => run(async () => {
      if (!dependencies) throw new Error('Face recognition is unavailable in this build');
      return (await dependencies.detect(uri)).faces;
    }),
    embed: (uri, face) => embedFace(uri, face, false),
    embedQuery: (uri, face) => embedFace(uri, face, queryFlipFusion),
    match: matchByCosine,
    dispose: () => {
      closed = true;
      if (!disposal) {
        disposal = queue.catch(() => {}).then(async () => {
          const active = session;
          session = null;
          await active?.release();
        });
      }
      return disposal;
    },
  };
}

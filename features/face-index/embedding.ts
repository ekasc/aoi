import type { IndexedFace } from '@/features/face-index/types';

/** SFace emits 128 dimensions. The spike is dimension-agnostic but defaults here. */
export const EMBEDDING_DIMENSIONS = 128;

/**
 * Below this squared norm a vector is treated as zero. Float32 components make
 * an exact `=== 0` check too weak; a vector of 1e-200s would otherwise normalize
 * into noise.
 */
const MIN_SQUARED_NORM = 1e-12;

/**
 * Validate and unit-normalize an embedding.
 *
 * Returns a fresh vector, or null for anything that is not a finite
 * `dimensions`-length Float32Array with a non-zero norm. Rejection is an
 * explicit null rather than a throw so one bad detector output cannot abort a
 * whole library scan.
 */
export function normalizeEmbedding(value: unknown, dimensions = EMBEDDING_DIMENSIONS): Float32Array | null {
  if (!Number.isInteger(dimensions) || dimensions <= 0) return null;
  if (!(value instanceof Float32Array) || value.length !== dimensions) return null;
  let squaredNorm = 0;
  for (let index = 0; index < value.length; index += 1) {
    const component = value[index];
    if (!Number.isFinite(component)) return null;
    squaredNorm += component * component;
  }
  if (!Number.isFinite(squaredNorm) || squaredNorm <= MIN_SQUARED_NORM) return null;
  const scale = 1 / Math.sqrt(squaredNorm);
  return Float32Array.from(value, (component) => component * scale);
}

/**
 * The one constructor the index trusts. Returns null instead of throwing so a
 * malformed detector output is rejected, not propagated.
 */
export function createIndexedFace(input: {
  faceId: string;
  assetId: string;
  embedding: unknown;
  detectionScore: number;
  qualityScore?: number;
  landmarks?: readonly { x: number; y: number }[];
}): IndexedFace | null {
  if (typeof input.faceId !== 'string' || !input.faceId || typeof input.assetId !== 'string' || !input.assetId) return null;
  if (!Number.isFinite(input.detectionScore) || input.detectionScore < 0 || input.detectionScore > 1) return null;
  if (input.qualityScore !== undefined && (!Number.isFinite(input.qualityScore) || input.qualityScore < 0 || input.qualityScore > 1)) return null;
  const embedding = normalizeEmbedding(input.embedding);
  if (!embedding) return null;
  return {
    faceId: input.faceId,
    assetId: input.assetId,
    embedding,
    detectionScore: input.detectionScore,
    ...(input.qualityScore === undefined ? {} : { qualityScore: input.qualityScore }),
    ...(input.landmarks === undefined ? {} : { landmarks: input.landmarks }),
  };
}

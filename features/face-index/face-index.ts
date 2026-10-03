import { normalizeEmbedding } from '@/features/face-index/embedding';
import type { IndexedFace } from '@/features/face-index/types';

/**
 * A local, in-memory face index.
 *
 * One asset may hold many faces. The index is scoped to a recognition model
 * identity (weights hash + alignment + preprocessing versions). Changing the
 * model clears the index rather than letting embeddings from two models be
 * compared: two models' vectors are not in the same space, and silently
 * mixing them is how a cluster quietly becomes wrong.
 *
 * This spike keeps the index in memory. Persistence is deliberately out of
 * scope; `modelId` is the key a future store must partition on.
 */
export type FaceIndex = {
  readonly modelId: string;
  /** Returns false when the face is malformed. The face never enters the index. */
  add: (face: IndexedFace) => boolean;
  facesForAsset: (assetId: string) => readonly IndexedFace[];
  allFaces: () => readonly IndexedFace[];
  size: () => number;
  rejectedCount: () => number;
  modelMatches: (modelId: string) => boolean;
  /** Clears the index when the model differs. Returns whether a clear happened. */
  resetForModel: (modelId: string) => boolean;
};

export function createFaceIndex(modelId: string): FaceIndex {
  if (typeof modelId !== 'string' || !modelId) throw new Error('A face index requires a model identity');
  let activeModel = modelId;
  const byFaceId = new Map<string, IndexedFace>();
  const byAssetId = new Map<string, IndexedFace[]>();
  let rejected = 0;

  return {
    get modelId() {
      return activeModel;
    },
    add(face) {
      if (!face || typeof face.faceId !== 'string' || !face.faceId || byFaceId.has(face.faceId)) {
        rejected += 1;
        return false;
      }
      const embedding = normalizeEmbedding(face.embedding);
      if (!embedding || !Number.isFinite(face.detectionScore) || typeof face.assetId !== 'string' || !face.assetId) {
        rejected += 1;
        return false;
      }
      const stored: IndexedFace = { ...face, embedding };
      byFaceId.set(stored.faceId, stored);
      const assetFaces = byAssetId.get(stored.assetId);
      if (assetFaces) assetFaces.push(stored);
      else byAssetId.set(stored.assetId, [stored]);
      return true;
    },
    facesForAsset: (assetId) => byAssetId.get(assetId) ?? [],
    allFaces: () => [...byFaceId.values()],
    size: () => byFaceId.size,
    rejectedCount: () => rejected,
    modelMatches: (candidate) => candidate === activeModel,
    resetForModel(candidate) {
      if (candidate === activeModel) return false;
      activeModel = candidate;
      byFaceId.clear();
      byAssetId.clear();
      rejected = 0;
      return true;
    },
  };
}

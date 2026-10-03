import { cosineSimilarity } from '@/features/album/face-pipeline';

import { normalizeEmbedding } from '@/features/face-index/embedding';
import type { ClusterAssignment, FaceCluster, IndexedFace } from '@/features/face-index/types';

/**
 * Incremental nearest-neighbour clustering over face embeddings.
 *
 * This is the smallest thing that can turn a bag of embeddings into anonymous
 * identities. It assigns one face at a time to the most similar existing
 * cluster, or starts a new one. No names, no people, no partner logic.
 *
 * Conservative by construction:
 * - a face below `qualityFloor` only joins at `lowQualityThreshold`
 * - chained faces can link two identities when every adjacent pair clears the
 *   cutoff, so the cutoff is a safety parameter, not a knob
 * - faces are processed in sorted id order, so the same input always produces
 *   the same clusters
 * - a rejection is remembered, so a face removed from a cluster cannot
 *   immediately rejoin it
 *
 * The defaults are uncalibrated placeholders. They belong to this spike and no
 * production code may read them.
 */
export type ClustererOptions = {
  /** Minimum centroid cosine for a face with acceptable quality. */
  similarityThreshold: number;
  /** Stricter minimum for faces below `qualityFloor`. */
  lowQualityThreshold: number;
  /** Quality at or above which `similarityThreshold` applies. */
  qualityFloor: number;
};

export const SPIKE_CLUSTER_OPTIONS: ClustererOptions = {
  similarityThreshold: 0.55,
  lowQualityThreshold: 0.72,
  qualityFloor: 0.5,
};

export function validateClustererOptions(options: ClustererOptions): ClustererOptions {
  const values = [options.similarityThreshold, options.lowQualityThreshold, options.qualityFloor];
  if (!values.every((value) => Number.isFinite(value) && value >= 0 && value <= 1)) {
    throw new RangeError('Clusterer thresholds must be finite numbers between zero and one');
  }
  if (options.lowQualityThreshold < options.similarityThreshold) {
    throw new RangeError('The low-quality threshold must not be more permissive than the standard threshold');
  }
  return options;
}

export type FaceClusterer = {
  readonly options: ClustererOptions;
  /** Returns null for a malformed embedding. The face is never clustered. */
  assign: (face: IndexedFace) => ClusterAssignment | null;
  /** Read-only nearest cluster for a query face. Never adds or mutates a cluster. */
  classify: (face: IndexedFace) => Omit<ClusterAssignment, 'assetId'> | null;
  /** Remember a rejection and detach the face if it currently sits in that cluster. */
  reject: (faceId: string, clusterId: string) => void;
  rejectionsFor: (faceId: string) => readonly string[];
  clusters: () => readonly FaceCluster[];
  assignmentFor: (faceId: string) => ClusterAssignment | undefined;
  assignments: () => readonly ClusterAssignment[];
};

type MutableCluster = { clusterId: string; faceIds: string[]; sum: Float32Array };

export function createFaceClusterer(options: ClustererOptions = SPIKE_CLUSTER_OPTIONS): FaceClusterer {
  validateClustererOptions(options);
  const clusters: MutableCluster[] = [];
  const byClusterId = new Map<string, MutableCluster>();
  const assignments = new Map<string, ClusterAssignment>();
  const embeddings = new Map<string, Float32Array>();
  const rejections = new Map<string, Set<string>>();

  const detach = (faceId: string) => {
    const assignment = assignments.get(faceId);
    if (!assignment) return;
    const cluster = byClusterId.get(assignment.clusterId);
    assignments.delete(faceId);
    if (!cluster) return;
    const memberIndex = cluster.faceIds.indexOf(faceId);
    if (memberIndex === -1) return;
    const embedding = embeddings.get(faceId);
    cluster.faceIds.splice(memberIndex, 1);
    if (embedding) {
      for (let index = 0; index < cluster.sum.length; index += 1) cluster.sum[index] -= embedding[index];
    }
    if (!cluster.faceIds.length) {
      byClusterId.delete(cluster.clusterId);
      const clusterIndex = clusters.indexOf(cluster);
      if (clusterIndex !== -1) clusters.splice(clusterIndex, 1);
    }
  };

  const nearest = (faceId: string, embedding: Float32Array, quality: number): { cluster: MutableCluster; similarity: number } | null => {
    const threshold = quality >= options.qualityFloor ? options.similarityThreshold : options.lowQualityThreshold;
    const rejected = rejections.get(faceId);
    let best: { cluster: MutableCluster; similarity: number } | null = null;
    for (const cluster of clusters) {
      if (rejected?.has(cluster.clusterId)) continue;
      const similarity = cosineSimilarity(embedding, cluster.sum);
      if (similarity >= threshold && (!best || similarity > best.similarity)) best = { cluster, similarity };
    }
    return best;
  };

  return {
    options,
    assign(face) {
      const existing = assignments.get(face.faceId);
      if (existing) return existing;
      const embedding = normalizeEmbedding(face.embedding);
      if (!embedding) return null;
      const quality = face.qualityScore ?? 1;
      const best = nearest(face.faceId, embedding, quality);

      let cluster: MutableCluster;
      let similarity: number;
      if (best) {
        cluster = best.cluster;
        similarity = best.similarity;
      } else {
        cluster = { clusterId: `cluster-${clusters.length}`, faceIds: [], sum: new Float32Array(embedding.length) };
        clusters.push(cluster);
        byClusterId.set(cluster.clusterId, cluster);
        similarity = 1;
      }
      cluster.faceIds.push(face.faceId);
      for (let index = 0; index < cluster.sum.length; index += 1) cluster.sum[index] += embedding[index];
      embeddings.set(face.faceId, embedding);
      const assignment: ClusterAssignment = { faceId: face.faceId, assetId: face.assetId, clusterId: cluster.clusterId, similarity, qualityScore: quality };
      assignments.set(face.faceId, assignment);
      return assignment;
    },
    classify(face) {
      const embedding = normalizeEmbedding(face.embedding);
      if (!embedding) return null;
      const quality = face.qualityScore ?? 1;
      const best = nearest(face.faceId, embedding, quality);
      return best ? { faceId: face.faceId, clusterId: best.cluster.clusterId, similarity: best.similarity, qualityScore: quality } : null;
    },
    reject(faceId, clusterId) {
      let rejected = rejections.get(faceId);
      if (!rejected) {
        rejected = new Set();
        rejections.set(faceId, rejected);
      }
      rejected.add(clusterId);
      if (assignments.get(faceId)?.clusterId === clusterId) detach(faceId);
    },
    rejectionsFor: (faceId) => [...(rejections.get(faceId) ?? [])],
    clusters: () => clusters.map((cluster) => ({
      clusterId: cluster.clusterId,
      faceIds: [...cluster.faceIds],
      centroid: Float32Array.from(cluster.sum, (value) => value / Math.max(cluster.faceIds.length, 1)),
      memberEmbeddings: cluster.faceIds.flatMap((faceId) => { const embedding = embeddings.get(faceId); return embedding ? [embedding] : []; }),
      size: cluster.faceIds.length,
    })),
    assignmentFor: (faceId) => assignments.get(faceId),
    assignments: () => [...assignments.values()],
  };
}

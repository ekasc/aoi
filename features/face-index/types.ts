/**
 * Experimental face-index/clustering spike.
 *
 * This directory is deliberately separate from `features/album`. It must stay
 * removable: delete the folder, its tests, and `scripts/evaluate-face-index.mjs`
 * to take recognition back to the current fixed-reference pipeline.
 *
 * The spike answers one question: does indexing every detected face and
 * clustering those embeddings into identities recognise couple photos better
 * than comparing every face against one enrolled reference per person?
 *
 * Nothing here knows about "you" or "partner" until `identify.ts`. The
 * clustering layer only produces anonymous identities.
 */

/** A single point on the source image, in oriented pixel coordinates. */
export type FacePoint = { x: number; y: number };

/**
 * One detected face, after embedding, ready to be indexed.
 *
 * `embedding` is always a normalized Float32Array. Construct faces through
 * `createIndexedFace` so malformed, NaN, or zero vectors never enter the index.
 * `faceId` and `assetId` are device-local identifiers; neither is a source URI
 * and neither leaves the device.
 */
export type IndexedFace = {
  faceId: string;
  assetId: string;
  embedding: Float32Array;
  /** Detector confidence in [0, 1]. Distinct from identity confidence. */
  detectionScore: number;
  /** Optional capture-quality estimate in [0, 1]. Drives conservative merging. */
  qualityScore?: number;
  landmarks?: readonly FacePoint[];
};

/** An anonymous identity, built only from local observations. Never named. */
export type FaceCluster = {
  clusterId: string;
  faceIds: readonly string[];
  /** Mean of member embeddings, unnormalized; cosine normalizes at use. */
  centroid: Float32Array;
  size: number;
};

/** Why a face belongs to a cluster. `similarity` is to the cluster centroid. */
export type ClusterAssignment = {
  faceId: string;
  assetId: string;
  clusterId: string;
  similarity: number;
  qualityScore: number;
};

/** Which anonymous cluster (if any) an enrolled person was identified as. */
export type PartnerLabel = 'A' | 'B';

export type ClusterIdentity = {
  clusterId: string;
  person: PartnerLabel;
  score: number;
  margin: number;
};

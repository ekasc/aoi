import type { ClusterAssignment, IndexedFace, PartnerLabel } from '@/features/face-index/types';

/**
 * The couple-photo query.
 *
 * An asset qualifies when at least one face belongs confidently to A and a
 * different face belongs confidently to B. Group photos qualify. One face can
 * only belong to one cluster, and one cluster to one person, so an ambiguous
 * face can never establish both partners.
 *
 * The result is a diagnostic, not a boolean: every detected face, its cluster,
 * and why the asset was accepted or rejected.
 */
export type FaceEvidence = {
  faceId: string;
  clusterId: string;
  person: PartnerLabel;
  similarity: number;
};

export type AssetFaceDecision = {
  faceId: string;
  clusterId: string | null;
  person: PartnerLabel | null;
  similarity: number;
};

export type AssetPairDiagnostic = {
  assetId: string;
  detectedFaces: number;
  faceDecisions: readonly AssetFaceDecision[];
  bestA: FaceEvidence | null;
  bestB: FaceEvidence | null;
  decision: 'pair' | 'unsure' | 'no-faces';
  reason: string;
};

export function findCouplePhotos(input: {
  assets: readonly { assetId: string; faces: readonly IndexedFace[] }[];
  assignments: ReadonlyMap<string, ClusterAssignment>;
  identityByCluster: ReadonlyMap<string, PartnerLabel>;
  /** Faces must have at least this centroid similarity to their cluster to count. */
  minSimilarity?: number;
}): AssetPairDiagnostic[] {
  const minSimilarity = input.minSimilarity ?? 0;
  if (!Number.isFinite(minSimilarity) || minSimilarity < 0 || minSimilarity > 1) {
    throw new RangeError('The minimum assignment similarity must be between zero and one');
  }
  return input.assets.map((asset) => {
    const faceDecisions: AssetFaceDecision[] = asset.faces.map((face) => {
      const assignment = input.assignments.get(face.faceId);
      const clusterId = assignment?.clusterId ?? null;
      const person = clusterId ? input.identityByCluster.get(clusterId) ?? null : null;
      return { faceId: face.faceId, clusterId, person, similarity: assignment?.similarity ?? 0 };
    });

    let bestA: FaceEvidence | null = null;
    let bestB: FaceEvidence | null = null;
    for (const decision of faceDecisions) {
      if (!decision.person || !decision.clusterId || decision.similarity < minSimilarity) continue;
      const evidence: FaceEvidence = { faceId: decision.faceId, clusterId: decision.clusterId, person: decision.person, similarity: decision.similarity };
      if (decision.person === 'A' && (!bestA || evidence.similarity > bestA.similarity)) bestA = evidence;
      if (decision.person === 'B' && (!bestB || evidence.similarity > bestB.similarity)) bestB = evidence;
    }

    const decision: AssetPairDiagnostic = {
      assetId: asset.assetId,
      detectedFaces: asset.faces.length,
      faceDecisions,
      bestA,
      bestB,
      decision: 'unsure',
      reason: '',
    };
    if (!asset.faces.length) {
      return { ...decision, decision: 'no-faces', reason: 'No faces detected' };
    }
    if (bestA && bestB && bestA.faceId !== bestB.faceId) {
      return { ...decision, decision: 'pair', reason: 'Both partners matched distinct faces' };
    }
    if (!input.identityByCluster.size) {
      return { ...decision, reason: 'No partner identity was identified' };
    }
    if (bestA || bestB) {
      return { ...decision, reason: `Only one partner matched (${bestA ? 'A' : 'B'})` };
    }
    return { ...decision, reason: 'No confident partner match' };
  });
}

import { cosineSimilarity } from '@/features/album/face-pipeline';

import { normalizeEmbedding } from '@/features/face-index/embedding';
import type { ClusterIdentity, FaceCluster, PartnerLabel } from '@/features/face-index/types';

/**
 * Map two enrolled people onto anonymous clusters.
 *
 * The cluster is the identity representation. An enrollment photo is only a
 * key that finds which cluster is that person; once found, every face in the
 * cluster counts. This is the whole point of the spike: one fixed reference
 * per person is replaced by a cluster of observations.
 *
 * Identification is one-shot and conservative. It never pulls faces into a
 * cluster, so a low-confidence match cannot poison the cluster it matched.
 */
export type PartnerEnrollment = {
  A: readonly Float32Array[];
  B: readonly Float32Array[];
};

export type IdentificationOptions = {
  /** Minimum score for the winning cluster to be accepted. */
  identificationFloor: number;
  /** Minimum gap over the next-best cluster of the same person. */
  marginFloor: number;
};

export const SPIKE_IDENTIFICATION_OPTIONS: IdentificationOptions = {
  identificationFloor: 0.5,
  marginFloor: 0.02,
};

export type PartnerIdentification =
  | { kind: 'identified'; identities: readonly ClusterIdentity[] }
  | { kind: 'ambiguous'; reason: string; identities: readonly ClusterIdentity[] }
  | { kind: 'invalid'; reason: string };

type ClusterScore = { clusterId: string; score: number };

function validateEnrollment(enrollment: PartnerEnrollment): { A: Float32Array[]; B: Float32Array[] } | null {
  const normalize = (prints: readonly Float32Array[]) => {
    if (!Array.isArray(prints) || prints.length === 0) return null;
    const normalized: Float32Array[] = [];
    for (const print of prints) {
      const vector = normalizeEmbedding(print);
      if (!vector) return null;
      normalized.push(vector);
    }
    return normalized;
  };
  const A = normalize(enrollment.A);
  const B = normalize(enrollment.B);
  if (!A || !B) return null;
  return { A, B };
}

function rankClusters(clusters: readonly FaceCluster[], prints: readonly Float32Array[]): ClusterScore[] {
  return clusters
    .map((cluster) => ({
      clusterId: cluster.clusterId,
      score: Math.max(...prints.map((print) => cosineSimilarity(print, cluster.centroid))),
    }))
    .sort((left, right) => right.score - left.score || left.clusterId.localeCompare(right.clusterId));
}

function winner(ranked: readonly ClusterScore[], person: PartnerLabel): ClusterIdentity | null {
  const best = ranked[0];
  if (!best) return null;
  const runnerUp = ranked.find((entry) => entry.clusterId !== best.clusterId);
  return { clusterId: best.clusterId, person, score: best.score, margin: best.score - (runnerUp?.score ?? 0) };
}

export function identifyPartnerClusters(
  clusters: readonly FaceCluster[],
  enrollment: PartnerEnrollment,
  options: IdentificationOptions = SPIKE_IDENTIFICATION_OPTIONS,
): PartnerIdentification {
  const prints = validateEnrollment(enrollment);
  if (!prints) return { kind: 'invalid', reason: 'Enrollment needs at least one finite, normalized embedding per person' };
  if (!clusters.length) return { kind: 'ambiguous', reason: 'No identity clusters exist', identities: [] };

  const identityA = winner(rankClusters(clusters, prints.A), 'A');
  const identityB = winner(rankClusters(clusters, prints.B), 'B');
  if (!identityA || !identityB) return { kind: 'ambiguous', reason: 'No cluster scored for an enrolled person', identities: [] };
  const identities = [identityA, identityB];

  if (identityA.clusterId === identityB.clusterId) {
    return { kind: 'ambiguous', reason: 'Both enrolled people select the same cluster', identities };
  }
  if (identityA.score < options.identificationFloor || identityB.score < options.identificationFloor) {
    return { kind: 'ambiguous', reason: 'A winning cluster is below the identification floor', identities };
  }
  if (identityA.margin < options.marginFloor || identityB.margin < options.marginFloor) {
    return { kind: 'ambiguous', reason: 'Two clusters are too close to assign confidently', identities };
  }
  return { kind: 'identified', identities };
}

/** Convenience for the query layer: cluster id to person, empty when ambiguous. */
export function identityByCluster(identification: PartnerIdentification): ReadonlyMap<string, PartnerLabel> {
  const mapping = new Map<string, PartnerLabel>();
  if (identification.kind === 'identified') {
    for (const identity of identification.identities) mapping.set(identity.clusterId, identity.person);
  }
  return mapping;
}

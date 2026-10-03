import { cosineSimilarity } from '@/features/album/face-pipeline';

import { normalizeEmbedding } from '@/features/face-index/embedding';
import type { ClusterIdentity, FaceCluster, PartnerLabel } from '@/features/face-index/types';

/**
 * Map two enrolled people onto anonymous clusters.
 *
 * A person is a *set* of clusters, not one cluster. Clustering fragments an
 * identity, and forcing one person to equal one cluster drops every face in the
 * fragments. The fix is to attach several clusters, but only ones with
 * consistent support across the enrollment references. A cluster that only one
 * reference happens to match stays unattached.
 *
 * The previous version scored a cluster by the single best reference
 * (`max`). That is exactly what selected a small fragment: one reference sitting
 * inside the fragment scored 1.0 against it. Every strategy here instead asks
 * how many references agree, or how they agree on average. `max` is kept only
 * as the comparison baseline.
 *
 * Identification is one-shot. It maps clusters; it never pulls faces into them,
 * so a weak match cannot poison a cluster.
 */
export type IdentityStrategy =
  | 'max'
  | 'mean'
  | 'median'
  | 'trimmed-mean'
  | 'majority-vote'
  | 'member-support';

export const IDENTITY_STRATEGIES: readonly IdentityStrategy[] = ['max', 'mean', 'median', 'trimmed-mean', 'majority-vote', 'member-support'];

export type PartnerEnrollment = {
  A: readonly Float32Array[];
  B: readonly Float32Array[];
};

export type IdentificationOptions = {
  strategy: IdentityStrategy;
  /** Minimum aggregate similarity for a cluster to attach. */
  identificationFloor: number;
  /** Minimum share of references that must support the cluster. */
  supportFloor: number;
  /** Per-reference similarity counted as support. */
  memberSupportFloor: number;
  /** How far below the person's best cluster a fragment may still attach. */
  attachmentMargin: number;
};

export const SPIKE_IDENTIFICATION_OPTIONS: IdentificationOptions = {
  strategy: 'member-support',
  identificationFloor: 0.5,
  supportFloor: 0.5,
  memberSupportFloor: 0.5,
  attachmentMargin: 0.15,
};

export type PartnerIdentification =
  | { kind: 'identified'; identities: readonly ClusterIdentity[]; reason?: undefined }
  | { kind: 'ambiguous'; reason: string; identities: readonly ClusterIdentity[] }
  | { kind: 'invalid'; reason: string; identities: readonly ClusterIdentity[] };

type ScoredCluster = { cluster: FaceCluster; scores: number[]; aggregate: number; support: number };

function mean(values: readonly number[]): number {
  return values.length ? values.reduce((total, value) => total + value, 0) / values.length : 0;
}

function median(sorted: readonly number[]): number {
  if (!sorted.length) return 0;
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
}

/**
 * Similarity of one enrollment reference to one cluster. `member-support` uses
 * the best member, which survives fragmentation better than the centroid.
 */
export function referenceScore(strategy: IdentityStrategy, reference: Float32Array, cluster: FaceCluster): number {
  if (strategy === 'member-support' && cluster.memberEmbeddings.length) {
    let best = Number.NEGATIVE_INFINITY;
    for (const member of cluster.memberEmbeddings) {
      const score = cosineSimilarity(reference, member);
      if (score > best) best = score;
    }
    return best;
  }
  return cosineSimilarity(reference, cluster.centroid);
}

/** Aggregate a reference-to-cluster score list. `majority-vote` averages; its support does the voting. */
export function aggregateScore(strategy: IdentityStrategy, scores: readonly number[]): number {
  if (!scores.length) return 0;
  const sorted = [...scores].sort((left, right) => left - right);
  switch (strategy) {
    case 'max': return sorted[sorted.length - 1];
    case 'mean': return mean(scores);
    case 'median': return median(sorted);
    case 'trimmed-mean': return scores.length < 3 ? mean(scores) : mean(sorted.slice(1, -1));
    case 'majority-vote':
    case 'member-support': return mean(scores);
  }
}

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

function scoreClusters(strategy: IdentityStrategy, references: readonly Float32Array[], clusters: readonly FaceCluster[], memberSupportFloor: number): ScoredCluster[] {
  const scored = clusters.map((cluster) => {
    const scores = references.map((reference) => referenceScore(strategy, reference, cluster));
    return { cluster, scores, aggregate: aggregateScore(strategy, scores), support: 0 };
  });
  // Vote support: each reference votes for the cluster it matches best.
  const votes = new Array<number>(scored.length).fill(0);
  references.forEach((_, referenceIndex) => {
    let bestIndex = -1;
    let bestScore = Number.NEGATIVE_INFINITY;
    scored.forEach((entry, index) => {
      const score = entry.scores[referenceIndex];
      if (score > bestScore) { bestScore = score; bestIndex = index; }
    });
    if (bestIndex >= 0) votes[bestIndex] += 1;
  });
  return scored.map((entry, index) => ({
    ...entry,
    support: strategy === 'majority-vote'
      ? votes[index] / references.length
      : entry.scores.filter((score) => score >= memberSupportFloor).length / references.length,
  }));
}

/**
 * Clusters for one person, ordered strongest first. Attaches every cluster with
 * enough consistent support within `attachmentMargin` of that person's best.
 */
function attachClusters(person: PartnerLabel, references: readonly Float32Array[], clusters: readonly FaceCluster[], options: IdentificationOptions): ClusterIdentity[] {
  const scored = scoreClusters(options.strategy, references, clusters, options.memberSupportFloor);
  const best = Math.max(...scored.map((entry) => entry.aggregate), Number.NEGATIVE_INFINITY);
  return scored
    .filter((entry) => entry.aggregate >= options.identificationFloor
      && entry.support >= options.supportFloor
      && entry.aggregate >= best - options.attachmentMargin)
    .sort((left, right) => right.aggregate - left.aggregate || right.support - left.support || left.cluster.clusterId.localeCompare(right.cluster.clusterId))
    .map((entry) => ({ clusterId: entry.cluster.clusterId, person, score: entry.aggregate, support: entry.support }));
}

export function identifyPartnerClusters(
  clusters: readonly FaceCluster[],
  enrollment: PartnerEnrollment,
  options: IdentificationOptions = SPIKE_IDENTIFICATION_OPTIONS,
): PartnerIdentification {
  const prints = validateEnrollment(enrollment);
  if (!prints) return { kind: 'invalid', reason: 'Enrollment needs at least one finite, normalized embedding per person', identities: [] };
  if (!clusters.length) return { kind: 'ambiguous', reason: 'No identity clusters exist', identities: [] };

  const attachedA = attachClusters('A', prints.A, clusters, options);
  const attachedB = attachClusters('B', prints.B, clusters, options);
  const idsA = new Set(attachedA.map((identity) => identity.clusterId));
  const idsB = new Set(attachedB.map((identity) => identity.clusterId));
  // A cluster claimed by both people is ambiguous ownership: attach it to neither.
  const shared = new Set([...idsA].filter((clusterId) => idsB.has(clusterId)));
  const filteredA = attachedA.filter((identity) => !shared.has(identity.clusterId));
  const filteredB = attachedB.filter((identity) => !shared.has(identity.clusterId));
  const identities = [...filteredA, ...filteredB];

  if (shared.size && (!filteredA.length || !filteredB.length)) {
    return { kind: 'ambiguous', reason: 'Both enrolled people claim the same cluster', identities };
  }
  if (!filteredA.length || !filteredB.length) {
    return { kind: 'ambiguous', reason: 'An enrolled person has no cluster with consistent support', identities };
  }
  return { kind: 'identified', identities };
}

/** Convenience for the query layer: cluster id to person. Supports several clusters per person. */
export function identityByCluster(identification: PartnerIdentification): ReadonlyMap<string, PartnerLabel> {
  const mapping = new Map<string, PartnerLabel>();
  if (identification.kind === 'identified') {
    for (const identity of identification.identities) mapping.set(identity.clusterId, identity.person);
  }
  return mapping;
}

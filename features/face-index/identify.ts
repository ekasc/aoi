import { cosineSimilarity } from '@/features/album/face-pipeline';

import { normalizeEmbedding } from '@/features/face-index/embedding';
import type { ClusterIdentity, FaceCluster, PartnerLabel } from '@/features/face-index/types';

/**
 * Map two enrolled people onto anonymous clusters.
 *
 * A person is a *set* of clusters, not one cluster. Clustering fragments an
 * identity, and forcing one person to equal one cluster drops every face in the
 * fragments. The fix is to attach several clusters, but only ones with
 * consistent evidence across the enrollment references.
 *
 * Scoring has two forms.
 * - Centroid-based: one similarity per reference against the cluster mean.
 *   `max`, `mean`, `median`, `trimmed-mean`, `majority-vote`.
 * - Member-based: similarity against cluster members. `member-support` takes
 *   the best member, `top-k` averages the best few members, and `representative`
 *   takes the best of a bounded set of members closest to the centroid. The
 *   member-based forms survive fragmentation, but `member-support` gives a
 *   large cluster more chances to hold one unusually close member.
 *
 * Support has two forms.
 * - Vote-based (`majority-vote`): for each reference, count which cluster it
 *   matches best, and support is the share of references that picked this one.
 * - Threshold-based (every other strategy): support is the share of references
 *   whose score for this cluster clears `memberSupportFloor`.
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
  | 'member-support'
  | 'top-k'
  | 'representative';

export const IDENTITY_STRATEGIES: readonly IdentityStrategy[] = [
  'max', 'mean', 'median', 'trimmed-mean', 'majority-vote', 'member-support', 'top-k', 'representative',
];

/** How many members `top-k` averages. `min(ROBUST_TOP_K, cluster size)`. */
export const ROBUST_TOP_K = 3;
/** How many members closest to the centroid `representative` scores against. */
export const REPRESENTATIVE_MEMBERS = 5;

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

/** Why a cluster did or did not attach. One string per cluster. */
export type IdentityEvidenceReason =
  | 'attached'
  | 'claimed-by-both'
  | 'below-floor'
  | 'insufficient-support'
  | 'outside-attachment-margin'
  | 'single-reference-attach-limit';

export type ClusterReferenceEvidence = {
  aggregate: number;
  support: number;
  referenceScores: number[];
};

/** The evidence behind one cluster's identity decision. No embeddings. */
export type ClusterIdentityEvidence = {
  clusterId: string;
  size: number;
  A: ClusterReferenceEvidence;
  B: ClusterReferenceEvidence;
  attachedTo: PartnerLabel | null;
  sharedClaim: boolean;
  reason: IdentityEvidenceReason;
};

export type PartnerIdentificationResult = {
  identification: PartnerIdentification;
  evidence: ClusterIdentityEvidence[];
};

type ScoredCluster = { cluster: FaceCluster; scores: number[]; aggregate: number; support: number };
type PersonVerdict = { scored: ScoredCluster; attached: boolean; reason: IdentityEvidenceReason };

function mean(values: readonly number[]): number {
  return values.length ? values.reduce((total, value) => total + value, 0) / values.length : 0;
}

function median(sorted: readonly number[]): number {
  if (!sorted.length) return 0;
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
}

function topKMean(scores: readonly number[], k: number): number {
  if (!scores.length) return 0;
  const sorted = [...scores].sort((left, right) => right - left);
  return mean(sorted.slice(0, Math.min(k, sorted.length)));
}

/**
 * Bounded, deterministic representative set: the members closest to the cluster
 * centroid, ties broken by face id. `representative` scores against these so a
 * far-from-centroid outlier member cannot dominate.
 */
export function representativeMembers(cluster: FaceCluster, limit: number = REPRESENTATIVE_MEMBERS): readonly Float32Array[] {
  if (limit <= 0 || cluster.memberEmbeddings.length <= limit) return cluster.memberEmbeddings;
  return cluster.memberEmbeddings
    .map((embedding, index) => ({ embedding, faceId: cluster.faceIds[index] ?? '', score: cosineSimilarity(embedding, cluster.centroid) }))
    .sort((left, right) => right.score - left.score || left.faceId.localeCompare(right.faceId))
    .slice(0, limit)
    .map((entry) => entry.embedding);
}

/** Similarity of one enrollment reference to one cluster, under the chosen strategy. */
export function referenceScore(strategy: IdentityStrategy, reference: Float32Array, cluster: FaceCluster): number {
  if (!cluster.memberEmbeddings.length) return cosineSimilarity(reference, cluster.centroid);
  if (strategy === 'member-support') {
    let best = Number.NEGATIVE_INFINITY;
    for (const member of cluster.memberEmbeddings) best = Math.max(best, cosineSimilarity(reference, member));
    return best;
  }
  if (strategy === 'top-k') {
    return topKMean(cluster.memberEmbeddings.map((member) => cosineSimilarity(reference, member)), ROBUST_TOP_K);
  }
  if (strategy === 'representative') {
    let best = Number.NEGATIVE_INFINITY;
    for (const member of representativeMembers(cluster)) best = Math.max(best, cosineSimilarity(reference, member));
    return best;
  }
  return cosineSimilarity(reference, cluster.centroid);
}

/** Aggregate a reference-to-cluster score list. Vote strategies still average; their support does the voting. */
export function aggregateScore(strategy: IdentityStrategy, scores: readonly number[]): number {
  if (!scores.length) return 0;
  const sorted = [...scores].sort((left, right) => left - right);
  switch (strategy) {
    case 'max': return sorted[sorted.length - 1];
    case 'mean': return mean(scores);
    case 'median': return median(sorted);
    case 'trimmed-mean': return scores.length < 3 ? mean(scores) : mean(sorted.slice(1, -1));
    case 'majority-vote':
    case 'member-support':
    case 'top-k':
    case 'representative': return mean(scores);
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

function compareScored(left: ScoredCluster, right: ScoredCluster): number {
  return right.aggregate - left.aggregate || right.support - left.support || left.cluster.clusterId.localeCompare(right.cluster.clusterId);
}

/**
 * Verdict per cluster for one person.
 *
 * With a single reference there is no cross-reference evidence, so only the
 * strongest candidate attaches. Otherwise every candidate within
 * `attachmentMargin` of the person's best attaches, which is how fragments are
 * recovered without letting a lookalike in.
 */
function personVerdicts(references: readonly Float32Array[], clusters: readonly FaceCluster[], options: IdentificationOptions): PersonVerdict[] {
  const scored = scoreClusters(options.strategy, references, clusters, options.memberSupportFloor);
  const best = Math.max(...scored.map((entry) => entry.aggregate), Number.NEGATIVE_INFINITY);
  const verdicts = scored.map((entry): PersonVerdict => {
    if (entry.aggregate < options.identificationFloor) return { scored: entry, attached: false, reason: 'below-floor' };
    if (entry.support < options.supportFloor) return { scored: entry, attached: false, reason: 'insufficient-support' };
    if (entry.aggregate < best - options.attachmentMargin) return { scored: entry, attached: false, reason: 'outside-attachment-margin' };
    return { scored: entry, attached: true, reason: 'attached' };
  });
  if (references.length < 2) {
    const attached = verdicts.filter((verdict) => verdict.attached).sort((left, right) => compareScored(left.scored, right.scored));
    for (const extra of attached.slice(1)) {
      extra.attached = false;
      extra.reason = 'single-reference-attach-limit';
    }
  }
  return verdicts;
}

function referenceEvidence(scored: ScoredCluster): ClusterReferenceEvidence {
  return { aggregate: scored.aggregate, support: scored.support, referenceScores: [...scored.scores] };
}

function failingReason(left: PersonVerdict, right: PersonVerdict): IdentityEvidenceReason {
  return left.scored.aggregate >= right.scored.aggregate ? left.reason : right.reason;
}

export function identifyPartnerClustersWithEvidence(
  clusters: readonly FaceCluster[],
  enrollment: PartnerEnrollment,
  options: IdentificationOptions = SPIKE_IDENTIFICATION_OPTIONS,
): PartnerIdentificationResult {
  const prints = validateEnrollment(enrollment);
  if (!prints) {
    return { identification: { kind: 'invalid', reason: 'Enrollment needs at least one finite, normalized embedding per person', identities: [] }, evidence: [] };
  }
  if (!clusters.length) {
    return { identification: { kind: 'ambiguous', reason: 'No identity clusters exist', identities: [] }, evidence: [] };
  }

  const verdictsA = personVerdicts(prints.A, clusters, options);
  const verdictsB = personVerdicts(prints.B, clusters, options);
  const attachedIdsA = new Set(verdictsA.filter((verdict) => verdict.attached).map((verdict) => verdict.scored.cluster.clusterId));
  const attachedIdsB = new Set(verdictsB.filter((verdict) => verdict.attached).map((verdict) => verdict.scored.cluster.clusterId));
  // A cluster claimed by both people is ambiguous ownership: attach it to neither.
  const shared = new Set([...attachedIdsA].filter((clusterId) => attachedIdsB.has(clusterId)));

  const evidence: ClusterIdentityEvidence[] = clusters.map((cluster, index) => {
    const a = verdictsA[index];
    const b = verdictsB[index];
    const sharedClaim = shared.has(cluster.clusterId);
    let attachedTo: PartnerLabel | null = null;
    let reason: IdentityEvidenceReason;
    if (sharedClaim) reason = 'claimed-by-both';
    else if (a.attached) { attachedTo = 'A'; reason = 'attached'; }
    else if (b.attached) { attachedTo = 'B'; reason = 'attached'; }
    else reason = failingReason(a, b);
    return { clusterId: cluster.clusterId, size: cluster.size, A: referenceEvidence(a.scored), B: referenceEvidence(b.scored), attachedTo, sharedClaim, reason };
  });

  const identitiesOf = (verdicts: PersonVerdict[], person: PartnerLabel): ClusterIdentity[] => verdicts
    .filter((verdict) => verdict.attached && !shared.has(verdict.scored.cluster.clusterId))
    .sort((left, right) => compareScored(left.scored, right.scored))
    .map((verdict) => ({ clusterId: verdict.scored.cluster.clusterId, person, score: verdict.scored.aggregate, support: verdict.scored.support }));
  const attachedA = identitiesOf(verdictsA, 'A');
  const attachedB = identitiesOf(verdictsB, 'B');
  const identities = [...attachedA, ...attachedB];

  if (shared.size && (!attachedA.length || !attachedB.length)) {
    return { identification: { kind: 'ambiguous', reason: 'Both enrolled people claim the same cluster', identities }, evidence };
  }
  if (!attachedA.length || !attachedB.length) {
    return { identification: { kind: 'ambiguous', reason: 'An enrolled person has no cluster with consistent support', identities }, evidence };
  }
  return { identification: { kind: 'identified', identities }, evidence };
}

export function identifyPartnerClusters(
  clusters: readonly FaceCluster[],
  enrollment: PartnerEnrollment,
  options: IdentificationOptions = SPIKE_IDENTIFICATION_OPTIONS,
): PartnerIdentification {
  return identifyPartnerClustersWithEvidence(clusters, enrollment, options).identification;
}

/** Convenience for the query layer: cluster id to person. Supports several clusters per person. */
export function identityByCluster(identification: PartnerIdentification): ReadonlyMap<string, PartnerLabel> {
  const mapping = new Map<string, PartnerLabel>();
  if (identification.kind === 'identified') {
    for (const identity of identification.identities) mapping.set(identity.clusterId, identity.person);
  }
  return mapping;
}

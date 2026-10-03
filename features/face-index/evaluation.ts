import type { FaceCluster } from '@/features/face-index/types';

/**
 * Metrics for the spike, kept separate and never collapsed into one number.
 *
 * Detection recall, embedding success, clustering quality, partner-cluster
 * identification, and pair-photo recall are different questions. A single
 * "accuracy" hides which stage failed.
 */

export type ClusterQuality = {
  faces: number;
  clusters: number;
  /** Share of faces in a cluster that carry the cluster's majority identity. */
  purity: number;
  /** Share of same-cluster pairs that are truly the same identity. */
  pairwisePrecision: number;
  /** Share of same-identity pairs that ended up in one cluster. */
  pairwiseRecall: number;
};

/**
 * Compare anonymous clusters with a ground-truth identity per face. Faceless
 * or unlabeled entries are ignored. This is for offline evaluation only; the
 * production pipeline never sees identity labels.
 */
export function measureClusterQuality(
  clusters: readonly FaceCluster[],
  truthByFace: ReadonlyMap<string, string>,
): ClusterQuality {
  const labeled = clusters
    .map((cluster) => cluster.faceIds.filter((faceId) => truthByFace.has(faceId)))
    .filter((faceIds) => faceIds.length > 0);
  const faces = labeled.reduce((total, faceIds) => total + faceIds.length, 0);
  if (faces === 0) return { faces: 0, clusters: labeled.length, purity: 0, pairwisePrecision: 0, pairwiseRecall: 0 };

  let majorityTotal = 0;
  let truePositive = 0;
  let sameClusterPairs = 0;
  let trueSamePairs = 0;
  const labelCounts = new Map<string, number>();
  const pairs = (count: number) => (count * (count - 1)) / 2;
  for (const faceIds of labeled) {
    const counts = new Map<string, number>();
    for (const faceId of faceIds) {
      const label = truthByFace.get(faceId);
      if (!label) continue;
      counts.set(label, (counts.get(label) ?? 0) + 1);
      labelCounts.set(label, (labelCounts.get(label) ?? 0) + 1);
    }
    majorityTotal += Math.max(...counts.values());
    sameClusterPairs += pairs(faceIds.length);
    for (const count of counts.values()) truePositive += pairs(count);
  }
  for (const count of labelCounts.values()) trueSamePairs += pairs(count);

  return {
    faces,
    clusters: labeled.length,
    purity: majorityTotal / faces,
    pairwisePrecision: sameClusterPairs === 0 ? 0 : truePositive / sameClusterPairs,
    pairwiseRecall: trueSamePairs === 0 ? 0 : truePositive / trueSamePairs,
  };
}

export type PairExpectation = 'positive' | 'solo-A' | 'solo-B' | 'negative';
export type PairOutcome = { expectation: PairExpectation; decision: 'pair' | 'unsure' | 'no-faces' };

export type PairOutcomeSummary = {
  positives: { total: number; found: number; missed: number };
  soloA: { total: number; incorrect: number };
  soloB: { total: number; incorrect: number };
  negatives: { total: number; incorrect: number };
  falsePairAdditions: number;
};

export function summarizePairOutcomes(outcomes: readonly PairOutcome[]): PairOutcomeSummary {
  const summary: PairOutcomeSummary = {
    positives: { total: 0, found: 0, missed: 0 },
    soloA: { total: 0, incorrect: 0 },
    soloB: { total: 0, incorrect: 0 },
    negatives: { total: 0, incorrect: 0 },
    falsePairAdditions: 0,
  };
  for (const outcome of outcomes) {
    const accepted = outcome.decision === 'pair';
    if (outcome.expectation === 'positive') {
      summary.positives.total += 1;
      if (accepted) summary.positives.found += 1;
      else summary.positives.missed += 1;
    } else if (outcome.expectation === 'solo-A') {
      summary.soloA.total += 1;
      if (accepted) summary.soloA.incorrect += 1;
    } else if (outcome.expectation === 'solo-B') {
      summary.soloB.total += 1;
      if (accepted) summary.soloB.incorrect += 1;
    } else {
      summary.negatives.total += 1;
      if (accepted) summary.negatives.incorrect += 1;
    }
    if (accepted && outcome.expectation !== 'positive') summary.falsePairAdditions += 1;
  }
  return summary;
}

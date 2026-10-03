import { describe, expect, it } from 'vitest';

import { measureClusterQuality, summarizePairOutcomes } from '@/features/face-index/evaluation';
import type { FaceCluster } from '@/features/face-index/types';
import { unit } from './helpers';

function cluster(clusterId: string, faceIds: string[], size = faceIds.length): FaceCluster {
  return { clusterId, faceIds, size, centroid: unit(0) };
}

describe('clustering quality metrics', () => {
  it('measures purity, pairwise precision, and pairwise recall against ground truth', () => {
    const clusters = [cluster('cluster-0', ['a1', 'a2', 'b1']), cluster('cluster-1', ['c1', 'c2'])];
    const truth = new Map([['a1', 'a'], ['a2', 'a'], ['b1', 'b'], ['c1', 'c'], ['c2', 'c']]);
    expect(measureClusterQuality(clusters, truth)).toEqual({
      faces: 5, clusters: 2, purity: 0.8, pairwisePrecision: 0.5, pairwiseRecall: 1,
    });
  });

  it('reports perfect quality for aligned clusters', () => {
    const clusters = [cluster('cluster-0', ['a1', 'a2']), cluster('cluster-1', ['b1'])];
    const truth = new Map([['a1', 'a'], ['a2', 'a'], ['b1', 'b']]);
    expect(measureClusterQuality(clusters, truth)).toEqual({ faces: 3, clusters: 2, purity: 1, pairwisePrecision: 1, pairwiseRecall: 1 });
  });

  it('ignores unlabeled faces and empty clusters', () => {
    expect(measureClusterQuality([cluster('cluster-0', ['a1'])], new Map())).toEqual({ faces: 0, clusters: 0, purity: 0, pairwisePrecision: 0, pairwiseRecall: 0 });
    expect(measureClusterQuality([cluster('cluster-0', ['a1', 'x1'])], new Map([['a1', 'a']]))).toMatchObject({ faces: 1, purity: 1 });
  });
});

describe('pair-outcome summary', () => {
  it('separates positive recall from every false-addition category', () => {
    const summary = summarizePairOutcomes([
      { expectation: 'positive', decision: 'pair' },
      { expectation: 'positive', decision: 'pair' },
      { expectation: 'positive', decision: 'pair' },
      { expectation: 'positive', decision: 'unsure' },
      { expectation: 'positive', decision: 'no-faces' },
      { expectation: 'solo-A', decision: 'pair' },
      { expectation: 'solo-A', decision: 'unsure' },
      { expectation: 'solo-B', decision: 'unsure' },
      { expectation: 'negative', decision: 'pair' },
      { expectation: 'negative', decision: 'unsure' },
    ]);
    expect(summary).toEqual({
      positives: { total: 5, found: 3, missed: 2 },
      soloA: { total: 2, incorrect: 1 },
      soloB: { total: 1, incorrect: 0 },
      negatives: { total: 2, incorrect: 1 },
      falsePairAdditions: 2,
    });
  });
});

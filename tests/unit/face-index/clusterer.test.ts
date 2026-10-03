import { describe, expect, it } from 'vitest';

import { createFaceClusterer, validateClustererOptions } from '@/features/face-index/clusterer';
import { face, unit } from './helpers';

describe('incremental face clustering', () => {
  it('groups observations of one identity and separates another', () => {
    const clusterer = createFaceClusterer({ similarityThreshold: 0.55, lowQualityThreshold: 0.8, qualityFloor: 0.5 });
    clusterer.assign(face('a1', unit(0)));
    clusterer.assign(face('a2', unit(0, 0.3)));
    clusterer.assign(face('b1', unit(1)));
    clusterer.assign(face('b2', unit(1, 0.25)));
    const clusters = clusterer.clusters();
    expect(clusters).toHaveLength(2);
    expect(clusters[0].faceIds).toEqual(['a1', 'a2']);
    expect(clusters[1].faceIds).toEqual(['b1', 'b2']);
    expect(clusterer.assignmentFor('a2')?.clusterId).toBe('cluster-0');
    expect(clusterer.assignmentFor('b1')?.clusterId).toBe('cluster-1');
  });

  it('is order-stable for a sorted input and resolves ties to the earliest cluster', () => {
    const build = () => {
      const clusterer = createFaceClusterer({ similarityThreshold: 0.5, lowQualityThreshold: 0.9, qualityFloor: 0.5 });
      [unit(0), unit(1, 0.2), unit(1)].forEach((embedding, index) => clusterer.assign(face(`f${index}`, embedding)));
      return clusterer.clusters().map((cluster) => [cluster.clusterId, cluster.faceIds]);
    };
    expect(build()).toEqual(build());
  });

  it('applies a stricter threshold to low-quality faces', () => {
    const options = { similarityThreshold: 0.55, lowQualityThreshold: 0.85, qualityFloor: 0.5 };
    const poor = createFaceClusterer(options);
    poor.assign(face('seed', unit(0)));
    // cos ~0.64 to the seed: good enough for the standard threshold, not the strict one.
    const marginal = unit(0, Math.tan(Math.acos(0.64)));
    expect(poor.assign(face('poor', marginal, { qualityScore: 0.2 }))?.clusterId).toBe('cluster-1');
    const good = createFaceClusterer(options);
    good.assign(face('seed', unit(0)));
    expect(good.assign(face('good', marginal, { qualityScore: 0.9 }))?.clusterId).toBe('cluster-0');
  });

  it('rejects malformed embeddings without creating a cluster', () => {
    const clusterer = createFaceClusterer();
    expect(clusterer.assign(face('bad', new Float32Array(128)))).toBeNull();
    expect(clusterer.assign(face('nan', Float32Array.from({ length: 128 }, (_, index) => (index === 0 ? Number.NaN : 0))))).toBeNull();
    expect(clusterer.clusters()).toEqual([]);
    expect(clusterer.assignments()).toEqual([]);
  });

  it('remembers a rejection so the face does not rejoin that cluster', () => {
    const clusterer = createFaceClusterer({ similarityThreshold: 0.4, lowQualityThreshold: 0.9, qualityFloor: 0.5 });
    clusterer.assign(face('seed-a', unit(0)));
    clusterer.assign(face('seed-b', unit(1)));
    clusterer.assign(face('x', unit(0, 0.2)));
    expect(clusterer.assignmentFor('x')?.clusterId).toBe('cluster-0');
    clusterer.reject('x', 'cluster-0');
    expect(clusterer.assignmentFor('x')).toBeUndefined();
    expect(clusterer.rejectionsFor('x')).toEqual(['cluster-0']);
    // Reassigning skips the rejected cluster instead of immediately rejoining it.
    expect(clusterer.assign(face('x', unit(0, 0.2)))?.clusterId).not.toBe('cluster-0');
    expect(clusterer.clusters()[0].faceIds).toEqual(['seed-a']);
  });

  it('classifies a query face without mutating the clusters', () => {
    const clusterer = createFaceClusterer({ similarityThreshold: 0.55, lowQualityThreshold: 0.8, qualityFloor: 0.5 });
    clusterer.assign(face('a1', unit(0)));
    clusterer.assign(face('b1', unit(1)));
    const before = clusterer.clusters().map((cluster) => cluster.size);
    expect(clusterer.classify(face('query', unit(0, 0.1)))?.clusterId).toBe('cluster-0');
    expect(clusterer.classify(face('far', unit(2)))?.clusterId).toBeUndefined();
    expect(clusterer.clusters().map((cluster) => cluster.size)).toEqual(before);
    expect(clusterer.assignmentFor('query')).toBeUndefined();
  });

  it('validates its configuration', () => {
    expect(() => validateClustererOptions({ similarityThreshold: -1, lowQualityThreshold: 0.7, qualityFloor: 0.5 })).toThrow(RangeError);
    expect(() => validateClustererOptions({ similarityThreshold: 0.8, lowQualityThreshold: 0.6, qualityFloor: 0.5 })).toThrow(RangeError);
    expect(() => createFaceClusterer({ similarityThreshold: Number.NaN, lowQualityThreshold: 0.7, qualityFloor: 0.5 })).toThrow(RangeError);
  });
});

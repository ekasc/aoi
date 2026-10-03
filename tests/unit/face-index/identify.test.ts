import { describe, expect, it } from 'vitest';

import { identifyPartnerClusters, identityByCluster, SPIKE_IDENTIFICATION_OPTIONS } from '@/features/face-index/identify';
import type { FaceCluster } from '@/features/face-index/types';
import { unit } from './helpers';

function cluster(clusterId: string, centroid: Float32Array, size: number): FaceCluster {
  return { clusterId, centroid, size, faceIds: Array.from({ length: size }, (_, index) => `${clusterId}-face-${index}`) };
}

const options = SPIKE_IDENTIFICATION_OPTIONS;

describe('partner-cluster identification', () => {
  it('maps multi-reference enrollment onto the correct anonymous clusters', () => {
    const clusters = [cluster('cluster-0', unit(0), 12), cluster('cluster-1', unit(1), 9), cluster('cluster-2', unit(2), 4)];
    const result = identifyPartnerClusters(clusters, { A: [unit(0, 0.2), unit(0, -0.15)], B: [unit(1, 0.1), unit(1, -0.2)] }, options);
    expect(result.kind).toBe('identified');
    const mapping = identityByCluster(result);
    expect(mapping.get('cluster-0')).toBe('A');
    expect(mapping.get('cluster-1')).toBe('B');
    expect(mapping.size).toBe(2);
  });

  it('is ambiguous when both people select the same cluster', () => {
    const clusters = [cluster('cluster-0', unit(0), 5), cluster('cluster-1', unit(1), 5)];
    const result = identifyPartnerClusters(clusters, { A: [unit(0)], B: [unit(0, 0.01)] }, options);
    expect(result.kind).toBe('ambiguous');
    if (result.kind === 'ambiguous') expect(result.reason).toContain('same cluster');
    expect(identityByCluster(result).size).toBe(0);
  });

  it('is ambiguous below the identification floor', () => {
    const clusters = [cluster('cluster-0', unit(0), 5), cluster('cluster-1', unit(1), 5)];
    // A's closest cluster is 2 (nothing close); B matches cluster-1.
    const result = identifyPartnerClusters(clusters, { A: [unit(5)], B: [unit(1)] }, options);
    expect(result.kind).toBe('ambiguous');
    if (result.kind === 'ambiguous') expect(result.reason).toContain('floor');
  });

  it('is ambiguous when two clusters are too close to separate', () => {
    const clusters = [cluster('cluster-0', unit(0), 5), cluster('cluster-1', unit(0, 0.05), 5), cluster('cluster-2', unit(1), 5)];
    const result = identifyPartnerClusters(clusters, { A: [unit(0)], B: [unit(1)] }, options);
    expect(result.kind).toBe('ambiguous');
    if (result.kind === 'ambiguous') expect(result.reason).toContain('close');
  });

  it('rejects invalid enrollment and empty cluster sets', () => {
    expect(identifyPartnerClusters([], { A: [unit(0)], B: [unit(1)] }, options).kind).toBe('ambiguous');
    expect(identifyPartnerClusters([cluster('cluster-0', unit(0), 1)], { A: [new Float32Array(128)], B: [unit(1)] }, options).kind).toBe('invalid');
    expect(identifyPartnerClusters([cluster('cluster-0', unit(0), 1)], { A: [], B: [unit(1)] }, options).kind).toBe('invalid');
  });
});

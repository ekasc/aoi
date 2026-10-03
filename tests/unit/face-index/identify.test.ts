import { describe, expect, it } from 'vitest';

import { aggregateScore, identifyPartnerClusters, identityByCluster, referenceScore, SPIKE_IDENTIFICATION_OPTIONS } from '@/features/face-index/identify';
import type { FaceCluster, PartnerLabel } from '@/features/face-index/types';
import { unit } from './helpers';

function cluster(clusterId: string, members: Float32Array[]): FaceCluster {
  const dimensions = members[0]?.length ?? 128;
  const centroid = new Float32Array(dimensions);
  for (const member of members) for (let index = 0; index < dimensions; index += 1) centroid[index] += member[index];
  for (let index = 0; index < dimensions; index += 1) centroid[index] /= members.length;
  return { clusterId, faceIds: members.map((_, index) => `${clusterId}-face-${index}`), centroid, memberEmbeddings: members, size: members.length };
}

const options = { ...SPIKE_IDENTIFICATION_OPTIONS };

describe('identity scoring primitives', () => {
  it('scores a reference against the best member only for member-support', () => {
    const target = cluster('cluster-0', [unit(0, 0.05), unit(0, -0.05)]);
    expect(referenceScore('member-support', unit(0, 0.05), target)).toBeCloseTo(1, 6);
    expect(referenceScore('mean', unit(0, 0.05), target)).toBeLessThan(1);
    expect(referenceScore('mean', unit(0, 0.05), target)).toBeCloseTo(referenceScore('member-support', unit(0, 0.05), target), 2);
  });

  it('aggregates reference scores differently per strategy', () => {
    const scores = [0.2, 0.4, 0.6, 0.8];
    expect(aggregateScore('max', scores)).toBe(0.8);
    expect(aggregateScore('mean', scores)).toBeCloseTo(0.5, 6);
    expect(aggregateScore('median', scores)).toBeCloseTo(0.5, 6);
    expect(aggregateScore('trimmed-mean', scores)).toBeCloseTo(0.5, 6);
    expect(aggregateScore('trimmed-mean', [0.2, 0.4, 0.8])).toBeCloseTo(0.4, 6);
    expect(aggregateScore('max', [])).toBe(0);
  });
});

describe('multi-cluster identity assignment', () => {
  it('attaches every strongly supported cluster, not only the single best', () => {
    const clusters = [
      cluster('cluster-0', [unit(0, 0.1), unit(0, -0.1)]),
      cluster('cluster-1', [unit(0, 0.25)]),
      cluster('cluster-2', [unit(1, 0.1)]),
    ];
    const result = identifyPartnerClusters(clusters, { A: [unit(0), unit(0, 0.2)], B: [unit(1)] }, options);
    expect(result.kind).toBe('identified');
    const mapping = identityByCluster(result);
    expect([...mapping.keys()].sort()).toEqual(['cluster-0', 'cluster-1', 'cluster-2']);
    expect(mapping.get('cluster-0')).toBe('A');
    expect(mapping.get('cluster-1')).toBe('A');
    expect(mapping.get('cluster-2')).toBe('B');
  });

  it('keeps a weakly supported cluster unattached instead of contaminating the identity', () => {
    const clusters = [cluster('cluster-0', [unit(0, 0.1)]), cluster('cluster-9', [unit(2)])];
    const result = identifyPartnerClusters(clusters, { A: [unit(0)], B: [unit(1)] }, options);
    expect(result.kind).toBe('ambiguous');
    expect(identityByCluster(result).size).toBe(0);
  });

  it('majority-vote drops a cluster only one reference matches best', () => {
    const clusters = [cluster('cluster-main', [unit(0, 0.05)]), cluster('cluster-frag', [unit(0, 0.6)]), cluster('cluster-b', [unit(1)])];
    const references = [unit(0), unit(0, 0.1), unit(0, -0.1), unit(0, 0.6)];
    const voted = identifyPartnerClusters(clusters, { A: references, B: [unit(1)] }, { ...options, strategy: 'majority-vote' });
    expect(voted.kind).toBe('identified');
    expect(identityByCluster(voted).has('cluster-main')).toBe(true);
    expect(identityByCluster(voted).has('cluster-frag')).toBe(false);
    // Member-support sees the fragment as the same person and keeps both.
    const supported = identifyPartnerClusters(clusters, { A: references, B: [unit(1)] }, { ...options, strategy: 'member-support' });
    expect(identityByCluster(supported).has('cluster-frag')).toBe(true);
  });

  it('treats a cluster claimed by both people as ambiguous', () => {
    const clusters = [cluster('cluster-0', [unit(0)]), cluster('cluster-1', [unit(1)])];
    const result = identifyPartnerClusters(clusters, { A: [unit(0)], B: [unit(0, 0.02)] }, options);
    expect(result.kind).toBe('ambiguous');
    if (result.kind === 'ambiguous') expect(result.reason).toContain('same cluster');
  });

  it('is ambiguous when a person has no cluster with consistent support', () => {
    const clusters = [cluster('cluster-0', [unit(0)]), cluster('cluster-1', [unit(1)])];
    const result = identifyPartnerClusters(clusters, { A: [unit(5)], B: [unit(1)] }, options);
    expect(result.kind).toBe('ambiguous');
    if (result.kind === 'ambiguous') expect(result.reason).toContain('consistent support');
  });

  it('rejects invalid enrollment and empty cluster sets', () => {
    expect(identifyPartnerClusters([], { A: [unit(0)], B: [unit(1)] }, options).kind).toBe('ambiguous');
    expect(identifyPartnerClusters([cluster('cluster-0', [unit(0)])], { A: [new Float32Array(128)], B: [unit(1)] }, options).kind).toBe('invalid');
    expect(identifyPartnerClusters([cluster('cluster-0', [unit(0)])], { A: [], B: [unit(1)] }, options).kind).toBe('invalid');
  });

  it('identityByCluster returns one mapping entry per attached cluster', () => {
    const identities: { clusterId: string; person: PartnerLabel; score: number; support: number }[] = [
      { clusterId: 'c1', person: 'A', score: 0.9, support: 1 },
      { clusterId: 'c2', person: 'A', score: 0.8, support: 0.75 },
      { clusterId: 'c3', person: 'B', score: 0.95, support: 1 },
    ];
    const mapping = identityByCluster({ kind: 'identified', identities });
    expect(mapping.size).toBe(3);
    expect(mapping.get('c2')).toBe('A');
  });
});

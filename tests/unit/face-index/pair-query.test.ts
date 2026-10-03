import { describe, expect, it } from 'vitest';

import { findCouplePhotos } from '@/features/face-index/pair-query';
import type { ClusterAssignment, PartnerLabel } from '@/features/face-index/types';
import { face, unit } from './helpers';

const assignment = (faceId: string, clusterId: string, similarity = 0.9): ClusterAssignment => ({ faceId, assetId: 'asset', clusterId, similarity, qualityScore: 1 });

describe('couple-photo query', () => {
  const identity = new Map<string, PartnerLabel>([['cluster-0', 'A'], ['cluster-1', 'B']]);

  it('qualifies a two-face photo with both partners', () => {
    const [result] = findCouplePhotos({
      assets: [{ assetId: 'p1', faces: [face('f1', unit(0)), face('f2', unit(1))] }],
      assignments: new Map([['f1', assignment('f1', 'cluster-0')], ['f2', assignment('f2', 'cluster-1')]]),
      identityByCluster: identity,
    });
    expect(result.decision).toBe('pair');
    expect(result.bestA?.faceId).toBe('f1');
    expect(result.bestB?.faceId).toBe('f2');
  });

  it('qualifies a group photo with unrelated faces', () => {
    const [result] = findCouplePhotos({
      assets: [{ assetId: 'p1', faces: [face('f1', unit(0)), face('f2', unit(1)), face('f3', unit(2))] }],
      assignments: new Map([['f1', assignment('f1', 'cluster-0')], ['f2', assignment('f2', 'cluster-1')]]),
      identityByCluster: identity,
    });
    expect(result.decision).toBe('pair');
    expect(result.detectedFaces).toBe(3);
    expect(result.faceDecisions).toHaveLength(3);
    expect(result.faceDecisions[2].person).toBeNull();
  });

  it('never counts one face as both partners', () => {
    const [result] = findCouplePhotos({
      assets: [{ assetId: 'p1', faces: [face('f1', unit(0))] }],
      assignments: new Map([['f1', assignment('f1', 'cluster-0')]]),
      identityByCluster: identity,
    });
    expect(result.decision).toBe('unsure');
    expect(result.reason).toContain('Only one partner');
  });

  it('reports a face-free asset distinctly', () => {
    const [result] = findCouplePhotos({ assets: [{ assetId: 'p1', faces: [] }], assignments: new Map(), identityByCluster: identity });
    expect(result).toMatchObject({ decision: 'no-faces', detectedFaces: 0, reason: 'No faces detected' });
  });

  it('reports when no partner identity was identified', () => {
    const [result] = findCouplePhotos({
      assets: [{ assetId: 'p1', faces: [face('f1', unit(0)), face('f2', unit(1))] }],
      assignments: new Map([['f1', assignment('f1', 'cluster-0')], ['f2', assignment('f2', 'cluster-1')]]),
      identityByCluster: new Map(),
    });
    expect(result.decision).toBe('unsure');
    expect(result.reason).toContain('No partner identity');
  });

  it('drops low-similarity assignments when a floor is supplied', () => {
    const [result] = findCouplePhotos({
      assets: [{ assetId: 'p1', faces: [face('f1', unit(0)), face('f2', unit(1))] }],
      assignments: new Map([['f1', assignment('f1', 'cluster-0', 0.3)], ['f2', assignment('f2', 'cluster-1', 0.95)]]),
      identityByCluster: identity,
      minSimilarity: 0.5,
    });
    expect(result.decision).toBe('unsure');
    expect(result.reason).toContain('Only one partner');
  });

  it('rejects an invalid similarity floor', () => {
    expect(() => findCouplePhotos({ assets: [], assignments: new Map(), identityByCluster: identity, minSimilarity: 2 })).toThrow(RangeError);
  });
});

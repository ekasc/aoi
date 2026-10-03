import { describe, expect, it } from 'vitest';

import { createIndexedFace } from '@/features/face-index/embedding';
import { createFaceIndex } from '@/features/face-index/face-index';
import { face, unit } from './helpers';

describe('local face index', () => {
  it('stores many faces per asset and returns them in insertion order', () => {
    const index = createFaceIndex('sface:test');
    index.add(face('f1', unit(0), { assetId: 'photo-1' }));
    index.add(face('f2', unit(1), { assetId: 'photo-1' }));
    index.add(face('f3', unit(2), { assetId: 'photo-2' }));
    expect(index.size()).toBe(3);
    expect(index.facesForAsset('photo-1').map((item) => item.faceId)).toEqual(['f1', 'f2']);
    expect(index.facesForAsset('photo-2').map((item) => item.faceId)).toEqual(['f3']);
    expect(index.facesForAsset('missing')).toEqual([]);
  });

  it('rejects malformed and duplicate faces instead of throwing', () => {
    const index = createFaceIndex('sface:test');
    expect(index.add(face('f1', unit(0)))).toBe(true);
    expect(index.add(face('f1', unit(1)))).toBe(false);
    expect(index.add(face('bad', new Float32Array(128)))).toBe(false);
    expect(index.add(face('nan', Float32Array.from({ length: 128 }, (_, i) => (i === 0 ? Number.NaN : 0))))).toBe(false);
    expect(index.size()).toBe(1);
    expect(index.rejectedCount()).toBe(3);
  });

  it('normalizes the embedding stored', () => {
    const index = createFaceIndex('sface:test');
    const created = createIndexedFace({ faceId: 'f1', assetId: 'a', embedding: unit(0), detectionScore: 1 });
    expect(created).not.toBeNull();
    if (created) index.add(created);
    expect(Math.hypot(...(index.facesForAsset('a')[0]?.embedding ?? []))).toBeCloseTo(1, 6);
  });

  it('clears everything when the recognition model changes', () => {
    const index = createFaceIndex('model-v1');
    index.add(face('f1', unit(0)));
    expect(index.modelMatches('model-v1')).toBe(true);
    expect(index.modelMatches('model-v2')).toBe(false);
    expect(index.resetForModel('model-v1')).toBe(false);
    expect(index.size()).toBe(1);
    expect(index.resetForModel('model-v2')).toBe(true);
    expect(index.size()).toBe(0);
    expect(index.facesForAsset('asset-f1')).toEqual([]);
    expect(index.modelId).toBe('model-v2');
  });

  it('requires a model identity', () => {
    expect(() => createFaceIndex('')).toThrow();
  });
});

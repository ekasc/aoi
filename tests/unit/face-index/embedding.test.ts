import { describe, expect, it } from 'vitest';

import { createIndexedFace, normalizeEmbedding } from '@/features/face-index/embedding';
import { vector } from './helpers';

const f32 = (...values: number[]) => Float32Array.from(values);

describe('embedding validation and normalization', () => {
  it('unit-normalizes a finite vector', () => {
    const normalized = normalizeEmbedding(f32(3, 4), 2);
    expect(normalized).not.toBeNull();
    expect(normalized?.[0]).toBeCloseTo(0.6, 6);
    expect(normalized?.[1]).toBeCloseTo(0.8, 6);
    expect(Math.hypot(...(normalized ?? []))).toBeCloseTo(1, 6);
  });

  it('rejects wrong dimensions, non-Float32 input, zero vectors, NaN and Infinity', () => {
    expect(normalizeEmbedding(f32(1, 0), 3)).toBeNull();
    expect(normalizeEmbedding([1, 0], 2)).toBeNull();
    expect(normalizeEmbedding(f32(0, 0), 2)).toBeNull();
    expect(normalizeEmbedding(f32(Number.NaN, 1), 2)).toBeNull();
    expect(normalizeEmbedding(f32(Number.POSITIVE_INFINITY, 1), 2)).toBeNull();
    expect(normalizeEmbedding(f32(1e-20, 0), 2)).toBeNull();
  });

  it('rejects malformed face records at the constructor boundary', () => {
    const valid = { faceId: 'f1', assetId: 'a1', embedding: vector([1, 0, 0]), detectionScore: 0.9 };
    expect(createIndexedFace(valid)).not.toBeNull();
    expect(createIndexedFace({ ...valid, faceId: '' })).toBeNull();
    expect(createIndexedFace({ ...valid, assetId: '' })).toBeNull();
    expect(createIndexedFace({ ...valid, embedding: vector([0, 0, 0]) })).toBeNull();
    expect(createIndexedFace({ ...valid, embedding: vector([Number.NaN, 1, 0]) })).toBeNull();
    expect(createIndexedFace({ ...valid, detectionScore: 1.2 })).toBeNull();
    expect(createIndexedFace({ ...valid, detectionScore: Number.NaN })).toBeNull();
    expect(createIndexedFace({ ...valid, qualityScore: -0.1 })).toBeNull();
  });

  it('normalizes the embedding it stores', () => {
    const created = createIndexedFace({ faceId: 'f1', assetId: 'a1', embedding: vector([3, 4, 0]), detectionScore: 1 });
    expect(created).not.toBeNull();
    expect(Math.hypot(...(created?.embedding ?? []))).toBeCloseTo(1, 6);
  });
});

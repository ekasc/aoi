import { describe, expect, it } from 'vitest';

import { fitFaceAlignment, SFACE_TEMPLATE, transformFacePoint } from '@/features/album/face-alignment';
import type { FiveFaceLandmarks } from '@/features/album/face-landmarks';

describe('SFace similarity alignment', () => {
  it('leaves the reference landmarks unchanged', () => {
    expect(fitFaceAlignment(SFACE_TEMPLATE)).toEqual({ a: 1, b: 0, tx: 0, ty: 0 });
  });

  it.each([
    { a: 1.5, b: 0, tx: 10, ty: 40 },
    { a: 1.15, b: 0.3, tx: 40, ty: 10 },
    { a: 1.2, b: -0.4, tx: 20, ty: 45 },
  ])('recovers scale, rotation, and translation', (applied) => {
    const source: FiveFaceLandmarks = [
      transformFacePoint(SFACE_TEMPLATE[0], applied), transformFacePoint(SFACE_TEMPLATE[1], applied),
      transformFacePoint(SFACE_TEMPLATE[2], applied), transformFacePoint(SFACE_TEMPLATE[3], applied), transformFacePoint(SFACE_TEMPLATE[4], applied),
    ];
    const fit = fitFaceAlignment(source);
    expect(fit).not.toBeNull();
    if (!fit) throw new Error('Missing alignment fit');
    source.forEach((point, index) => {
      const actual = transformFacePoint(point, fit);
      expect(actual.x).toBeCloseTo(SFACE_TEMPLATE[index].x, 8);
      expect(actual.y).toBeCloseTo(SFACE_TEMPLATE[index].y, 8);
    });
  });

  it('rejects collapsed and nonfinite inputs', () => {
    const point = { x: 10, y: 10 };
    expect(fitFaceAlignment([point, point, point, point, point])).toBeNull();
    expect(fitFaceAlignment([{ x: NaN, y: 10 }, SFACE_TEMPLATE[1], SFACE_TEMPLATE[2], SFACE_TEMPLATE[3], SFACE_TEMPLATE[4]])).toBeNull();
  });
});

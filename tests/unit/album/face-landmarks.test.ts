import { describe, expect, it } from 'vitest';

import { fiveFaceLandmarks, parseFaceLandmarkRegions, type FaceLandmarkRegions, type FacePoint } from '@/features/album/face-landmarks';
import { parseDetectedPhotoFaces } from '@/features/album/photo-face-detector';

const regions: FaceLandmarkRegions = {
  leftEye: [{ x: 18, y: 30 }, { x: 22, y: 30 }],
  rightEye: [{ x: 68, y: 30 }, { x: 72, y: 30 }],
  noseCrest: [{ x: 45, y: 35 }, { x: 45, y: 50 }],
  outerLips: [{ x: 30, y: 65 }, { x: 45, y: 60 }, { x: 60, y: 65 }, { x: 45, y: 70 }],
};
const expected = [{ x: 20, y: 30 }, { x: 70, y: 30 }, { x: 45, y: 50 }, { x: 30, y: 65 }, { x: 60, y: 65 }];

describe('five-point alignment landmark estimates', () => {
  it('orders eye centers, nose crest tip, and mouth corners in image-left convention', () => {
    expect(fiveFaceLandmarks(regions)).toEqual(expected);
  });

  it('does not depend on anatomical left/right region names', () => {
    expect(fiveFaceLandmarks({ ...regions, leftEye: regions.rightEye, rightEye: regions.leftEye })).toEqual(expected);
  });

  it('selects nose and mouth points along the eye axes rather than image x/y extrema', () => {
    const rotate = ({ x, y }: FacePoint) => ({ x: 200 + x * Math.cos(Math.PI / 6) - y * Math.sin(Math.PI / 6), y: 100 + x * Math.sin(Math.PI / 6) + y * Math.cos(Math.PI / 6) });
    const tilted: FaceLandmarkRegions = {
      leftEye: regions.leftEye.map(rotate), rightEye: regions.rightEye.map(rotate),
      noseCrest: regions.noseCrest.map(rotate), outerLips: regions.outerLips.map(rotate),
    };
    const result = fiveFaceLandmarks(tilted);
    expect(result).not.toBeNull();
    expected.map(rotate).forEach((point, index) => {
      expect(result?.[index].x).toBeCloseTo(point.x);
      expect(result?.[index].y).toBeCloseTo(point.y);
    });
  });

  it.each(['leftEye', 'rightEye', 'noseCrest', 'outerLips'] as const)('does not invent a missing %s region', (key) => {
    expect(fiveFaceLandmarks({ ...regions, [key]: [] })).toBeNull();
  });

  it('refuses collapsed eye or mouth geometry', () => {
    expect(fiveFaceLandmarks({ ...regions, rightEye: regions.leftEye })).toBeNull();
    expect(fiveFaceLandmarks({ ...regions, outerLips: [{ x: 45, y: 65 }, { x: 45, y: 65 }] })).toBeNull();
  });

  it('refuses a nose above the eyes or mouth above the nose', () => {
    expect(fiveFaceLandmarks({ ...regions, noseCrest: [{ x: 45, y: 20 }] })).toBeNull();
    expect(fiveFaceLandmarks({ ...regions, outerLips: [{ x: 30, y: 45 }, { x: 60, y: 45 }] })).toBeNull();
  });

  it('preserves caller contours and their ordering', () => {
    const before = JSON.stringify(regions);
    fiveFaceLandmarks(regions);
    expect(JSON.stringify(regions)).toBe(before);
  });
});

describe('landmark bridge validation', () => {
  it('retains original corners when an unused lower-lip point extends beyond the crop', () => {
    const cropped = { ...regions, outerLips: [...regions.outerLips, { x: 45, y: 114 }] };
    const parsed = parseFaceLandmarkRegions(cropped, 100, 100);
    expect(parsed).toEqual(cropped);
    expect(parsed && fiveFaceLandmarks(parsed)).toEqual(expected);
  });

  it('does not clip or invent an out-of-image mouth corner', () => {
    expect(parseFaceLandmarkRegions({ ...regions, outerLips: [...regions.outerLips, { x: -5, y: 65 }] }, 100, 100)).toBeNull();
    expect(() => parseFaceLandmarkRegions({ ...regions, outerLips: [{ x: 45, y: Infinity }] }, 100, 100)).toThrow();
  });
  it('keeps missing landmarks distinct from invalid data', () => {
    expect(parseFaceLandmarkRegions(null, 100, 100)).toBeNull();
    expect(() => parseFaceLandmarkRegions({}, 100, 100)).toThrow('Invalid face landmarks');
    expect(parseFaceLandmarkRegions(regions, 100, 100)).toEqual(regions);
  });

  it.each([
    [{ x: NaN, y: 30 }], [{ x: 20, y: Infinity }], [{ x: -1, y: 30 }], [{ x: 101, y: 30 }],
    [{ x: 20, y: 101 }], [{ x: '20', y: 30 }], [null], null,
  ])('rejects invalid or out-of-image native points', (leftEye) => {
    expect(() => parseFaceLandmarkRegions({ ...regions, leftEye }, 100, 100)).toThrow('Invalid face landmarks');
  });

  it('adds landmarks to detector boxes while retaining boxes when landmarks are absent', () => {
    const face = { x: 0, y: 0, width: 100, height: 100, rollAngle: null };
    const result = parseDetectedPhotoFaces({ width: 100, height: 100, faces: [{ ...face, landmarkRegions: regions }, face] });
    expect(result.faces[0].landmarks).toEqual(expected);
    expect(result.faces[1]).toEqual({ ...face, landmarks: null });
  });

  it('marks missing contours unsuitable for alignment without hiding the detected face', () => {
    const result = parseDetectedPhotoFaces({ width: 100, height: 100, faces: [{ x: 0, y: 0, width: 100, height: 100, rollAngle: null, landmarkRegions: { ...regions, noseCrest: [] } }] });
    expect(result.faces).toHaveLength(1);
    expect(result.faces[0].landmarks).toBeNull();
  });
});

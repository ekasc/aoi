export type FacePoint = { x: number; y: number };
export type FaceLandmarkRegions = {
  leftEye: FacePoint[];
  rightEye: FacePoint[];
  noseCrest: FacePoint[];
  outerLips: FacePoint[];
};

/** Image-left to image-right, not anatomical left/right. All points are oriented pixels. */
export type FiveFaceLandmarks = readonly [
  leftEye: FacePoint, rightEye: FacePoint, nose: FacePoint,
  leftMouth: FacePoint, rightMouth: FacePoint,
];

/** Estimates the five-point convention from Vision contours; reference parity is unverified. */
export function fiveFaceLandmarks(regions: FaceLandmarkRegions): FiveFaceLandmarks | null {
  if (!regions.leftEye.length || !regions.rightEye.length || !regions.noseCrest.length || regions.outerLips.length < 2) return null;
  const center = (points: FacePoint[]): FacePoint => ({
    x: points.reduce((sum, point) => sum + point.x, 0) / points.length,
    y: points.reduce((sum, point) => sum + point.y, 0) / points.length,
  });
  const eyes = [center(regions.leftEye), center(regions.rightEye)].sort((a, b) => a.x - b.x);
  const [leftEye, rightEye] = eyes;
  const dx = rightEye.x - leftEye.x;
  const dy = rightEye.y - leftEye.y;
  const distance = Math.hypot(dx, dy);
  if (dx <= 0 || !Number.isFinite(distance) || distance === 0) return null;
  const horizontal = (point: FacePoint) => ((point.x - leftEye.x) * dx + (point.y - leftEye.y) * dy) / distance;
  const vertical = (point: FacePoint) => (-(point.x - leftEye.x) * dy + (point.y - leftEye.y) * dx) / distance;
  const nose = regions.noseCrest.reduce((best, point) => vertical(point) > vertical(best) ? point : best);
  const leftMouth = regions.outerLips.reduce((best, point) => horizontal(point) < horizontal(best) ? point : best);
  const rightMouth = regions.outerLips.reduce((best, point) => horizontal(point) > horizontal(best) ? point : best);
  if (vertical(nose) <= 0 || vertical(leftMouth) <= vertical(nose) || vertical(rightMouth) <= vertical(nose)
    || horizontal(rightMouth) <= horizontal(leftMouth)) return null;
  return [leftEye, rightEye, nose, leftMouth, rightMouth];
}

export function parseFaceLandmarkRegions(value: unknown, width: number, height: number): FaceLandmarkRegions | null {
  if (value === null) return null;
  if (!value || typeof value !== 'object' || !('leftEye' in value) || !('rightEye' in value)
    || !('noseCrest' in value) || !('outerLips' in value)) throw new Error('Invalid face landmarks');
  const points = (region: unknown, allowOutside = false): FacePoint[] => {
    if (!Array.isArray(region)) throw new Error('Invalid face landmarks');
    return region.map((point: unknown) => {
      if (!point || typeof point !== 'object' || !('x' in point) || !('y' in point)
        || typeof point.x !== 'number' || !Number.isFinite(point.x)
        || typeof point.y !== 'number' || !Number.isFinite(point.y)
        || (!allowOutside && (point.x < 0 || point.x > width || point.y < 0 || point.y > height))) {
        throw new Error('Invalid face landmarks');
      }
      return { x: point.x, y: point.y };
    });
  };
  // Vision can extend the lower lip beyond a crop while both mouth corners remain visible.
  const regions = { leftEye: points(value.leftEye), rightEye: points(value.rightEye), noseCrest: points(value.noseCrest), outerLips: points(value.outerLips, true) };
  const alignment = fiveFaceLandmarks(regions);
  if (alignment?.some((point) => point.x < 0 || point.x > width || point.y < 0 || point.y > height)) return null;
  return regions;
}

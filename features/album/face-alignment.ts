import type { FacePoint, FiveFaceLandmarks } from '@/features/album/face-landmarks';

export const SFACE_SIZE = 112;
export const SFACE_TEMPLATE: FiveFaceLandmarks = [
  { x: 38.2946, y: 51.6963 }, { x: 73.5318, y: 51.5014 }, { x: 56.0252, y: 71.7366 },
  { x: 41.5493, y: 92.3655 }, { x: 70.7299, y: 92.2041 },
];

/** x' = a*x - b*y + tx; y' = b*x + a*y + ty. No reflection. */
export type FaceTransform = { a: number; b: number; tx: number; ty: number };

export function transformFacePoint(point: FacePoint, transform: FaceTransform): FacePoint {
  return { x: transform.a * point.x - transform.b * point.y + transform.tx, y: transform.b * point.x + transform.a * point.y + transform.ty };
}

/** Least-squares, orientation-preserving similarity fit to OpenCV's five-point template. */
export function fitFaceAlignment(source: FiveFaceLandmarks): FaceTransform | null {
  if (!source.every((point) => Number.isFinite(point.x) && Number.isFinite(point.y))) return null;
  const mean = (points: FiveFaceLandmarks) => ({ x: points.reduce((sum, p) => sum + p.x, 0) / 5, y: points.reduce((sum, p) => sum + p.y, 0) / 5 });
  const src = mean(source);
  const dst = mean(SFACE_TEMPLATE);
  let variance = 0;
  let real = 0;
  let imaginary = 0;
  source.forEach((point, index) => {
    const x = point.x - src.x;
    const y = point.y - src.y;
    const u = SFACE_TEMPLATE[index].x - dst.x;
    const v = SFACE_TEMPLATE[index].y - dst.y;
    variance += x * x + y * y;
    real += x * u + y * v;
    imaginary += x * v - y * u;
  });
  if (variance === 0 || !Number.isFinite(variance)) return null;
  const a = real / variance;
  const b = imaginary / variance;
  if (!Number.isFinite(a) || !Number.isFinite(b) || a * a + b * b < 1e-12) return null;
  return { a, b, tx: dst.x - a * src.x + b * src.y, ty: dst.y - b * src.x - a * src.y };
}

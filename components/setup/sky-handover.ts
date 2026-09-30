export const SETUP_SKY_PEAK = 0.85;
export const SKY_LIFT_MS = 720;
export const SKY_CLEAR_FRACTION = 0.14;

export function skyBottomFeather(progress: number) {
  'worklet';
  if (progress <= 0 || progress >= 1) return 0;
  return Math.sin(Math.PI * progress) * 0.26;
}

function cameraProgress(progress: number) {
  'worklet';
  const t = Math.min(1, Math.max(0, progress));
  return t * t * t * (t * (t * 6 - 15) + 10);
}

export function settlingSkyHeight(progress: number, source: number, destination: number) {
  'worklet';
  return source + (destination - source) * cameraProgress(progress);
}

export function blendSkyUniforms(
  from: Record<string, number | number[]>,
  to: Record<string, number | number[]>,
  progress: number,
) {
  'worklet';
  const t = cameraProgress(progress);
  const result: Record<string, number | number[]> = {};
  for (const key of Object.keys(from)) {
    const a = from[key];
    const b = to[key];
    if (typeof a === 'number' && typeof b === 'number') {
      result[key] = a + (b - a) * t;
    } else if (Array.isArray(a) && Array.isArray(b)) {
      result[key] = a.map((value, index) => value + (b[index] - value) * t);
    }
  }
  return result;
}

export function skyArrivalStyle(progress: number) {
  'worklet';
  const t = Math.min(1, Math.max(0, progress));
  const eased = cameraProgress(t);
  return {
    opacity: Math.min(1, Math.max(0, (t - SKY_CLEAR_FRACTION) / 0.14)),
    transform: [{ translateY: 28 * (1 - eased) }],
  };
}

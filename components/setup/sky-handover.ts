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

/**
 * The arrival into the archive, staged in depth.
 *
 * Entering the home screen for the first time used to be one 240ms dissolve of
 * everything at once, which is a screen swapping rather than a place being
 * entered. The three things that make the room arrive on separate clocks
 * instead: the sky settles first and lands, the ground follows it in, and the
 * words come last, once there is something to read them against.
 *
 * The windows are fractions of one master clock rather than three separate
 * animations, so the whole arrival is one gesture and can be interrupted or
 * reversed as a unit. Overlapping windows are deliberate: nothing waits for
 * anything else to finish.
 */
export const SKY_ARRIVAL_MS = 420;

/** Where the sky lands. The haptic fires here, not at the end. */
export const SKY_LANDED_AT = 0.55;

export const ARRIVAL_WINDOWS = {
  /** The invitation lifts away first, clearing the room for the archive. */
  invitation: [0, 0.35],
  /** The sky contracts into the header and stops. */
  sky: [0, SKY_LANDED_AT],
  /** The ground rises to meet the header once it has landed. */
  ground: [0.18, 0.8],
  /** The words, last, so they are read into a room rather than a void. */
  words: [0.5, 1],
} as const;

/**
 * A window of the master clock, eased, clamped to 0..1.
 *
 * Every layer reads the same number and each takes its own slice of it, which
 * is what keeps the staging in one place instead of scattered across the
 * components that happen to be moving.
 */
export function arrivalWindow(progress: number, from: number, to: number) {
  'worklet';
  const t = Math.min(1, Math.max(0, progress));
  if (to <= from) return t >= to ? 1 : 0;
  const local = Math.min(1, Math.max(0, (t - from) / (to - from)));
  return cameraProgress(local);
}

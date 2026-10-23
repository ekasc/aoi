export function splashPhase(progress: number, start: number, end: number) {
  'worklet';
  const t = Math.min(1, Math.max(0, (progress - start) / (end - start)));
  return t * t * (3 - 2 * t);
}

function bezierPoint(t: number, partner: boolean) {
  'worklet';
  const s = 1 - t;
  return partner ? {
    x: s * s * s * 228 + 3 * s * s * t * 230 + 3 * s * t * t * 187 + t * t * t * 168,
    y: s * s * s * 34 + 3 * s * s * t * 94 + 3 * s * t * t * 119 + t * t * t * 64,
  } : {
    x: s * s * s * 34 + 3 * s * s * t * 29 + 3 * s * t * t * 111 + t * t * t * 105,
    y: s * s * s * 48 + 3 * s * s * t * 135 + 3 * s * t * t * 144 + t * t * t * 101,
  };
}

function flightPhase(progress: number, partner: boolean) {
  'worklet';
  return splashPhase(progress, partner ? 0.08 : 0, partner ? 0.74 : 0.66);
}

export function cometPoint(progress: number, partner: boolean) {
  'worklet';
  return bezierPoint(flightPhase(progress, partner), partner);
}

function lengthTable(partner: boolean) {
  const lengths = [0];
  let previous = bezierPoint(0, partner);
  for (let index = 1; index <= 64; index++) {
    const point = bezierPoint(index / 64, partner);
    lengths.push(lengths[index - 1] + Math.hypot(point.x - previous.x, point.y - previous.y));
    previous = point;
  }
  return lengths.map(length => length / lengths[64]);
}

const LENGTHS = lengthTable(false);
const PARTNER_LENGTHS = lengthTable(true);

export function cometTrim(progress: number, partner: boolean) {
  'worklet';
  // Skia trims by arc length, not by the Bezier parameter used to position the light.
  const scaled = flightPhase(progress, partner) * 64;
  const index = Math.min(63, Math.floor(scaled));
  const lengths = partner ? PARTNER_LENGTHS : LENGTHS;
  return lengths[index] + (lengths[index + 1] - lengths[index]) * (scaled - index);
}

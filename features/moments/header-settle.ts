/**
 * Settle rule for the scroll-linked Memories header: when a scroll comes to
 * rest mid-condense, snap to an endpoint so the header never parks half-shed
 * (tabs half-faded and clipped). Below the shed distance the header always
 * reopens — settling condensed there would strand a negative linkage origin
 * and rest the top slightly shut. At/above it, snap to the nearer endpoint.
 * Resting endpoints and overshoot pass through as null — nothing to do.
 */
export function settleTargetForProgress(
  progress: number,
  offsetY: number,
  collapseDistance: number,
): 0 | 1 | null {
  if (![progress, offsetY, collapseDistance].every(Number.isFinite)) {
    return null;
  }
  if (progress <= 0 || progress >= 1) {
    return null;
  }
  if (offsetY < collapseDistance) {
    return 0;
  }
  return progress < 0.5 ? 0 : 1;
}

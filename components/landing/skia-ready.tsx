import type { ReactNode } from 'react';

/**
 * Native: Skia is always ready — render the scene immediately.
 * See skia-ready.web.tsx for the CanvasKit loading gate.
 */
export function SkiaReady({ children }: { children: (ready: boolean) => ReactNode }) {
  return <>{children(true)}</>;
}

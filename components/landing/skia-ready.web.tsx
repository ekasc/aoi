import { useEffect, useState, type ReactNode } from 'react';

import { LoadSkiaWeb } from '@shopify/react-native-skia/lib/module/web/LoadSkiaWeb';

/**
 * Web: CanvasKit (WebAssembly) must load before any Skia canvas can
 * render. The binary is self-hosted at /canvaskit/canvaskit.wasm so web
 * captures and production web builds never depend on a CDN.
 */
export function SkiaReady({ children }: { children: (ready: boolean) => ReactNode }) {
  const [ready, setReady] = useState(false);

  useEffect(() => {
    let live = true;
    LoadSkiaWeb({
      locateFile: (file: string) => `/canvaskit/${file}`,
    })
      .then(() => {
        if (live) {
          setReady(true);
        }
      })
      .catch(() => {
        // Scene stays hidden rather than rendering broken.
      });
    return () => {
      live = false;
    };
  }, []);

  return <>{children(ready)}</>;
}

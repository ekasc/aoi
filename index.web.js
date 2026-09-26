import { LoadSkiaWeb } from '@shopify/react-native-skia/lib/module/web/LoadSkiaWeb';

// Skia captures CanvasKit when imported. Load it before Router imports screens.
LoadSkiaWeb({ locateFile: (file) => `/canvaskit/${file}` })
  .then(() => require('expo-router/entry'))
  .catch((error) => {
    console.error('Unable to initialize the web renderer', error);
    document.body.textContent = 'Aoi could not load. Check your connection and reload.';
  });

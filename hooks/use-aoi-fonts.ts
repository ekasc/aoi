import { useFonts } from 'expo-font';

import { FontFamilies } from '@/constants/typography';

export function useAoiFonts() {
  const [loaded, error] = useFonts({
    [FontFamilies.display]: require('../assets/fonts/aoi-display-newyork.ttf'),
    [FontFamilies.body]: require('../assets/fonts/aoi-body-trebuchet.ttf'),
    [FontFamilies.meta]: require('../assets/fonts/aoi-meta-mono.ttf'),
  });

  return {
    fontsLoaded: loaded || Boolean(error),
    fontError: error ?? null,
  };
}

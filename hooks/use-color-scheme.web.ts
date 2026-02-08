import { useEffect, useState } from 'react';
import { useColorScheme as useNativeColorScheme } from 'react-native';

export function useColorScheme() {
  const [hasHydrated, setHasHydrated] = useState(false);

  useEffect(() => {
    setHasHydrated(true);
  }, []);

  const colorScheme = useNativeColorScheme();

  if (!hasHydrated) {
    return 'light';
  }

  return colorScheme;
}

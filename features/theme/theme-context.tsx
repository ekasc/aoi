import AsyncStorage from '@react-native-async-storage/async-storage';
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type PropsWithChildren,
} from 'react';

import {
  BeachThemes,
  DEFAULT_BEACH_THEME_ID,
  type BeachThemeColors,
  type BeachThemeId,
  type ThemeMode,
} from '@/constants/theme-presets';
import { useColorScheme } from '@/hooks/use-color-scheme';

const THEME_STORAGE_KEY = 'aoi.theme-preset.v1';

function isBeachThemeId(value: string): value is BeachThemeId {
  return value in BeachThemes;
}

type AoiThemeContextValue = {
  selectedThemeId: BeachThemeId;
  selectedTheme: (typeof BeachThemes)[BeachThemeId];
  mode: ThemeMode;
  colors: BeachThemeColors;
  hasStoredSelection: boolean;
  isHydrated: boolean;
  setSelectedThemeId: (themeId: BeachThemeId) => Promise<void>;
};

const ThemeContext = createContext<AoiThemeContextValue | undefined>(undefined);

export function AoiThemeProvider({ children }: PropsWithChildren) {
  const colorScheme = useColorScheme();
  const mode: ThemeMode = colorScheme === 'dark' ? 'dark' : 'light';
  const [selectedThemeId, setSelectedThemeIdState] = useState<BeachThemeId>(
    DEFAULT_BEACH_THEME_ID
  );
  const [hasStoredSelection, setHasStoredSelection] = useState(false);
  const [isHydrated, setIsHydrated] = useState(false);

  useEffect(() => {
    let isActive = true;

    async function hydrateTheme() {
      try {
        const storedThemeId = await AsyncStorage.getItem(THEME_STORAGE_KEY);
        if (!isActive || !storedThemeId) {
          return;
        }

        if (isBeachThemeId(storedThemeId)) {
          setSelectedThemeIdState(storedThemeId);
          setHasStoredSelection(true);
        } else {
          await AsyncStorage.removeItem(THEME_STORAGE_KEY);
        }
      } catch {
        if (!isActive) {
          return;
        }
      } finally {
        if (isActive) {
          setIsHydrated(true);
        }
      }
    }

    void hydrateTheme();

    return () => {
      isActive = false;
    };
  }, []);

  useEffect(() => {
    if (!isHydrated || !hasStoredSelection) {
      return;
    }

    void AsyncStorage.setItem(THEME_STORAGE_KEY, selectedThemeId).catch(() => {});
  }, [hasStoredSelection, isHydrated, selectedThemeId]);

  const setSelectedThemeId = useCallback(async (themeId: BeachThemeId) => {
    setSelectedThemeIdState(themeId);
    setHasStoredSelection(true);
  }, []);

  const selectedTheme = BeachThemes[selectedThemeId];
  const colors = selectedTheme[mode];

  const value = useMemo<AoiThemeContextValue>(
    () => ({
      selectedThemeId,
      selectedTheme,
      mode,
      colors,
      hasStoredSelection,
      isHydrated,
      setSelectedThemeId,
    }),
    [
      selectedThemeId,
      selectedTheme,
      mode,
      colors,
      hasStoredSelection,
      isHydrated,
      setSelectedThemeId,
    ]
  );

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

export function useAoiTheme() {
  const context = useContext(ThemeContext);

  if (!context) {
    throw new Error('useAoiTheme must be used within AoiThemeProvider');
  }

  return context;
}

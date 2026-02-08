import { DarkTheme, DefaultTheme, ThemeProvider } from '@react-navigation/native';
import { Stack } from 'expo-router/stack';
import * as SplashScreen from 'expo-splash-screen';
import { StatusBar } from 'expo-status-bar';
import { useEffect, useMemo } from 'react';

import { Colors } from '@/constants/theme';
import { SessionProvider } from '@/features/session/session-context';
import { useAoiFonts } from '@/hooks/use-aoi-fonts';
import { useColorScheme } from '@/hooks/use-color-scheme';

void SplashScreen.preventAutoHideAsync().catch(() => {});

export default function RootLayout() {
  const colorScheme = useColorScheme();
  const themeName = colorScheme === 'dark' ? 'dark' : 'light';
  const { fontsLoaded } = useAoiFonts();

  const navigationTheme = useMemo(() => {
    const baseTheme = themeName === 'dark' ? DarkTheme : DefaultTheme;

    return {
      ...baseTheme,
      colors: {
        ...baseTheme.colors,
        primary: Colors[themeName].accent,
        background: Colors[themeName].background,
        card: Colors[themeName].surface,
        text: Colors[themeName].text,
        border: Colors[themeName].border,
        notification: Colors[themeName].danger,
      },
    };
  }, [themeName]);

  useEffect(() => {
    if (!fontsLoaded) {
      return;
    }

    void SplashScreen.hideAsync().catch(() => {});
  }, [fontsLoaded]);

  if (!fontsLoaded) {
    return null;
  }

  return (
    <SessionProvider>
      <ThemeProvider value={navigationTheme}>
        <Stack>
          <Stack.Screen name="(public)" options={{ headerShown: false }} />
          <Stack.Screen name="(auth)" options={{ headerShown: false }} />
          <Stack.Screen name="(app)" options={{ headerShown: false }} />
        </Stack>
        <StatusBar style={themeName === 'dark' ? 'light' : 'dark'} />
      </ThemeProvider>
    </SessionProvider>
  );
}

import Constants from "expo-constants";
import { Redirect, useSegments } from 'expo-router';
import { Stack } from 'expo-router/stack';

import { useSession } from '@/features/session/session-context';
import { useSpace } from '@/features/space/space-context';
import { useAoiTheme } from '@/features/theme/theme-context';

export default function AuthLayout() {
  const isIos = process.env.EXPO_OS === 'ios';
  const isExpoGo = Constants.appOwnership === 'expo';
  const useFormSheet = isIos && !isExpoGo;
  const { status, isHydrated: isSessionHydrated } = useSession();
  const { status: spaceStatus, isHydrated: isSpaceHydrated } = useSpace();
  const { colors, hasStoredSelection, isHydrated: isThemeHydrated } = useAoiTheme();
  const segments = useSegments();
  const routeName = segments[segments.length - 1];
  const isSignInRoute = routeName === 'sign-in';
  const isVerifyRoute = routeName === 'verify-code';
  const isThemeSelectRoute = routeName === 'theme-select';
  const isSpaceSetupRoute = routeName === 'space-setup';
  const isSpaceImportRoute = routeName === 'space-import';
  const isSignedInOnlyRoute =
    isThemeSelectRoute || isSpaceSetupRoute || isSpaceImportRoute;

  if (!isSessionHydrated || status === 'loading') {
    return null;
  }

  if (status === 'signed_out') {
    if (isSignedInOnlyRoute) {
      return <Redirect href="/(public)" />;
    }
  }

  if (status === 'signed_in') {
    if (!isSpaceHydrated || !isThemeHydrated) {
      return null;
    }

    if (isSignInRoute || isVerifyRoute) {
      if (spaceStatus !== 'ready') {
        return <Redirect href="/(auth)/space-setup" />;
      }

      if (!hasStoredSelection) {
        return <Redirect href="/(auth)/theme-select" />;
      }

      return <Redirect href="/(app)/(tabs)" />;
    }

    if (spaceStatus !== 'ready') {
      if (!isSpaceSetupRoute) {
        return <Redirect href="/(auth)/space-setup" />;
      }
    } else if (!hasStoredSelection) {
      if (!isThemeSelectRoute && !isSpaceImportRoute) {
        return <Redirect href="/(auth)/theme-select" />;
      }
    } else {
      return <Redirect href="/(app)/(tabs)" />;
    }
  }

  return (
    <Stack
      screenOptions={{
        contentStyle: { backgroundColor: colors.background },
        headerStyle: { backgroundColor: colors.surface },
        headerTintColor: colors.text,
      }}
    >
      <Stack.Screen name="sign-in" options={{ title: 'Sign in' }} />
      <Stack.Screen name="verify-code" options={{ title: 'Verify code' }} />
      <Stack.Screen name="space-setup" options={{ title: 'Relationship setup' }} />
      <Stack.Screen
        name="space-import"
        options={{
          title: 'Import milestones',
          presentation: useFormSheet ? 'formSheet' : 'modal',
          ...(useFormSheet
            ? {
                sheetGrabberVisible: true,
                sheetAllowedDetents: [0.55, 1.0],
                contentStyle: { backgroundColor: colors.background },
              }
            : {}),
        }}
      />
      <Stack.Screen name="theme-select" options={{ title: 'Theme' }} />
    </Stack>
  );
}

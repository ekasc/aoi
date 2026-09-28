import { Redirect, useSegments } from 'expo-router';
import { Stack } from 'expo-router/stack';

import { useSession } from '@/features/session/session-context';
import { useSpace } from '@/features/space/space-context';
import { useAoiTheme } from '@/features/theme/theme-context';

export default function AuthLayout() {
  const { status, isHydrated: isSessionHydrated } = useSession();
  const { status: spaceStatus, isHydrated: isSpaceHydrated } = useSpace();
  const { colors, isHydrated: isThemeHydrated } = useAoiTheme();
  const segments = useSegments();
  const routeName = segments[segments.length - 1];
  const isSignInRoute = routeName === 'sign-in';
  const isVerifyRoute = routeName === 'verify-code';
  const isSpaceSetupRoute = routeName === 'space-setup';
  const isSignedInOnlyRoute = isSpaceSetupRoute;

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

      return <Redirect href="/(app)/(tabs)/(memories)" />;
    }

    // An already-ready Space skips setup entirely — except the setup
    // route itself, which redirects to the Memories default on its own once ready.
    if (spaceStatus !== 'ready') {
      if (!isSpaceSetupRoute) {
        return <Redirect href="/(auth)/space-setup" />;
      }
    } else if (!isSpaceSetupRoute) {
      return <Redirect href="/(app)/(tabs)/(memories)" />;
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
      {/* The screen renders its own heading, so the nav bar stays out of it.
          Naming it here set a title and re-enabled a header the route had
          explicitly opted out of. */}
      <Stack.Screen name="space-setup" options={{ headerShown: false }} />
    </Stack>
  );
}

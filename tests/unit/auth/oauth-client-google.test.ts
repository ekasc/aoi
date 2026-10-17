import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const authApi = { signInWithGoogleIdToken: vi.fn() };

const ENV_KEYS = [
  'EXPO_PUBLIC_AUTH_STUB_MODE',
  'EXPO_PUBLIC_AUTH_API_BASE_URL',
  'EXPO_PUBLIC_GOOGLE_CLIENT_ID',
  'EXPO_PUBLIC_GOOGLE_IOS_CLIENT_ID',
] as const;
let savedEnv: Record<string, string | undefined>;

beforeEach(() => {
  savedEnv = Object.fromEntries(ENV_KEYS.map((key) => [key, process.env[key]]));
  process.env.EXPO_PUBLIC_AUTH_STUB_MODE = 'false';
  process.env.EXPO_PUBLIC_AUTH_API_BASE_URL = 'https://auth.example.test';
  process.env.EXPO_PUBLIC_GOOGLE_CLIENT_ID = 'web-client-id';
  process.env.EXPO_PUBLIC_GOOGLE_IOS_CLIENT_ID = 'ios-client-id';
});

afterEach(() => {
  for (const [key, value] of Object.entries(savedEnv)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
  vi.restoreAllMocks();
});

describe('Google native sign-in', () => {
  it('reports a missing binary module as a user-safe error instead of crashing the app', async () => {
    // Expo Go never bundles third-party native modules, and a dev build made
    // before this dependency evaluates the spec at import time, which throws
    // a raw Invariant Violation. The rule: that state must surface a
    // readable login error, never an uncaught crash.
    vi.doMock('@react-native-google-signin/google-signin', () => {
      const invariant = new Error(
        "TurboModuleRegistry.getEnforcing(...): 'RNGoogleSignin' could not be found."
      );
      throw invariant;
    });

    // The client module also imports expo-apple-authentication at top level;
    // in the jsdom unit environment its expo-modules-core import needs the
    // same native-module stub the component tests use.
    vi.doMock('expo-apple-authentication', () => ({
      isAvailableAsync: vi.fn(async () => true),
      AppleAuthenticationScope: {
        FULL_NAME: 'full_name',
        EMAIL: 'email',
      },
    }));

    const { signInWithOAuthProvider, OAuthClientError } = await import(
      '@/features/auth/oauth-client'
    );

    await expect(
      signInWithOAuthProvider('google', authApi as never)
    ).rejects.toBeInstanceOf(OAuthClientError);
    await expect(
      signInWithOAuthProvider('google', authApi as never)
    ).rejects.toMatchObject({
      code: 'unknown',
      message: expect.stringMatching(/app build/i),
    });
    expect(authApi.signInWithGoogleIdToken).not.toHaveBeenCalled();

    await vi.doUnmock('@react-native-google-signin/google-signin');
    vi.resetModules();
  });
});

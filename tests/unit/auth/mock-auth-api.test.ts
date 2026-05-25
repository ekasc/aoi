import { describe, expect, test } from 'bun:test';

import { mockAuthApi } from '../../../features/auth/mock-auth-api';

const redirectUri = 'aoi://auth/oauth-callback';

describe('mockAuthApi', () => {
  test('oauth start and callback returns a valid session', async () => {
    const start = await mockAuthApi.oauthStart({
      provider: 'google',
      platform: 'ios',
      clientId: 'google-ios-client-id',
      redirectUri,
      codeChallenge: 'test-code-challenge',
      codeChallengeMethod: 'S256',
    });

    expect(start.state).toContain('st_');
    expect(start.authorizationUrl).toContain('mock-auth.aoi.local');

    const session = await mockAuthApi.oauthCallback({
      provider: 'google',
      platform: 'ios',
      state: start.state,
      code: 'test-auth-code',
      codeVerifier: 'test-code-verifier',
    });

    expect(session.user.email).toBe('google-user@aoi.local');
    expect(session.tokens.accessToken).toContain('stub_google_');

    const restored = await mockAuthApi.getSession(session.tokens.accessToken);
    expect(restored.id).toBe(session.user.id);
  });

  test('oauth callback rejects unknown state', async () => {
    await expect(
      mockAuthApi.oauthCallback({
        provider: 'google',
        platform: 'android',
        state: 'missing-state',
        code: 'test-auth-code',
        codeVerifier: 'test-code-verifier',
      })
    ).rejects.toThrow('Invalid auth state');
  });

  test('apple native callback creates session and supports logout', async () => {
    const session = await mockAuthApi.oauthNativeCallback({
      provider: 'apple',
      platform: 'ios',
      idToken: 'apple-id-token',
      nonce: 'apple-nonce',
      displayName: 'Aoi Tester',
      avatarUrl: 'https://example.com/avatar.png',
    });

    expect(session.user.displayName).toBe('Aoi Tester');
    expect(session.user.avatarUrl).toBe('https://example.com/avatar.png');

    await mockAuthApi.logout(session.tokens.accessToken, session.tokens.refreshToken);

    await expect(mockAuthApi.getSession(session.tokens.accessToken)).rejects.toThrow(
      'Session not found.'
    );
  });
});

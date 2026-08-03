import { describe, expect, test } from 'vitest';

import { mockAuthApi } from '../../../features/auth/mock-auth-api';

const redirectUri = 'aoi://auth/oauth-callback';

describe('mockAuthApi', () => {
  test('workos authorize and callback return a valid session', async () => {
    const authorize = await mockAuthApi.workosAuthorize({
      provider: 'google',
      redirectUri,
    });

    expect(authorize.authorizationUrl).toContain('mock-auth.aoi.local');
    expect(authorize.authorizationUrl).toContain(encodeURIComponent(redirectUri));

    const session = await mockAuthApi.workosCallback({ code: 'test-auth-code' });

    expect(session.user.email).toBe('alex@gmail.com');
    expect(session.tokens.accessToken).toContain('stub_google_');

    const restored = await mockAuthApi.getSession(session.tokens.accessToken);
    expect(restored.id).toBe(session.user.id);
  });

  test('workos apple native rejects missing idToken or nonce', async () => {
    await expect(
      mockAuthApi.workosAppleNative({
        idToken: '   ',
        nonce: 'apple-nonce',
      })
    ).rejects.toThrow('idToken and nonce are required.');

    await expect(
      mockAuthApi.workosAppleNative({
        idToken: 'apple-id-token',
        nonce: '',
      })
    ).rejects.toThrow('idToken and nonce are required.');
  });

  test('apple native callback creates session and supports logout', async () => {
    const session = await mockAuthApi.workosAppleNative({
      idToken: 'apple-id-token',
      nonce: 'apple-nonce',
      displayName: 'Aoi Tester',
    });

    expect(session.user.email).toBe('jordan@icloud.com');
    expect(session.tokens.accessToken).toContain('stub_apple_');

    await mockAuthApi.logout(session.tokens.accessToken, session.tokens.refreshToken);

    await expect(mockAuthApi.getSession(session.tokens.accessToken)).rejects.toThrow(
      'Session not found.'
    );
  });
});

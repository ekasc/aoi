import { describe, expect, test } from 'vitest';

import { mockAuthApi } from '../../../features/auth/mock-auth-api';

describe('mockAuthApi', () => {
  test('apple idToken sign-in creates a valid stub session', async () => {
    const session = await mockAuthApi.signInWithAppleIdToken({
      provider: 'apple',
      platform: 'ios',
      idToken: 'apple-id-token',
      nonce: 'apple-nonce',
      displayName: 'Aoi Tester',
    });

    expect(session.user.email).toBe('jordan@icloud.com');
    expect(session.tokens.accessToken).toContain('stub_apple_');
    expect(session.tokens.refreshToken).toBeTruthy();
    expect(session.tokens.expiresAt).toBeTruthy();

    const restored = await mockAuthApi.getSession(session.tokens.accessToken);
    expect(restored.id).toBe(session.user.id);
  });

  test('google idToken sign-in creates a valid stub session', async () => {
    const session = await mockAuthApi.signInWithGoogleIdToken({
      provider: 'google',
      idToken: 'google-id-token',
      nonce: 'google-nonce',
    });

    expect(session.user.email).toBe('alex@gmail.com');
    expect(session.tokens.accessToken).toContain('stub_google_');

    const restored = await mockAuthApi.getSession(session.tokens.accessToken);
    expect(restored.id).toBe(session.user.id);
  });

  test('apple native sign-in rejects missing idToken or nonce', async () => {
    await expect(
      mockAuthApi.signInWithAppleIdToken({
        provider: 'apple',
        platform: 'ios',
        idToken: '   ',
        nonce: 'apple-nonce',
      })
    ).rejects.toThrow('idToken and nonce are required.');

    await expect(
      mockAuthApi.signInWithAppleIdToken({
        provider: 'apple',
        platform: 'ios',
        idToken: 'apple-id-token',
        nonce: '',
      })
    ).rejects.toThrow('idToken and nonce are required.');
  });

  test('google sign-in rejects a missing idToken', async () => {
    await expect(
      mockAuthApi.signInWithGoogleIdToken({
        provider: 'google',
        idToken: '   ',
      })
    ).rejects.toThrow('idToken is required.');
  });

  test('logout and deleteAccount revoke the stored session', async () => {
    const session = await mockAuthApi.signInWithAppleIdToken({
      provider: 'apple',
      platform: 'ios',
      idToken: 'apple-id-token',
      nonce: 'apple-nonce',
      displayName: 'Aoi Tester',
    });

    await mockAuthApi.logout(session.tokens.accessToken, session.tokens.refreshToken);
    await expect(mockAuthApi.getSession(session.tokens.accessToken)).rejects.toThrow(
      'Session not found.'
    );

    const second = await mockAuthApi.signInWithGoogleIdToken({
      provider: 'google',
      idToken: 'google-id-token',
    });
    await mockAuthApi.deleteAccount(second.tokens.accessToken);
    await expect(mockAuthApi.getSession(second.tokens.accessToken)).rejects.toThrow(
      'Session not found.'
    );
  });
});

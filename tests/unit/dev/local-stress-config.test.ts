import { createElement } from 'react';
import { render, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';

import { getLocalStressConfig } from '@/features/dev/local-stress-config';
import { getAuthApiBaseUrl, isAuthStubMode } from '@/features/auth/auth-config';
import { getApiTokens } from '@/features/api-client';
import { setAuthApi } from '@/features/auth/auth-api';
import { SessionProvider } from '@/features/session/session-context';

const state = vi.hoisted(() => ({ config: null as unknown }));
const secure = vi.hoisted(() => ({ getItemAsync: vi.fn(), setItemAsync: vi.fn(), deleteItemAsync: vi.fn() }));
vi.mock('@/features/dev/local-stress-config.json', () => ({ get default() { return state.config; } }));
vi.mock('expo-secure-store', () => secure);
vi.mock('@/features/push/push-api', () => ({ unregisterPushToken: vi.fn() }));
vi.mock('@/features/auth/oauth-client', () => ({ OAuthClientError: class extends Error {}, signInWithOAuthProvider: vi.fn() }));

const user = { id: 'synthetic-user', email: 'maya@stress.invalid', displayName: 'Maya Stress' };
const session = { user, tokens: { accessToken: 'stress-test-token' } };
const config = { baseUrl: 'http://192.168.1.108:8092', profile: 'established', session };

beforeEach(() => vi.stubGlobal('__DEV__', true));

afterEach(() => {
  state.config = null;
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});

it('leaves normal stub mode unchanged when no stress profile is active', () => {
  expect(getLocalStressConfig()).toBeNull();
  expect(isAuthStubMode()).toBe(true);
});

it('selects real HTTP repositories only for an explicit local synthetic session', () => {
  state.config = config;
  expect(isAuthStubMode()).toBe(false);
  expect(getAuthApiBaseUrl()).toBe(config.baseUrl);
});

it.each(['https://aoi-api.ekasc.workers.dev', 'http://example.com', 'http://192.168.1.108.attacker.invalid'])('rejects non-local stress destination %s', baseUrl => {
  state.config = { ...config, baseUrl };
  expect(() => getLocalStressConfig()).toThrow('Stress traffic must stay');
});

it('rejects a real user identity in a stress profile', () => {
  state.config = { ...config, session: { ...session, user: { ...user, email: 'maya@example.com' } } };
  expect(() => getLocalStressConfig()).toThrow('Only synthetic');
});

it('cannot activate stress mode in production', () => {
  state.config = config;
  vi.stubGlobal('__DEV__', false);
  expect(getLocalStressConfig()).toBeNull();
  expect(isAuthStubMode()).toBe(true);
});

it('hydrates the synthetic session without reading, replacing, or deleting stored credentials', async () => {
  state.config = config;
  setAuthApi({
    getSession: async () => user,
    signInWithAppleIdToken: async () => session,
    signInWithGoogleIdToken: async () => session,
    logout: async () => {}, deleteAccount: async () => {},
  });
  const view = render(createElement(SessionProvider, null));
  try {
    await waitFor(() => expect(getApiTokens()).toEqual(session.tokens));
    expect(secure.getItemAsync).not.toHaveBeenCalled();
    expect(secure.setItemAsync).not.toHaveBeenCalled();
    expect(secure.deleteItemAsync).not.toHaveBeenCalled();
  } finally { view.unmount(); }
});

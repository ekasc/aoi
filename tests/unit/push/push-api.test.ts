import { describe, it, expect, beforeEach, vi } from 'vitest';

import {
  getLastRegisteredPushToken,
  registerPushToken,
  unregisterPushToken,
} from '@/features/push/push-api';

const apiClientMock = vi.hoisted(() => ({
  apiFetch: vi.fn(),
}));

vi.mock('@/features/api-client', () => apiClientMock);

const TOKEN = 'ExpoPushToken[push-api-test-token]';

beforeEach(async () => {
  apiClientMock.apiFetch.mockReset();
  apiClientMock.apiFetch.mockResolvedValue({});
  // Drain whatever the previous test registered — the module keeps state.
  await unregisterPushToken();
  apiClientMock.apiFetch.mockClear();
});

describe('registerPushToken', () => {
  it('registers the token and remembers it for sign-out', async () => {
    await registerPushToken(TOKEN, 'ios');

    expect(apiClientMock.apiFetch).toHaveBeenCalledWith('/v1/push/tokens', {
      method: 'POST',
      body: JSON.stringify({ expoPushToken: TOKEN, platform: 'ios' }),
    });
    expect(getLastRegisteredPushToken()).toBe(TOKEN);
  });

  it('does not remember the token when registration fails', async () => {
    apiClientMock.apiFetch.mockRejectedValueOnce(new Error('offline'));

    await expect(registerPushToken(TOKEN, 'ios')).rejects.toThrow('offline');
    expect(getLastRegisteredPushToken()).toBeNull();
  });
});

describe('unregisterPushToken', () => {
  it('no-ops when nothing was registered this session', async () => {
    await unregisterPushToken();
    expect(apiClientMock.apiFetch).not.toHaveBeenCalled();
  });

  it('sends the DELETE with the registered token, then clears it', async () => {
    await registerPushToken(TOKEN, 'ios');
    apiClientMock.apiFetch.mockClear();

    await unregisterPushToken();

    expect(apiClientMock.apiFetch).toHaveBeenCalledTimes(1);
    expect(apiClientMock.apiFetch).toHaveBeenCalledWith('/v1/push/tokens', {
      method: 'DELETE',
      body: JSON.stringify({ expoPushToken: TOKEN }),
    });
    // Cleared only after the attempt — the token was captured up front, so a
    // concurrent caller can never race the cleanup.
    expect(getLastRegisteredPushToken()).toBeNull();
  });

  it('never double-unregisters: a second call is a no-op', async () => {
    await registerPushToken(TOKEN, 'ios');
    await unregisterPushToken();
    apiClientMock.apiFetch.mockClear();

    await unregisterPushToken();

    expect(apiClientMock.apiFetch).not.toHaveBeenCalled();
  });

  it('clears the remembered token even when the DELETE fails', async () => {
    await registerPushToken(TOKEN, 'ios');
    apiClientMock.apiFetch.mockClear();
    apiClientMock.apiFetch.mockRejectedValueOnce(new Error('network down'));

    // Swallowed — tender-error policy.
    await expect(unregisterPushToken()).resolves.toBeUndefined();
    expect(getLastRegisteredPushToken()).toBeNull();

    // And the failure is never retried with a stale token.
    await unregisterPushToken();
    expect(apiClientMock.apiFetch).toHaveBeenCalledTimes(1);
  });
});

import { describe, it, expect, beforeEach, vi } from 'vitest';

import {
  getLastRegisteredPushToken,
  registerPushToken,
  unregisterPushToken,
} from '@/features/push/push-api';

const apiClientMock = vi.hoisted(() => ({
  apiFetch: vi.fn(),
  getApiSessionGeneration: vi.fn(() => 0),
}));

vi.mock('@/features/api-client', () => apiClientMock);

const TOKEN = 'ExpoPushToken[push-api-test-token]';

beforeEach(async () => {
  apiClientMock.getApiSessionGeneration.mockReturnValue(0);
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
  it('does not send an old account queued registration using the next account credentials', async () => {
    await registerPushToken(TOKEN, 'ios');
    let finishDelete: () => void = () => {};
    const gate = new Promise<void>((resolve) => { finishDelete = resolve; });
    apiClientMock.apiFetch.mockImplementationOnce(() => gate);
    const old = unregisterPushToken();
    await vi.waitFor(() => expect(apiClientMock.apiFetch).toHaveBeenCalledTimes(2));
    const stale = expect(registerPushToken('stale-account-token', 'ios')).rejects.toMatchObject({ code: 'SESSION_CHANGED' });
    apiClientMock.getApiSessionGeneration.mockReturnValue(1);
    const next = registerPushToken(TOKEN, 'ios');
    finishDelete();
    await Promise.all([old, stale, next]);
    expect(getLastRegisteredPushToken()).toBe(TOKEN);
    expect(apiClientMock.apiFetch.mock.calls.some(([, options]) => options.body?.includes('stale-account-token'))).toBe(false);
    await unregisterPushToken();
  });

  it('keeps the server registration when a new registration starts during an old delete', async () => {
    let registered = false;
    let finishDelete: () => void = () => {};
    const gate = new Promise<void>((resolve) => { finishDelete = resolve; });
    apiClientMock.apiFetch.mockImplementation(async (_path: string, options: RequestInit) => {
      if (options.method === 'DELETE') await gate;
      registered = options.method === 'POST';
      return {};
    });
    await registerPushToken(TOKEN, 'ios');
    const old = unregisterPushToken();
    const next = registerPushToken(TOKEN, 'ios');
    await Promise.resolve();
    finishDelete();
    await Promise.all([old, next]);
    expect(registered).toBe(true);
    expect(getLastRegisteredPushToken()).toBe(TOKEN);
  });

  it('does not clear a newer registration when an old unregister finishes, even for the same device token', async () => {
    await registerPushToken(TOKEN, 'ios');
    let finish: () => void = () => {};
    apiClientMock.apiFetch.mockImplementationOnce(() => new Promise<void>((resolve) => { finish = resolve; }));
    const old = unregisterPushToken();
    const next = registerPushToken(TOKEN, 'ios');
    await vi.waitFor(() => expect(apiClientMock.apiFetch).toHaveBeenCalledTimes(2));
    finish();
    await Promise.all([old, next]);
    expect(getLastRegisteredPushToken()).toBe(TOKEN);
    apiClientMock.apiFetch.mockClear();
    await unregisterPushToken();
    expect(apiClientMock.apiFetch).toHaveBeenCalledOnce();
  });

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
    await expect(unregisterPushToken()).resolves.toBe(TOKEN);
    expect(getLastRegisteredPushToken()).toBeNull();

    // And the failure is never retried with a stale token.
    await unregisterPushToken();
    expect(apiClientMock.apiFetch).toHaveBeenCalledTimes(1);
  });
});

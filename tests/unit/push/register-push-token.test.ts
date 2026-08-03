import { describe, it, expect, beforeEach, vi } from 'vitest';

import { registerDevicePushToken } from '@/features/push/register-push-token';

const notificationsMock = vi.hoisted(() => ({
  requestPermissionsAsync: vi.fn(),
  getExpoPushTokenAsync: vi.fn(),
}));

const pushApiMock = vi.hoisted(() => ({
  registerPushToken: vi.fn(async () => {}),
}));

vi.mock('expo-notifications', () => notificationsMock);
vi.mock('@/features/push/push-api', () => pushApiMock);

const VALID_TOKEN = 'ExpoPushToken[test-device-token-123]';

beforeEach(() => {
  notificationsMock.requestPermissionsAsync.mockReset();
  notificationsMock.getExpoPushTokenAsync.mockReset();
  pushApiMock.registerPushToken.mockClear();
  notificationsMock.requestPermissionsAsync.mockResolvedValue({ granted: true });
  notificationsMock.getExpoPushTokenAsync.mockResolvedValue({ data: VALID_TOKEN });
});

describe('registerDevicePushToken', () => {
  it('registers the Expo token with the detected platform', async () => {
    await expect(registerDevicePushToken()).resolves.toBe(true);
    // The RN mock reports Platform.OS === 'ios'.
    expect(pushApiMock.registerPushToken).toHaveBeenCalledWith(VALID_TOKEN, 'ios');
  });

  it('skips registration when permission is not granted', async () => {
    notificationsMock.requestPermissionsAsync.mockResolvedValue({ granted: false });
    await expect(registerDevicePushToken()).resolves.toBe(false);
    expect(pushApiMock.registerPushToken).not.toHaveBeenCalled();
  });

  it('no-ops on simulators (getExpoPushTokenAsync rejects)', async () => {
    notificationsMock.getExpoPushTokenAsync.mockRejectedValue(
      new Error('Cannot get push token on a simulator')
    );
    await expect(registerDevicePushToken()).resolves.toBe(false);
    expect(pushApiMock.registerPushToken).not.toHaveBeenCalled();
  });

  it('ignores tokens that fail the format check', async () => {
    notificationsMock.getExpoPushTokenAsync.mockResolvedValue({ data: 'not-a-token' });
    await expect(registerDevicePushToken()).resolves.toBe(false);
    expect(pushApiMock.registerPushToken).not.toHaveBeenCalled();
  });

  it('swallows API failures — registration never surfaces an error', async () => {
    pushApiMock.registerPushToken.mockRejectedValue(new Error('offline'));
    // false, not a throw — so the caller knows to retry later.
    await expect(registerDevicePushToken()).resolves.toBe(false);
  });
});

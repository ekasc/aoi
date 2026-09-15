import { describe, it, expect, beforeEach, vi } from 'vitest';
import { act, render, waitFor } from '@testing-library/react';

import { PushProvider } from '@/features/push/push-context';
import { SqueezeProvider } from '@/features/squeeze/squeeze-context';

// Separate file from push-context.test.tsx on purpose: the register-once
// flag is module state, and this file gets a fresh module instance so the
// failure→retry semantics can be exercised from a clean slate.

const notificationsMock = vi.hoisted(() => ({
  requestPermissionsAsync: vi.fn(),
  getExpoPushTokenAsync: vi.fn(),
  addNotificationReceivedListener: vi.fn(),
  addNotificationResponseReceivedListener: vi.fn(),
}));

const apiClientMock = vi.hoisted(() => ({
  isStubMode: vi.fn(() => false),
}));

const momentsMock = vi.hoisted(() => ({
  refresh: vi.fn(async () => {}),
}));

const pushApiMock = vi.hoisted(() => ({
  registerPushToken: vi.fn(async () => {}),
}));

const lettersMock = vi.hoisted(() => ({
  reload: vi.fn(async () => {}),
}));

const calendarMock = vi.hoisted(() => ({
  refresh: vi.fn(async () => {}),
}));

const proposalsMock = vi.hoisted(() => ({
  reload: vi.fn(async () => {}),
}));

vi.mock('expo-notifications', () => notificationsMock);
vi.mock('@/features/api-client', () => apiClientMock);
vi.mock('@/features/moments/moments-context', () => ({
  useMoments: () => ({ refresh: momentsMock.refresh }),
}));
vi.mock('@/features/letters/letters-context', () => ({
  useLetters: () => ({ reload: lettersMock.reload }),
}));
vi.mock('@/features/calendar/calendar-context', () => ({
  useCalendar: () => ({ refresh: calendarMock.refresh }),
}));
vi.mock('@/features/proposals/proposals-context', () => ({
  useProposals: () => ({ reload: proposalsMock.reload }),
}));
vi.mock('@/features/push/push-api', () => pushApiMock);

const VALID_TOKEN = 'ExpoPushToken[registration-test-token]';

function renderProvider() {
  return render(
    <SqueezeProvider>
      <PushProvider>
        <div />
      </PushProvider>
    </SqueezeProvider>
  );
}

beforeEach(() => {
  apiClientMock.isStubMode.mockReturnValue(false);
  notificationsMock.requestPermissionsAsync.mockReset();
  notificationsMock.getExpoPushTokenAsync.mockReset();
  notificationsMock.addNotificationReceivedListener.mockReset();
  notificationsMock.addNotificationResponseReceivedListener.mockReset();
  pushApiMock.registerPushToken.mockReset();
  notificationsMock.requestPermissionsAsync.mockResolvedValue({ granted: true });
  notificationsMock.getExpoPushTokenAsync.mockResolvedValue({ data: VALID_TOKEN });
  notificationsMock.addNotificationReceivedListener.mockReturnValue({ remove: vi.fn() });
  notificationsMock.addNotificationResponseReceivedListener.mockReturnValue({
    remove: vi.fn(),
  });
});

describe('PushProvider registration retry after failure', () => {
  // One lifecycle test: the register-once flag is module state, so a success
  // in any earlier test would lock out everything that follows.
  it('retries after a failed attempt and locks out only after success', async () => {
    // Offline boot: the API call fails.
    pushApiMock.registerPushToken.mockRejectedValueOnce(new Error('offline'));

    const failed = renderProvider();
    await waitFor(() => expect(pushApiMock.registerPushToken).toHaveBeenCalledTimes(1));
    // Let the failure settle so the flag decision has run.
    await act(async () => {});
    failed.unmount();

    // Connectivity returns — a later mount must retry, not stay silent.
    pushApiMock.registerPushToken.mockResolvedValueOnce(undefined);
    const succeeded = renderProvider();
    await waitFor(() => expect(pushApiMock.registerPushToken).toHaveBeenCalledTimes(2));
    await act(async () => {});
    succeeded.unmount();

    // The successful registration consumed the session — no further attempts.
    const third = renderProvider();
    await act(async () => {});
    expect(pushApiMock.registerPushToken).toHaveBeenCalledTimes(2);
    third.unmount();
  });
});

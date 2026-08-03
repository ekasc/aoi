import { describe, it, expect, beforeEach, vi } from 'vitest';
import { act, render, waitFor } from '@testing-library/react';

import { PushProvider } from '@/features/push/push-context';
import { SqueezeProvider, useSqueeze } from '@/features/squeeze/squeeze-context';

const notificationsMock = vi.hoisted(() => ({
  requestPermissionsAsync: vi.fn(),
  getExpoPushTokenAsync: vi.fn(),
  addNotificationReceivedListener: vi.fn(),
  setNotificationHandler: vi.fn(),
}));

const apiClientMock = vi.hoisted(() => ({
  isStubMode: vi.fn(() => false),
  apiFetch: vi.fn(async () => ({})),
}));

const momentsMock = vi.hoisted(() => ({
  refresh: vi.fn(async () => {}),
}));

vi.mock('expo-notifications', () => notificationsMock);
vi.mock('@/features/api-client', () => apiClientMock);
vi.mock('@/features/moments/moments-context', () => ({
  useMoments: () => ({ refresh: momentsMock.refresh }),
}));

const VALID_TOKEN = 'ExpoPushToken[context-test-token-123]';

let receivedListener: ((notification: unknown) => void) | null = null;

function SqueezeProbe() {
  const { incomingSqueeze } = useSqueeze();
  return <div data-testid="squeeze">{incomingSqueeze ? 'incoming' : 'quiet'}</div>;
}

function renderProvider() {
  return render(
    <SqueezeProvider>
      <PushProvider>
        <SqueezeProbe />
      </PushProvider>
    </SqueezeProvider>
  );
}

function deliver(data: unknown) {
  act(() => {
    receivedListener?.({ request: { content: { data } } });
  });
}

beforeEach(() => {
  receivedListener = null;
  apiClientMock.isStubMode.mockReturnValue(false);
  apiClientMock.apiFetch.mockClear();
  momentsMock.refresh.mockClear();
  notificationsMock.requestPermissionsAsync.mockReset();
  notificationsMock.getExpoPushTokenAsync.mockReset();
  notificationsMock.addNotificationReceivedListener.mockReset();
  notificationsMock.requestPermissionsAsync.mockResolvedValue({ granted: true });
  notificationsMock.getExpoPushTokenAsync.mockResolvedValue({ data: VALID_TOKEN });
  notificationsMock.addNotificationReceivedListener.mockImplementation(
    (callback: (notification: unknown) => void) => {
      receivedListener = callback;
      return { remove: vi.fn() };
    }
  );
});

describe('PushProvider in stub mode', () => {
  it('stays completely quiet — no registration, no listener (simulated loop intact)', () => {
    apiClientMock.isStubMode.mockReturnValue(true);
    const view = renderProvider();
    expect(apiClientMock.apiFetch).not.toHaveBeenCalled();
    expect(notificationsMock.addNotificationReceivedListener).not.toHaveBeenCalled();
    view.unmount();
  });
});

describe('PushProvider token registration (remote)', () => {
  it('registers the device token once per session, never on remount', async () => {
    const first = renderProvider();
    await waitFor(() => expect(apiClientMock.apiFetch).toHaveBeenCalledTimes(1));
    expect(apiClientMock.apiFetch).toHaveBeenCalledWith('/v1/push/tokens', {
      method: 'POST',
      body: JSON.stringify({ expoPushToken: VALID_TOKEN, platform: 'ios' }),
    });
    first.unmount();

    // Remounting within the same session must not re-register.
    const second = renderProvider();
    await act(async () => {});
    expect(apiClientMock.apiFetch).toHaveBeenCalledTimes(1);
    second.unmount();
  });
});

describe('PushProvider receive handling (remote)', () => {
  it('lights up the squeeze overlay when a squeeze push arrives', async () => {
    const view = renderProvider();
    await waitFor(() => expect(receivedListener).not.toBeNull());

    deliver({ kind: 'squeeze' });

    await waitFor(() =>
      expect(view.getByTestId('squeeze').textContent).toBe('incoming')
    );
    view.unmount();
  });

  it('gently refreshes moments for moment_* pushes', async () => {
    const view = renderProvider();
    await waitFor(() => expect(receivedListener).not.toBeNull());

    deliver({ kind: 'moment_added' });
    await waitFor(() => expect(momentsMock.refresh).toHaveBeenCalledTimes(1));

    deliver({ kind: 'moment_deleted' });
    await waitFor(() => expect(momentsMock.refresh).toHaveBeenCalledTimes(2));
    view.unmount();
  });

  it('ignores unknown kinds entirely', async () => {
    const view = renderProvider();
    await waitFor(() => expect(receivedListener).not.toBeNull());

    deliver({ kind: 'location_request' });
    deliver('garbage');

    await act(async () => {});
    expect(momentsMock.refresh).not.toHaveBeenCalled();
    expect(view.getByTestId('squeeze').textContent).toBe('quiet');
    view.unmount();
  });
});

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { act, render, waitFor } from '@testing-library/react';

import { PushProvider } from '@/features/push/push-context';
import { SqueezeProvider, useSqueeze } from '@/features/squeeze/squeeze-context';

const notificationsMock = vi.hoisted(() => ({
  requestPermissionsAsync: vi.fn(),
  getExpoPushTokenAsync: vi.fn(),
  addNotificationReceivedListener: vi.fn(),
  addNotificationResponseReceivedListener: vi.fn(),
  setNotificationHandler: vi.fn(),
}));

const apiClientMock = vi.hoisted(() => ({
  isStubMode: vi.fn(() => false),
  apiFetch: vi.fn(async () => ({})),
}));

const momentsMock = vi.hoisted(() => ({
  refresh: vi.fn(async () => {}),
}));

const locationMock = vi.hoisted(() => ({
  receiveRequest: vi.fn(),
  refreshPartnerLocation: vi.fn(async () => {}),
  handlePartnerStopped: vi.fn(),
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
vi.mock('@/features/location/location-context', () => ({
  useLocation: () => locationMock,
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

const VALID_TOKEN = 'ExpoPushToken[context-test-token-123]';

let receivedListener: ((notification: unknown) => void) | null = null;
let responseListener: ((response: unknown) => void) | null = null;
let removeReceived: ReturnType<typeof vi.fn> | null = null;
let removeResponse: ReturnType<typeof vi.fn> | null = null;

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

// Simulates the user tapping a notification that arrived while the app was
// backgrounded/killed.
function deliverResponse(data: unknown) {
  act(() => {
    responseListener?.({ notification: { request: { content: { data } } } });
  });
}

beforeEach(() => {
  receivedListener = null;
  responseListener = null;
  removeReceived = null;
  removeResponse = null;
  apiClientMock.isStubMode.mockReturnValue(false);
  apiClientMock.apiFetch.mockClear();
  momentsMock.refresh.mockClear();
  locationMock.receiveRequest.mockClear();
  locationMock.refreshPartnerLocation.mockClear();
  locationMock.handlePartnerStopped.mockClear();
  lettersMock.reload.mockClear();
  calendarMock.refresh.mockClear();
  proposalsMock.reload.mockClear();
  notificationsMock.requestPermissionsAsync.mockReset();
  notificationsMock.getExpoPushTokenAsync.mockReset();
  notificationsMock.addNotificationReceivedListener.mockReset();
  notificationsMock.addNotificationResponseReceivedListener.mockReset();
  notificationsMock.requestPermissionsAsync.mockResolvedValue({ granted: true });
  notificationsMock.getExpoPushTokenAsync.mockResolvedValue({ data: VALID_TOKEN });
  notificationsMock.addNotificationReceivedListener.mockImplementation(
    (callback: (notification: unknown) => void) => {
      receivedListener = callback;
      removeReceived = vi.fn();
      return { remove: removeReceived };
    }
  );
  notificationsMock.addNotificationResponseReceivedListener.mockImplementation(
    (callback: (response: unknown) => void) => {
      responseListener = callback;
      removeResponse = vi.fn();
      return { remove: removeResponse };
    }
  );
});

describe('PushProvider in stub mode', () => {
  it('stays completely quiet — no registration, no listener (simulated loop intact)', () => {
    apiClientMock.isStubMode.mockReturnValue(true);
    const view = renderProvider();
    expect(apiClientMock.apiFetch).not.toHaveBeenCalled();
    expect(notificationsMock.addNotificationReceivedListener).not.toHaveBeenCalled();
    expect(
      notificationsMock.addNotificationResponseReceivedListener
    ).not.toHaveBeenCalled();
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

  it('quietly refreshes the letters shelf for letter_sealed pushes', async () => {
    const view = renderProvider();
    await waitFor(() => expect(receivedListener).not.toBeNull());

    deliver({ kind: 'letter_sealed' });
    await waitFor(() => expect(lettersMock.reload).toHaveBeenCalledTimes(1));
    // The shelf refresh never doubles as a moments refresh.
    expect(momentsMock.refresh).not.toHaveBeenCalled();
    view.unmount();
  });

  it('quietly refreshes the calendar for event_* pushes', async () => {
    const view = renderProvider();
    await waitFor(() => expect(receivedListener).not.toBeNull());

    deliver({ kind: 'event_added' });
    await waitFor(() => expect(calendarMock.refresh).toHaveBeenCalledTimes(1));

    deliver({ kind: 'event_updated' });
    await waitFor(() => expect(calendarMock.refresh).toHaveBeenCalledTimes(2));

    deliver({ kind: 'event_deleted' });
    await waitFor(() => expect(calendarMock.refresh).toHaveBeenCalledTimes(3));
    // The push never names the event — only the calendar re-reads.
    expect(momentsMock.refresh).not.toHaveBeenCalled();
    expect(proposalsMock.reload).not.toHaveBeenCalled();
    view.unmount();
  });

  it('reloads suggestions for proposal_received and proposal_declined', async () => {
    const view = renderProvider();
    await waitFor(() => expect(receivedListener).not.toBeNull());

    deliver({ kind: 'proposal_received' });
    await waitFor(() => expect(proposalsMock.reload).toHaveBeenCalledTimes(1));

    deliver({ kind: 'proposal_declined' });
    await waitFor(() => expect(proposalsMock.reload).toHaveBeenCalledTimes(2));
    // A pass or a new idea does not touch the calendar.
    expect(calendarMock.refresh).not.toHaveBeenCalled();
    view.unmount();
  });

  it('reloads both suggestions and the calendar for proposal_accepted', async () => {
    const view = renderProvider();
    await waitFor(() => expect(receivedListener).not.toBeNull());

    deliver({ kind: 'proposal_accepted' });

    await waitFor(() => expect(proposalsMock.reload).toHaveBeenCalledTimes(1));
    // Acceptance creates a real event — the calendar refreshes too.
    await waitFor(() => expect(calendarMock.refresh).toHaveBeenCalledTimes(1));
    view.unmount();
  });

  it('ignores unknown kinds entirely', async () => {
    const view = renderProvider();
    await waitFor(() => expect(receivedListener).not.toBeNull());

    deliver({ kind: 'proposal' });
    deliver('garbage');

    await act(async () => {});
    expect(momentsMock.refresh).not.toHaveBeenCalled();
    expect(locationMock.receiveRequest).not.toHaveBeenCalled();
    expect(lettersMock.reload).not.toHaveBeenCalled();
    expect(calendarMock.refresh).not.toHaveBeenCalled();
    expect(proposalsMock.reload).not.toHaveBeenCalled();
    expect(view.getByTestId('squeeze').textContent).toBe('quiet');
    view.unmount();
  });
});

describe('PushProvider location routing (remote)', () => {
  it('shows the approval prompt for location_request', async () => {
    const view = renderProvider();
    await waitFor(() => expect(receivedListener).not.toBeNull());

    deliver({ kind: 'location_request' });

    await waitFor(() => expect(locationMock.receiveRequest).toHaveBeenCalledTimes(1));
    expect(momentsMock.refresh).not.toHaveBeenCalled();
    view.unmount();
  });

  it('refreshes the partner position for location_granted', async () => {
    const view = renderProvider();
    await waitFor(() => expect(receivedListener).not.toBeNull());

    deliver({ kind: 'location_granted' });

    await waitFor(() =>
      expect(locationMock.refreshPartnerLocation).toHaveBeenCalledTimes(1)
    );
    view.unmount();
  });

  it('clears the partner pin for location_stopped', async () => {
    const view = renderProvider();
    await waitFor(() => expect(receivedListener).not.toBeNull());

    deliver({ kind: 'location_stopped' });

    await waitFor(() =>
      expect(locationMock.handlePartnerStopped).toHaveBeenCalledTimes(1)
    );
    view.unmount();
  });
});

describe('PushProvider response handling (backgrounded/killed)', () => {
  it('lights up the squeeze overlay when the user taps a backgrounded squeeze push', async () => {
    const view = renderProvider();
    await waitFor(() => expect(responseListener).not.toBeNull());

    deliverResponse({ kind: 'squeeze' });

    await waitFor(() =>
      expect(view.getByTestId('squeeze').textContent).toBe('incoming')
    );
    view.unmount();
  });

  it('refreshes moments when the user taps a backgrounded moment_* push', async () => {
    const view = renderProvider();
    await waitFor(() => expect(responseListener).not.toBeNull());

    deliverResponse({ kind: 'moment_edited' });
    await waitFor(() => expect(momentsMock.refresh).toHaveBeenCalledTimes(1));
    view.unmount();
  });

  it('refreshes the letters shelf when the user taps a backgrounded letter_sealed push', async () => {
    const view = renderProvider();
    await waitFor(() => expect(responseListener).not.toBeNull());

    deliverResponse({ kind: 'letter_sealed' });
    await waitFor(() => expect(lettersMock.reload).toHaveBeenCalledTimes(1));
    view.unmount();
  });

  it('routes a tapped backgrounded location_request to the approval prompt', async () => {
    const view = renderProvider();
    await waitFor(() => expect(responseListener).not.toBeNull());

    deliverResponse({ kind: 'location_request' });
    await waitFor(() => expect(locationMock.receiveRequest).toHaveBeenCalledTimes(1));
    view.unmount();
  });

  it('refreshes the calendar when the user taps a backgrounded event_* push', async () => {
    const view = renderProvider();
    await waitFor(() => expect(responseListener).not.toBeNull());

    deliverResponse({ kind: 'event_updated' });
    await waitFor(() => expect(calendarMock.refresh).toHaveBeenCalledTimes(1));
    view.unmount();
  });

  it('reloads suggestions and the calendar for a tapped proposal_accepted push', async () => {
    const view = renderProvider();
    await waitFor(() => expect(responseListener).not.toBeNull());

    deliverResponse({ kind: 'proposal_accepted' });
    await waitFor(() => expect(proposalsMock.reload).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(calendarMock.refresh).toHaveBeenCalledTimes(1));
    view.unmount();
  });

  it('ignores unknown kinds tapped from the notification tray', async () => {
    const view = renderProvider();
    await waitFor(() => expect(responseListener).not.toBeNull());

    deliverResponse('garbage');

    await act(async () => {});
    expect(momentsMock.refresh).not.toHaveBeenCalled();
    expect(locationMock.receiveRequest).not.toHaveBeenCalled();
    expect(lettersMock.reload).not.toHaveBeenCalled();
    expect(calendarMock.refresh).not.toHaveBeenCalled();
    expect(proposalsMock.reload).not.toHaveBeenCalled();
    expect(view.getByTestId('squeeze').textContent).toBe('quiet');
    view.unmount();
  });

  it('removes both listeners on unmount', async () => {
    const view = renderProvider();
    await waitFor(() => expect(responseListener).not.toBeNull());

    view.unmount();

    expect(removeReceived).toHaveBeenCalledTimes(1);
    expect(removeResponse).toHaveBeenCalledTimes(1);
  });
});

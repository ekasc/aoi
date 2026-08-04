import { describe, it, expect, beforeEach, vi } from 'vitest';
import { act, render, waitFor } from '@testing-library/react';

import { LocationProvider, useLocation } from '@/features/location/location-context';

// Controllable expo-location: foreground granted, watchPositionAsync hands
// us the callback so we can emit fixes ourselves.
let watchCallback: ((position: unknown) => void) | null = null;
const locationMock = vi.hoisted(() => ({
  requestForegroundPermissionsAsync: vi.fn(async () => ({ granted: true })),
  requestBackgroundPermissionsAsync: vi.fn(async () => ({ granted: false })),
  isBackgroundLocationAvailableAsync: vi.fn(async () => false),
  getCurrentPositionAsync: vi.fn(async () => ({
    coords: { latitude: 10, longitude: 20, accuracy: 5 },
    timestamp: Date.now(),
  })),
  watchPositionAsync: vi.fn(),
  startLocationUpdatesAsync: vi.fn(async () => {}),
  stopLocationUpdatesAsync: vi.fn(async () => {}),
  hasStartedLocationUpdatesAsync: vi.fn(async () => false),
  Accuracy: { Balanced: 3 },
}));

vi.mock('expo-location', () => locationMock);

vi.mock('@/features/api-client', () => ({
  isStubMode: () => false,
}));

vi.mock('@/features/session/session-context', () => ({
  useSession: () => ({ user: { id: 'user-you' }, signOut: vi.fn() }),
}));

// A repository whose share() we can hold open with a deferred promise.
// Hoisted so the vi.mock factory below (which is hoisted) can see it.
const hoisted = vi.hoisted(() => {
  const shareResolvers: Array<() => void> = [];
  const repositoryMock = {
    getState: vi.fn(async () => ({
      youConsented: true,
      partnerConsented: true,
      partnerLocation: null,
    })),
    setConsent: vi.fn(async (consented: boolean) => ({
      youConsented: consented,
      partnerConsented: true,
    })),
    // Each call returns a promise we resolve manually, so we can land a
    // report AFTER a stop and prove the row would be re-stopped.
    share: vi.fn(
      () =>
        new Promise<void>((resolve) => {
          shareResolvers.push(resolve);
        })
    ),
    stop: vi.fn(async () => {}),
    request: vi.fn(async () => {}),
  };
  return { shareResolvers, repositoryMock };
});
const { shareResolvers, repositoryMock } = hoisted;

vi.mock('@/features/location/remote-location-repository', () => ({
  remoteLocationRepository: hoisted.repositoryMock,
}));

function Probe() {
  const value = useLocation();
  return (
    <div>
      <button data-testid="start-until" onClick={() => void value.startSharing('until_arrive', {
        name: 'Home',
        latitude: 10.01,
        longitude: 20.01,
        radiusMeters: 200,
      })} />
      <button data-testid="stop" onClick={() => void value.stopSharing()} />
      <button data-testid="receive" onClick={() => value.receiveRequest()} />
      <button data-testid="approve" onClick={() => void value.approveRequest()} />
      <span data-testid="mode">{value.sharingMode ?? 'none'}</span>
    </div>
  );
}

function renderProvider() {
  return render(
    <LocationProvider>
      <Probe />
    </LocationProvider>
  );
}

function makePosition(latitude: number, longitude: number, timestamp: number) {
  return { coords: { latitude, longitude, accuracy: 5 }, timestamp };
}

beforeEach(() => {
  watchCallback = null;
  shareResolvers.length = 0;
  vi.mocked(repositoryMock.share).mockClear();
  vi.mocked(repositoryMock.stop).mockClear();
  vi.mocked(repositoryMock.getState).mockClear();
  locationMock.watchPositionAsync.mockReset();
  locationMock.watchPositionAsync.mockImplementation(
    async (_opts: unknown, cb: (position: unknown) => void) => {
      watchCallback = cb;
      return { remove: () => {} };
    }
  );
});

describe('LocationProvider stop/revoke race (HIGH-2)', () => {
  it('re-issues stop when an in-flight report lands after stop', async () => {
    const view = renderProvider();
    await waitFor(() => expect(repositoryMock.getState).toHaveBeenCalled());

    const startButton = view.getByTestId('start-until');
    await act(async () => {
      startButton.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });
    // The immediate getCurrentPositionAsync report is now in flight (deferred).
    await waitFor(() => expect(repositoryMock.share).toHaveBeenCalledTimes(1));

    // Stop while that report is still in flight.
    const stopButton = view.getByTestId('stop');
    await act(async () => {
      stopButton.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });
    await waitFor(() => expect(repositoryMock.stop).toHaveBeenCalledTimes(1));

    // The late report finally lands — it must NOT resurrect the row.
    await act(async () => {
      shareResolvers.forEach((resolve) => resolve());
      shareResolvers.length = 0;
    });

    await waitFor(() => expect(repositoryMock.stop).toHaveBeenCalledTimes(2));
    expect(view.getByTestId('mode').textContent).toBe('none');
    view.unmount();
  });
});

describe('LocationProvider approval guard (double-tap)', () => {
  it('a rapid double-tap grants exactly once', async () => {
    const view = renderProvider();
    await waitFor(() => expect(repositoryMock.getState).toHaveBeenCalled());

    await act(async () => {
      view.getByTestId('receive').dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });

    await act(async () => {
      const approve = view.getByTestId('approve');
      approve.dispatchEvent(new MouseEvent('click', { bubbles: true }));
      approve.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });

    // Both taps raced, but only one grant was posted.
    await waitFor(() => expect(repositoryMock.share).toHaveBeenCalledTimes(1));
    expect(vi.mocked(repositoryMock.share).mock.calls[0][0].mode).toBe(
      'on_request_granted'
    );
    view.unmount();
  });
});

describe('LocationProvider until_arrive arrival gating (HIGH-3b)', () => {
  it('ignores a stale first fix and stops only on a fresh arrival fix', async () => {
    const view = renderProvider();
    await waitFor(() => expect(repositoryMock.getState).toHaveBeenCalled());

    await act(async () => {
      view.getByTestId('start-until').dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });
    await waitFor(() => expect(watchCallback).not.toBeNull());

    // A stale last-known fix at the destination must NOT declare arrival.
    await act(async () => {
      watchCallback?.(makePosition(10.01, 20.01, Date.now() - 60_000));
    });
    await act(async () => {
      shareResolvers.forEach((r) => r());
      shareResolvers.length = 0;
    });
    expect(view.getByTestId('mode').textContent).toBe('until_arrive');

    // A fresh fix at the destination stops sharing.
    await act(async () => {
      watchCallback?.(makePosition(10.01, 20.01, Date.now() + 1_000));
    });
    await act(async () => {
      shareResolvers.forEach((r) => r());
      shareResolvers.length = 0;
    });
    await waitFor(() => expect(view.getByTestId('mode').textContent).toBe('none'));
    view.unmount();
  });
});

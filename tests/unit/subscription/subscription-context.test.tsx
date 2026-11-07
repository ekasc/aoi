import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { renderHook, waitFor, act } from '@testing-library/react';
import { Platform } from 'react-native';

import { SubscriptionProvider, useSubscription } from '@/features/subscription/subscription-context';

const purchasesMock = vi.hoisted(() => ({
  configure: vi.fn(),
  getCustomerInfo: vi.fn(),
  getOfferings: vi.fn(),
  logIn: vi.fn(),
  logOut: vi.fn(),
  purchasePackage: vi.fn(),
  restorePurchases: vi.fn(),
}));

const apiFetchMock = vi.hoisted(() => vi.fn());

vi.mock('@/features/api-client', () => ({
  apiFetch: apiFetchMock,
}));

vi.mock('react-native-purchases', () => ({
  __esModule: true,
  default: purchasesMock,
  PURCHASES_ERROR_CODE: { PURCHASE_CANCELLED_ERROR: 'E_USER_CANCELLED' },
}));

let mockSessionUser: { id: string } | null = null;
let mockSessionStatus: 'loading' | 'signed_out' | 'signed_in' = 'signed_out';
let mockSpaceId: string | null = 'space-a';

vi.mock('@/features/session/session-context', () => ({
  useSession: () => ({ user: mockSessionUser, status: mockSessionStatus }),
}));

vi.mock('@/features/space/space-context', () => ({
  useSpace: () => ({ space: mockSpaceId ? { id: mockSpaceId } : null, status: 'ready' }),
}));

const IOS_KEY = 'rc_ios_test_key';
const PLUS_ID = 'plus';

function plusInfo() {
  return { entitlements: { active: { [PLUS_ID]: { identifier: PLUS_ID } } } };
}

function freeInfo() {
  return { entitlements: { active: {} } };
}

function offeringsWith(ids: string[]) {
  return {
    current: {
      availablePackages: ids.map((id) => ({
        identifier: id,
        packageType: id.includes('yearly') ? 'ANNUAL' : 'MONTHLY',
        product: { title: id, priceString: '$9.99' },
      })),
    },
  };
}

function setKeysPresent() {
  process.env.EXPO_PUBLIC_REVENUECAT_IOS_KEY = IOS_KEY;
  delete process.env.EXPO_PUBLIC_REVENUECAT_ANDROID_KEY;
}

function clearKeys() {
  delete process.env.EXPO_PUBLIC_REVENUECAT_IOS_KEY;
  delete process.env.EXPO_PUBLIC_REVENUECAT_ANDROID_KEY;
}

let savedIos: string | undefined;
let savedAndroid: string | undefined;
let savedOs: string;

beforeEach(() => {
  savedIos = process.env.EXPO_PUBLIC_REVENUECAT_IOS_KEY;
  savedAndroid = process.env.EXPO_PUBLIC_REVENUECAT_ANDROID_KEY;
  savedOs = Platform.OS;
  mockSessionUser = null;
  mockSessionStatus = 'signed_out';
  mockSpaceId = 'space-a';
  vi.clearAllMocks();
  purchasesMock.getCustomerInfo.mockResolvedValue(freeInfo());
  purchasesMock.getOfferings.mockResolvedValue(offeringsWith([]));
  purchasesMock.logIn.mockResolvedValue({ customerInfo: freeInfo() } as never);
  purchasesMock.logOut.mockResolvedValue({ customerInfo: freeInfo() } as never);
  purchasesMock.purchasePackage.mockResolvedValue({ customerInfo: freeInfo() } as never);
  purchasesMock.restorePurchases.mockResolvedValue(freeInfo() as never);
  apiFetchMock.mockReset();
  apiFetchMock.mockRejectedValue(new Error('offline'));
});

afterEach(() => {
  if (savedIos === undefined) delete process.env.EXPO_PUBLIC_REVENUECAT_IOS_KEY;
  else process.env.EXPO_PUBLIC_REVENUECAT_IOS_KEY = savedIos;
  if (savedAndroid === undefined) delete process.env.EXPO_PUBLIC_REVENUECAT_ANDROID_KEY;
  else process.env.EXPO_PUBLIC_REVENUECAT_ANDROID_KEY = savedAndroid;
  (Platform as { OS: string }).OS = savedOs;
});


describe('serverPlus user+Space scoping and activation pending (Astra #8)', () => {
  function serverActive() {
    return {
      isPlus: true,
      status: 'active',
      expiresAt: '2027-09-01T00:00:00.000Z',
      mediaUsedBytes: 10 * 1024 * 1024,
      mediaLimitBytes: 5 * 1024 * 1024 * 1024,
    };
  }

  function serverInactive() {
    return {
      isPlus: false,
      status: 'inactive',
      expiresAt: null,
      mediaUsedBytes: 10 * 1024 * 1024,
      mediaLimitBytes: 250 * 1024 * 1024,
    };
  }

  function signedIn(userId = 'user-1') {
    setKeysPresent();
    mockSessionUser = { id: userId };
    mockSessionStatus = 'signed_in';
    purchasesMock.getCustomerInfo.mockResolvedValue(freeInfo());
    purchasesMock.getOfferings.mockResolvedValue(offeringsWith(['aoi_plus_monthly']));
  }

  function renderProvider(delays: number[] = [40, 40]) {
    return renderHook(() => useSubscription(), {
      wrapper: ({ children }) => (
        <SubscriptionProvider reconcileDelays={delays}>{children}</SubscriptionProvider>
      ),
    });
  }

  it('purchase + delayed webhook: pending (not failure, not Free), then Plus', async () => {
    signedIn();
    // Webhook has not landed yet.
    apiFetchMock.mockResolvedValue(serverInactive());
    purchasesMock.purchasePackage.mockResolvedValue({ customerInfo: plusInfo() } as never);

    const { result } = renderProvider([20, 20]);
    await waitFor(() => expect(result.current.status).toBe('free'));

    // Gate the first retry: the pending window then stays open until released.
    let releaseRetry: ((v: unknown) => void) | null = null;
    apiFetchMock.mockImplementationOnce(async () => serverInactive());
    apiFetchMock.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          releaseRetry = resolve as (v: unknown) => void;
        }),
    );
    let purchaseResult: Awaited<ReturnType<typeof result.current.purchase>> | null = null;
    const purchaseTask = result.current.purchase('aoi_plus_monthly');
    void purchaseTask.then((r) => {
      purchaseResult = r;
    });
    // Activation pending: unknown backend, never authoritative Free.
    await waitFor(() => expect(result.current.activationPending).toBe(true));
    expect(result.current.serverPlus).toBeNull();

    // Webhook lands; the released retry still sees lag, the next sees Plus.
    apiFetchMock.mockResolvedValue(serverActive());
    (releaseRetry as unknown as (v: unknown) => void)(serverInactive());
    await act(async () => {
      await purchaseTask;
    });
    expect(purchaseResult).toMatchObject({ ok: true });
    await waitFor(() => expect(result.current.serverPlus).toEqual(serverActive()));
    await waitFor(() => expect(result.current.activationPending).toBe(false));
  });

  it('reconciliation stops once Plus arrives', async () => {
    signedIn();
    apiFetchMock.mockResolvedValue(serverActive());
    purchasesMock.purchasePackage.mockResolvedValue({ customerInfo: plusInfo() } as never);

    const { result } = renderProvider([0, 0]);
    await waitFor(() => expect(result.current.status).toBe('free'));
    const callsBefore = apiFetchMock.mock.calls.length;

    await act(async () => {
      await result.current.purchase('aoi_plus_monthly');
    });
    expect(result.current.serverPlus).toEqual(serverActive());
    expect(result.current.activationPending).toBe(false);
    const callsAfter = apiFetchMock.mock.calls.length;
    expect(callsAfter).toBeGreaterThan(callsBefore);
    // Settles: no further reads fire after Plus converges.
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 20));
    });
    expect(apiFetchMock.mock.calls.length).toBe(callsAfter);
  });

  it('webhook never arrives: retries exhaust to known-Free, pending clears', async () => {
    signedIn();
    apiFetchMock.mockResolvedValue(serverInactive());
    purchasesMock.purchasePackage.mockResolvedValue({ customerInfo: plusInfo() } as never);

    const { result } = renderProvider([0, 0]);
    await waitFor(() => expect(result.current.status).toBe('free'));
    let purchaseResult: Awaited<ReturnType<typeof result.current.purchase>> | null = null;
    await act(async () => {
      purchaseResult = await result.current.purchase('aoi_plus_monthly');
    });
    // Store success stands; backend authority converges to known-Free.
    expect(purchaseResult).toMatchObject({ ok: true });
    expect(result.current.activationPending).toBe(false);
    expect(result.current.serverPlus).toEqual(serverInactive());
  });

  it('account change cancels the stale retry (no cross-account overwrite)', async () => {
    signedIn('user-a');
    apiFetchMock.mockResolvedValue(serverInactive());
    purchasesMock.purchasePackage.mockResolvedValue({ customerInfo: plusInfo() } as never);

    const { result, rerender } = renderProvider([20, 20, 20]);
    await waitFor(() => expect(result.current.status).toBe('free'));
    const callsBeforePurchase = apiFetchMock.mock.calls.length;

    // Hold the immediate post-purchase read open.
    let releaseImmediate: ((v: unknown) => void) | null = null;
    apiFetchMock.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          releaseImmediate = resolve as (v: unknown) => void;
        }),
    );
    let purchaseResult: Awaited<ReturnType<typeof result.current.purchase>> | null = null;
    const purchaseTask = result.current.purchase('aoi_plus_monthly');
    void purchaseTask.then((r) => {
      purchaseResult = r;
    });
    await waitFor(() =>
      expect(apiFetchMock.mock.calls.length).toBe(callsBeforePurchase + 1)
    );

    // Switch accounts mid-flight; B's backend says Free.
    mockSessionUser = { id: 'user-b' };
    mockSessionStatus = 'signed_in';
    purchasesMock.getCustomerInfo.mockResolvedValue(freeInfo());
    apiFetchMock.mockResolvedValue(serverInactive());
    await act(async () => {
      rerender();
    });
    await waitFor(() => expect(result.current.status).toBe('free'));
    await waitFor(() => expect(result.current.serverPlus).toEqual(serverInactive()));

    // A's held read resolves Plus late — must be discarded.
    (releaseImmediate as unknown as (v: unknown) => void)(serverActive());
    await act(async () => {
      await purchaseTask;
    });
    expect(purchaseResult).toMatchObject({ ok: false });
    expect(result.current.serverPlus).toEqual(serverInactive());
    expect(result.current.activationPending).toBe(false);
  });

  it('leaving Space A clears Plus immediately; stale A cannot overwrite B', async () => {
    signedIn();
    apiFetchMock.mockResolvedValue(serverActive());

    const { result, rerender } = renderProvider();
    await waitFor(() => expect(result.current.serverPlus).toEqual(serverActive()));

    // Hold an A-scoped read open across the switch.
    let resolveA: ((v: unknown) => void) | null = null;
    let resolveB: ((v: unknown) => void) | null = null;
    apiFetchMock.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          resolveA = resolve as (v: unknown) => void;
        }),
    );
    const callsBeforeRefresh = apiFetchMock.mock.calls.length;
    const refreshTask = result.current.refreshServerPlus();
    void refreshTask.catch(() => {});
    await waitFor(() =>
      expect(apiFetchMock.mock.calls.length).toBe(callsBeforeRefresh + 1)
    );

    // B's own read is held too, so the cleared state is observable.
    apiFetchMock.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          resolveB = resolve as (v: unknown) => void;
        }),
    );
    mockSpaceId = 'space-b';
    apiFetchMock.mockResolvedValue(serverInactive());
    await act(async () => {
      rerender();
    });

    // Synchronous clear: no flash of A's Plus while B resolves.
    await waitFor(() => expect(result.current.serverPlus).toBeNull());
    (resolveB as unknown as (v: unknown) => void)(serverInactive());
    await waitFor(() => expect(result.current.serverPlus).toEqual(serverInactive()));

    // A's held read resolves Plus late — must be discarded.
    (resolveA as unknown as (v: unknown) => void)(serverActive());
    await act(async () => {
      await refreshTask;
    });
    expect(result.current.serverPlus).toEqual(serverInactive());
  });

  it('foreground resume refreshes authoritative Plus (partner purchase converges)', async () => {
    signedIn();
    apiFetchMock.mockResolvedValue(serverInactive());

    const { AppState } = await import('react-native');
    expect(typeof AppState?.addEventListener).toBe('function');
    const spy = vi.spyOn(AppState, 'addEventListener');

    const { result } = renderProvider();
    await waitFor(() => expect(result.current.serverPlus).toEqual(serverInactive()));
    expect(spy).toHaveBeenCalled();
    const handler = spy.mock.calls[0]?.[1] as ((state: string) => void) | undefined;
    expect(typeof handler).toBe('function');
    const callsBefore = apiFetchMock.mock.calls.length;

    apiFetchMock.mockResolvedValue(serverActive());
    await act(async () => {
      handler?.('active');
    });
    await waitFor(() => expect(apiFetchMock.mock.calls.length).toBeGreaterThan(callsBefore));
    await waitFor(() => expect(result.current.serverPlus).toEqual(serverActive()));
    expect(result.current.isPlus).toBe(false);
    spy.mockRestore();
  });

  it('public refresh reconciles provider and server state together', async () => {
    signedIn();
    apiFetchMock.mockResolvedValue(serverInactive());

    const { result } = renderProvider([40, 40]);
    await waitFor(() => expect(result.current.status).toBe('free'));
    await waitFor(() => expect(result.current.serverPlus).toEqual(serverInactive()));

    // Store now claims Plus while the backend lags → pending + reconcile.
    purchasesMock.getCustomerInfo.mockResolvedValue(plusInfo());
    let releaseRetry: ((v: unknown) => void) | null = null;
    apiFetchMock.mockImplementationOnce(async () => serverInactive());
    apiFetchMock.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          releaseRetry = resolve as (v: unknown) => void;
        }),
    );
    const refreshTask = result.current.refresh();
    void refreshTask.catch(() => {});
    await waitFor(() => expect(result.current.activationPending).toBe(true));
    expect(result.current.serverPlus).toBeNull();

    apiFetchMock.mockResolvedValue(serverActive());
    (releaseRetry as unknown as (v: unknown) => void)(serverInactive());
    await act(async () => {
      await refreshTask;
    });
    expect(result.current.status).toBe('plus');
    await waitFor(() => expect(result.current.serverPlus).toEqual(serverActive()));
    await waitFor(() => expect(result.current.activationPending).toBe(false));
  });

  it('unknown and pending never grant gated access', async () => {
    signedIn();
    apiFetchMock.mockResolvedValue(serverInactive());
    purchasesMock.purchasePackage.mockResolvedValue({ customerInfo: plusInfo() } as never);

    const { result } = renderProvider([20, 20]);
    await waitFor(() => expect(result.current.status).toBe('free'));
    let releaseRetry: ((v: unknown) => void) | null = null;
    apiFetchMock.mockImplementationOnce(async () => serverInactive());
    apiFetchMock.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          releaseRetry = resolve as (v: unknown) => void;
        }),
    );
    const purchaseTask = result.current.purchase('aoi_plus_monthly');
    void purchaseTask.catch(() => {});
    await waitFor(() => expect(result.current.activationPending).toBe(true));
    // Provider purchase UX may say plus; authority stays unknown → not-plus.
    expect(result.current.serverPlus).toBeNull();
    expect(result.current.serverPlus?.isPlus ?? false).toBe(false);

    apiFetchMock.mockResolvedValue(serverActive());
    (releaseRetry as unknown as (v: unknown) => void)(serverInactive());
    await act(async () => {
      await purchaseTask;
    });
    await waitFor(() => expect(result.current.activationPending).toBe(false));
  });
});

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type PropsWithChildren,
} from 'react';
import { AppState, Platform } from 'react-native';
import type { PurchasesPackage } from 'react-native-purchases';

import {
  PLUS_ENTITLEMENT_ID,
  getRevenueCatApiKey,
} from '@/features/subscription/config';
import type {
  PurchaseResult,
  RestoreResult,
  ServerPlusState,
  SubscriptionContextValue,
  SubscriptionPlan,
  SubscriptionStatus,
} from '@/features/subscription/types';
import { fetchSpacePlus } from '@/features/subscription/server-plus';
import { useSession } from '@/features/session/session-context';
import { useSpace } from '@/features/space/space-context';

/**
 * Bounded post-purchase reconciliation: the store webhook lands
 * asynchronously, so after a local Plus with a Free backend we re-read a
 * few times then stop. No polling, no background service — a manual
 * refresh, purchase/restore, or foreground event starts a fresh run.
 */
export const PLUS_RECONCILE_DELAYS_MS = [1500, 4000, 9000];

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

let configuredKey: string | null = null;

type PurchasesSdk = typeof import('react-native-purchases');

let purchasesSdk: PurchasesSdk | null = null;
let purchasesLoading: Promise<PurchasesSdk> | null = null;

/**
 * The store SDK is 1.3 MB of generated product metadata, and almost none of
 * the app touches it: web never uses it at all, and a native session only
 * needs it once the store is actually read. Loading it on first use keeps it
 * out of the startup graph instead of charging every screen for the paywall.
 */
function loadPurchases(): Promise<PurchasesSdk> {
  if (!purchasesSdk) {
    purchasesLoading ??= import('react-native-purchases').then(
      (module) => {
        purchasesSdk = module;
        return module;
      },
      (error: unknown) => {
        // Do not cache a rejection: a later attempt should be able to retry.
        purchasesLoading = null;
        throw error;
      },
    );
    return purchasesLoading;
  }
  return Promise.resolve(purchasesSdk);
}

function isStoreAvailable(): boolean {
  if (Platform.OS === 'web') return false;
  return getRevenueCatApiKey() !== null;
}

async function ensureConfigured(): Promise<void> {
  if (Platform.OS === 'web') return;
  const apiKey = getRevenueCatApiKey();
  if (!apiKey || configuredKey === apiKey) return;
  try {
    const { default: Purchases } = await loadPurchases();
    Purchases.configure({ apiKey });
    configuredKey = apiKey;
  } catch {
    configuredKey = null;
  }
}

function toPlan(pkg: PurchasesPackage): SubscriptionPlan {
  return {
    id: pkg.identifier,
    title: pkg.product.title || pkg.identifier,
    priceString: pkg.product.priceString,
    period: pkg.packageType === 'ANNUAL' ? 'yearly' : 'monthly',
  };
}

function isPlusCustomer(info: { entitlements: { active: Record<string, unknown> } }): boolean {
  return Boolean(info.entitlements.active[PLUS_ENTITLEMENT_ID]);
}

export const SubscriptionContext = createContext<SubscriptionContextValue | undefined>(undefined);

export function SubscriptionProvider({
  children,
  reconcileDelays = PLUS_RECONCILE_DELAYS_MS,
}: PropsWithChildren<{ reconcileDelays?: number[] }>) {
  const { user, status: sessionStatus } = useSession();
  const { space } = useSpace();
  const spaceId = space?.id ?? null;
  const [status, setStatus] = useState<SubscriptionStatus>('loading');
  const [plans, setPlans] = useState<SubscriptionPlan[]>([]);
  // Authoritative backend Plus (P8A), scoped to user + Space. Unknown
  // until the server says otherwise — cleared on every identity
  // transition below, never flashed across accounts or Spaces.
  const [serverPlus, setServerPlus] = useState<ServerPlusState>(null);
  // Activation pending: the store claims Plus but the backend has not
  // confirmed it yet. Distinct from unknown (no local signal) and from
  // Free (backend-confirmed). Never grants: gating reads serverPlus only.
  const [activationPending, setActivationPending] = useState(false);
  const generationRef = useRef(0);
  const scopeRef = useRef<{ userId: string | null; spaceId: string | null }>({
    userId: null,
    spaceId: null,
  });

  const scopeAlive = useCallback((gen: number, userId: string | null, sid: string | null): boolean => {
    if (gen !== generationRef.current) return false;
    const scope = scopeRef.current;
    return scope.userId === userId && scope.spaceId === sid;
  }, []);

  const refreshServerPlus = useCallback(async () => {
    const gen = generationRef.current;
    const { userId, spaceId: sid } = scopeRef.current;
    try {
      const snapshot = await fetchSpacePlus();
      if (!scopeAlive(gen, userId, sid)) return;
      setServerPlus(snapshot);
    } catch {
      if (!scopeAlive(gen, userId, sid)) return;
      setServerPlus(null);
    }
  }, [scopeAlive]);

  // Bounded reconciliation for one scope: re-read until backend Plus,
  // scope death, or delay exhaustion (then publish the last authority and
  // clear pending). Mid-window Free reads are swallowed — publishing them
  // would flash authoritative-Free during the webhook delay.
  const reconcileServerPlus = useCallback(
    async (gen: number, userId: string | null, sid: string | null) => {
      let last: ServerPlusState = null;
      for (const delayMs of reconcileDelays) {
        await sleep(delayMs);
        if (!scopeAlive(gen, userId, sid)) return;
        try {
          last = await fetchSpacePlus();
        } catch {
          last = null;
        }
        if (!scopeAlive(gen, userId, sid)) return;
        if (last?.isPlus) {
          setServerPlus(last);
          setActivationPending(false);
          return;
        }
      }
      if (!scopeAlive(gen, userId, sid)) return;
      setServerPlus(last);
      setActivationPending(false);
    },
    [reconcileDelays, scopeAlive]
  );

  // Observe a fresh provider-Plus against the backend: Plus publishes and
  // clears pending; anything else opens the pending window (unknown, never
  // Free) and starts bounded reconciliation. Returns false when the scope
  // died mid-flight (caller must fail safely).
  const reconcileFreshPlus = useCallback(
    async (gen: number, userId: string | null, sid: string | null): Promise<boolean> => {
      let snapshot: ServerPlusState = null;
      try {
        snapshot = await fetchSpacePlus();
      } catch {
        snapshot = null;
      }
      if (!scopeAlive(gen, userId, sid)) return false;
      if (snapshot?.isPlus) {
        setServerPlus(snapshot);
        setActivationPending(false);
        return true;
      }
      setServerPlus(null);
      setActivationPending(true);
      await reconcileServerPlus(gen, userId, sid);
      return scopeAlive(gen, userId, sid);
    },
    [reconcileServerPlus, scopeAlive]
  );

  // Public refresh reconciles BOTH authorities: the store identity and
  // the backend snapshot. A fresh provider-Plus against a lagging backend
  // opens the pending window instead of publishing a stale Free.
  const refresh = useCallback(async () => {
    const gen = generationRef.current;
    const { userId, spaceId: sid } = scopeRef.current;
    if (!isStoreAvailable()) {
      if (!scopeAlive(gen, userId, sid)) return;
      setStatus('unavailable');
      setPlans([]);
      return;
    }

    try {
      await ensureConfigured();
      const { default: Purchases } = await loadPurchases();
      const info = await Purchases.getCustomerInfo();
      if (!scopeAlive(gen, userId, sid)) return;
      const plus = isPlusCustomer(info);
      setStatus(plus ? 'plus' : 'free');
      try {
        const offerings = await Purchases.getOfferings();
        if (!scopeAlive(gen, userId, sid)) return;
        const pkgs = offerings.current?.availablePackages;
        setPlans(pkgs?.length ? pkgs.map(toPlan) : []);
      } catch {
        if (!scopeAlive(gen, userId, sid)) return;
        setPlans([]);
      }
      if (plus) {
        await reconcileFreshPlus(gen, userId, sid);
      } else {
        setActivationPending(false);
        await refreshServerPlus();
      }
    } catch {
      if (!scopeAlive(gen, userId, sid)) return;
      // Entitlement unknown — never collapse into authoritative `free`.
      setStatus('unavailable');
      setPlans([]);
    }
  }, [reconcileFreshPlus, refreshServerPlus, scopeAlive]);

  useEffect(() => {
    generationRef.current += 1;
    const gen = generationRef.current;

    if (sessionStatus === 'loading') {
      setStatus('loading');
      setPlans([]);
      return;
    }

    const uid = user?.id ?? null;

    // Reset before resolving the next identity so B never flashes A's
    // Plus — and a new Space never flashes the old Space's snapshot.
    // Client state, last-known server state, and pending all clear
    // synchronously; the scope pins every async resolution below.
    scopeRef.current = { userId: uid, spaceId };
    setStatus('loading');
    setPlans([]);
    setServerPlus(null);
    setActivationPending(false);

    if (!uid) {
      if (!isStoreAvailable()) {
        setStatus('unavailable');
        return;
      }
      (async () => {
        try {
          await ensureConfigured();
          const { default: Purchases } = await loadPurchases();
          await Purchases.logOut();
        } catch {
          // Identity cleanup is best-effort; local state still clears.
        }
        if (!scopeAlive(gen, uid, spaceId)) return;
        setStatus('free');
        setPlans([]);
      })();
      return;
    }

    if (!isStoreAvailable()) {
      setStatus('unavailable');
      setPlans([]);
      return;
    }

    (async () => {
      try {
        await ensureConfigured();
        const { default: Purchases } = await loadPurchases();
        await Purchases.logIn(uid);
        if (!scopeAlive(gen, uid, spaceId)) return;
        const info = await Purchases.getCustomerInfo();
        if (!scopeAlive(gen, uid, spaceId)) return;
        setStatus(isPlusCustomer(info) ? 'plus' : 'free');
        try {
          const offerings = await Purchases.getOfferings();
          if (!scopeAlive(gen, uid, spaceId)) return;
          const pkgs = offerings.current?.availablePackages;
          setPlans(pkgs?.length ? pkgs.map(toPlan) : []);
        } catch {
          if (!scopeAlive(gen, uid, spaceId)) return;
          setPlans([]);
        }
        // Backend authority resolves alongside the store identity; a stale
        // account/space refresh completing late still cannot overwrite.
        const snapshot = await fetchSpacePlus();
        if (!scopeAlive(gen, uid, spaceId)) return;
        setServerPlus(snapshot);
      } catch {
        if (!scopeAlive(gen, uid, spaceId)) return;
        setStatus('unavailable');
        setPlans([]);
      }
    })();

    // Teardown cancels in-flight reconciliation (unmount or next identity).
    return () => {
      generationRef.current += 1;
    };
  }, [user?.id, sessionStatus, spaceId, scopeAlive, refreshServerPlus]);

  // Foreground/app-resume re-reads authoritative Space Plus so delayed
  // webhooks and partner purchases converge without buying locally.
  // Scoped like every other read: a transition mid-flight discards it.
  useEffect(() => {
    if (!user?.id) return;
    const addListener = AppState?.addEventListener?.bind(AppState);
    if (typeof addListener !== 'function') return;
    const subscription = addListener('change', (state) => {
      if (state === 'active') {
        void refreshServerPlus();
      }
    });
    return () => {
      subscription?.remove?.();
    };
  }, [user?.id, refreshServerPlus]);

  const purchase = useCallback(async (planId: string): Promise<PurchaseResult> => {
    const gen = generationRef.current;
    const { userId, spaceId: sid } = scopeRef.current;
    if (!isStoreAvailable()) {
      return { ok: false, error: 'Purchasing is unavailable right now.', reason: 'unavailable' };
    }
    let cancelledCode: string | undefined;
    try {
      await ensureConfigured();
      const { default: Purchases, PURCHASES_ERROR_CODE } = await loadPurchases();
      cancelledCode = PURCHASES_ERROR_CODE.PURCHASE_CANCELLED_ERROR;
      const offerings = await Purchases.getOfferings();
      const pkgs = offerings.current?.availablePackages ?? [];
      const pkg = pkgs.find((p) => p.identifier === planId);
      if (!pkg) {
        return { ok: false, error: 'That plan is no longer available. Please try again.', reason: 'not_found' };
      }
      const { customerInfo } = await Purchases.purchasePackage(pkg);
      if (!scopeAlive(gen, userId, sid)) {
        return { ok: false, error: 'Account changed. Please try again.', reason: 'failed' };
      }
      const isPlus = isPlusCustomer(customerInfo);
      setStatus(isPlus ? 'plus' : 'free');
      if (!isPlus) {
        return { ok: false, error: 'Purchase did not activate Plus.', reason: 'failed' };
      }
      // Store success is not backend confirmation: the webhook may still
      // be in flight. Confirm, else open the pending window (unknown —
      // never a stale Free, never a purchase failure).
      const alive = await reconcileFreshPlus(gen, userId, sid);
      if (!alive) {
        return { ok: false, error: 'Account changed. Please try again.', reason: 'failed' };
      }
      return { ok: true };
    } catch (e) {
      const err = e as { code?: string; message?: string; userCancelled?: boolean };
      if (err?.userCancelled || err?.code === cancelledCode) {
        return { ok: false, error: 'Purchase canceled.', reason: 'cancelled' };
      }
      return { ok: false, error: err?.message ?? 'Purchase failed. Please try again.', reason: 'failed' };
    }
  }, [reconcileFreshPlus, scopeAlive]);

  const restore = useCallback(async (): Promise<RestoreResult> => {
    const gen = generationRef.current;
    const { userId, spaceId: sid } = scopeRef.current;
    if (!isStoreAvailable()) {
      return { ok: false, error: 'Purchasing is unavailable right now.', reason: 'unavailable' };
    }
    let cancelledCode: string | undefined;
    try {
      await ensureConfigured();
      const { default: Purchases, PURCHASES_ERROR_CODE } = await loadPurchases();
      cancelledCode = PURCHASES_ERROR_CODE.PURCHASE_CANCELLED_ERROR;
      const info = await Purchases.restorePurchases();
      if (!scopeAlive(gen, userId, sid)) {
        return { ok: false, error: 'Account changed. Please try again.', reason: 'failed' };
      }
      const isPlus = isPlusCustomer(info);
      setStatus(isPlus ? 'plus' : 'free');
      if (!isPlus) {
        return { ok: true, isPlus };
      }
      const alive = await reconcileFreshPlus(gen, userId, sid);
      if (!alive) {
        return { ok: false, error: 'Account changed. Please try again.', reason: 'failed' };
      }
      return { ok: true, isPlus };
    } catch (e) {
      const err = e as { code?: string; message?: string; userCancelled?: boolean };
      if (err?.userCancelled || err?.code === cancelledCode) {
        return { ok: false, error: 'Restore canceled.', reason: 'cancelled' };
      }
      return { ok: false, error: 'Could not restore purchases.', reason: 'failed' };
    }
  }, [reconcileFreshPlus, scopeAlive]);

  const value = useMemo<SubscriptionContextValue>(
    () => ({
      status,
      isPlus: status === 'plus',
      isAvailable: status === 'free' || status === 'plus',
      plans,
      purchase,
      restore,
      refresh,
      serverPlus,
      refreshServerPlus,
      activationPending,
    }),
    [status, plans, purchase, restore, refresh, serverPlus, refreshServerPlus, activationPending],
  );

  return <SubscriptionContext.Provider value={value}>{children}</SubscriptionContext.Provider>;
}

export function useSubscription() {
  const ctx = useContext(SubscriptionContext);
  if (!ctx) throw new Error('useSubscription must be used within SubscriptionProvider');
  return ctx;
}

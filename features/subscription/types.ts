/**
 * Fail-closed subscription status (P0B):
 * - loading: checking / resolving (including account-switch reset).
 * - free: positively known no active Plus entitlement.
 * - plus: positively known active Plus entitlement.
 * - unavailable: store unavailable (missing platform key, web) or entitlement
 *   unknown due to network/configuration failure. Purchasing cannot safely
 *   occur here. Never collapse this into `free`.
 */
export type SubscriptionStatus = 'loading' | 'free' | 'plus' | 'unavailable';

export type SubscriptionPlan = {
  id: string;
  title: string;
  priceString: string;
  period: 'monthly' | 'yearly';
};

export type PurchaseResult =
  | { ok: true }
  | { ok: false; error: string; reason?: 'unavailable' | 'not_found' | 'cancelled' | 'failed' };

export type RestoreResult =
  | { ok: true; isPlus: boolean }
  | { ok: false; error: string; reason?: 'unavailable' | 'cancelled' | 'failed' };

export type SubscriptionContextValue = {
  status: SubscriptionStatus;
  isPlus: boolean;
  /** True only when entitlement is known (free or plus). False while loading or unavailable. */
  isAvailable: boolean;
  plans: SubscriptionPlan[];
  purchase: (planId: string) => Promise<PurchaseResult>;
  restore: () => Promise<RestoreResult>;
  refresh: () => Promise<void>;
  /**
   * Authoritative server Plus state (P8A). Null means UNKNOWN — never free,
   * never plus. Protected product behavior must treat unknown as not-plus
   * (fail safely); the P0B client `status`/`isPlus` drives purchase UX only.
   */
  serverPlus: ServerPlusState;
  /** Re-read server Plus (after purchase/restore, or partner refresh). */
  refreshServerPlus: () => Promise<void>;
  /**
   * Activation pending: the store claims Plus but the backend has not
   * confirmed it yet (webhook in flight). Unknown — never Free, never a
   * grant: gated behavior still reads serverPlus only.
   */
  activationPending: boolean;
};

/**
 * Backend entitlement + usage snapshot. `null` (unknown) must fail safely toward
 * not-plus for any protected behavior. Numbers describe the viewer's own
 * Space only.
 */
export type ServerPlusState =
  | {
      isPlus: boolean;
      status: 'active' | 'inactive';
      expiresAt: string | null;
      mediaUsedBytes: number;
      mediaLimitBytes: number;
      activeFutureLetters: number;
      futureLetterLimit: number | null;
    }
  | null;

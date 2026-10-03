import { Redirect, useLocalSearchParams } from 'expo-router';
import { useState } from 'react';

import PaywallScreen from '@/app/(app)/paywall';
import { DevErrorBoundary } from '@/features/dev/preview';
import { SubscriptionContext } from '@/features/subscription/subscription-context';
import type { SubscriptionContextValue } from '@/features/subscription/types';

export default function DevPaywall() {
  if (!__DEV__) return <Redirect href="/" />;
  return <DevPaywallPreview />;
}

function DevPaywallPreview() {
  const { state } = useLocalSearchParams<{ state?: string }>();
  const [reloaded, setReloaded] = useState(false);
  const unavailable = state === 'unavailable' && !reloaded;
  const loading = state === 'loading' && !reloaded;
  const empty = state === 'empty' && !reloaded;
  const value: SubscriptionContextValue = {
    status: unavailable ? 'unavailable' : loading ? 'loading' : state === 'plus' ? 'plus' : 'free',
    isPlus: state === 'plus',
    isAvailable: !unavailable && !loading,
    activationPending: state === 'pending',
    plans: unavailable || loading || empty ? [] : [
      { id: 'preview-monthly', title: 'Monthly', priceString: '$4.99', period: 'monthly' },
      { id: 'preview-yearly', title: 'Yearly', priceString: '$39.99', period: 'yearly' },
    ],
    purchase: async () => ({ ok: false, reason: 'unavailable', error: 'Purchases are disabled in this preview.' }),
    restore: async () => ({ ok: true, isPlus: false }),
    refresh: async () => { setReloaded(true); },
    serverPlus: null,
    refreshServerPlus: async () => {},
  };
  return <SubscriptionContext.Provider value={value}><DevErrorBoundary label="PaywallScreen"><PaywallScreen /></DevErrorBoundary></SubscriptionContext.Provider>;
}

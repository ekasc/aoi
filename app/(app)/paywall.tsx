import { useRouter } from 'expo-router';
import { useState } from 'react';
import { Alert, Pressable, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { ThemedText } from '@/components/themed-text';
import { Button } from '@/components/ui/button';
import { Surface } from '@/components/ui/surface';
import { Spacing } from '@/constants/theme';
import { PLUS_FEATURES } from '@/features/subscription/limits';
import { useSubscription } from '@/features/subscription/subscription-context';
import { useThemeColor } from '@/hooks/use-theme-color';

export default function PaywallScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { status, isPlus, isAvailable, plans, purchase, restore, activationPending } = useSubscription();
  const [selected, setSelected] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const background = useThemeColor({}, 'background');
  const accent = useThemeColor({}, 'accent');
  const danger = useThemeColor({}, 'danger');

  const selectedPlan = plans.find((p) => p.id === (selected ?? plans[1]?.id ?? plans[0]?.id)) ?? plans[0];
  const storeUnavailable = status === 'unavailable';
  const canPurchase = isAvailable && !storeUnavailable && Boolean(selectedPlan) && !busy;

  const handlePurchase = async () => {
    if (!selectedPlan || busy || storeUnavailable) return;
    setBusy(true);
    setError('');
    setNotice('');
    const result = await purchase(selectedPlan.id);
    setBusy(false);
    if (result.ok) {
      router.back();
    } else if (result.error && result.error !== 'Purchase canceled.') {
      setError(result.error);
    }
  };

  const handleRestore = async () => {
    if (busy || storeUnavailable) return;
    setBusy(true);
    setError('');
    setNotice('');
    const result = await restore();
    setBusy(false);
    if (!result.ok) {
      setError(result.error ?? 'Could not restore purchases.');
      return;
    }
    if (result.isPlus) {
      router.back();
      return;
    }
    setNotice('Restore completed, no active Plus found on this account.');
  };

  if (isPlus) {
    return (
      <View style={[styles.center, { backgroundColor: background, paddingTop: insets.top + 24 }]}>
        <ThemedText type="title">You have Aoi Plus</ThemedText>
        <ThemedText type="body" style={styles.sub}>
          Plus is active on this account.
        </ThemedText>
        <Button label="Back" onPress={() => router.back()} />
      </View>
    );
  }

  return (
    <View
      style={[{ flex: 1, backgroundColor: background }]}
    >
      <View style={[styles.content, { paddingTop: insets.top + Spacing[16], paddingBottom: insets.bottom + Spacing[24] }]}>
      <ThemedText type="title" style={styles.hero}>Aoi Plus</ThemedText>
      <ThemedText type="body" style={styles.sub}>
        One Plus covers your whole shared Space, both of you enjoy it.
      </ThemedText>

      {storeUnavailable ? (
        <ThemedText accessibilityRole="alert" type="body" style={styles.sub}>
          Purchasing is currently unavailable. Please try again later.
        </ThemedText>
      ) : null}

      <Surface variant="raised" style={styles.card}>
        {PLUS_FEATURES.map((feature) => (
          <ThemedText key={feature} type="body" style={styles.feature}>
            {'·  '}{feature}
          </ThemedText>
        ))}
      </Surface>

      <View style={styles.plans}>
        {plans.map((plan) => {
          const isSelected = plan.id === (selectedPlan?.id ?? null);
          return (
            <Pressable
              key={plan.id}
              accessibilityRole="button"
              accessibilityLabel={`Choose ${plan.title} ${plan.priceString}`}
              accessibilityState={{ selected: isSelected }}
              onPress={() => setSelected(plan.id)}
              style={[styles.plan, { borderColor: isSelected ? accent : '#00000022', borderWidth: isSelected ? 2 : 1 }]}
            >
              <ThemedText type="body" style={styles.planTitle}>{plan.title}</ThemedText>
              <ThemedText type="title" style={styles.planPrice}>{plan.priceString}</ThemedText>
            </Pressable>
          );
        })}
      </View>

      {error ? (
        <ThemedText accessibilityRole="alert" type="caption" style={{ color: danger }}>
          {error}
        </ThemedText>
      ) : null}

      {notice ? (
        <ThemedText type="caption" style={styles.fine}>
          {notice}
        </ThemedText>
      ) : null}

      {activationPending && !isPlus ? (
        <ThemedText type="caption" style={styles.fine}>
          Purchase received, confirming Plus on your Space…
        </ThemedText>
      ) : null}

      {plans.length === 0 && !storeUnavailable && status !== 'loading' ? (
        <ThemedText type="caption" style={styles.fine}>
          No plans available yet. Please try again later.
        </ThemedText>
      ) : null}

      <Button
        label={busy ? 'Working…' : status === 'loading' ? 'Loading plans…' : storeUnavailable ? 'Purchasing unavailable' : `Continue, ${selectedPlan?.priceString ?? ''}`}
        onPress={handlePurchase}
        disabled={!canPurchase}
      />
      <Button label={busy ? 'Working…' : 'Restore purchase'} variant="secondary" onPress={handleRestore} disabled={busy || storeUnavailable} />
      <Button label="Not now" variant="ghost" onPress={() => router.back()} disabled={busy} />

      <ThemedText type="caption" style={styles.fine}>
        Billed through Apple / Google where available. Cancel anytime. Prices vary by region.
      </ThemedText>
      <Pressable
        accessibilityRole="button"
        onPress={() => Alert.alert('Why Plus?', 'Plus raises your shared Space limits, more room for photos and voice, more future letters, and PDF chapter keepsakes. One purchase covers you both.')}
      >
        <ThemedText type="caption" style={styles.fine}>Why Plus?</ThemedText>
      </Pressable>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  content: {
    flex: 1,
    justifyContent: 'center',
    gap: Spacing[12],
    paddingHorizontal: Spacing[16],
    maxWidth: 560,
    width: '100%',
    alignSelf: 'center',
  },
  center: {
    flex: 1,
    gap: Spacing[12],
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: Spacing[16],
  },
  hero: {
    textAlign: 'center',
  },
  sub: {
    textAlign: 'center',
    opacity: 0.8,
  },
  card: {
    gap: Spacing[8],
  },
  feature: {
    fontWeight: '500',
  },
  plans: {
    flexDirection: 'row',
    gap: Spacing[12],
  },
  plan: {
    flex: 1,
    borderRadius: 16,
    padding: Spacing[12],
    alignItems: 'center',
    gap: 4,
  },
  planTitle: {
    opacity: 0.7,
  },
  planPrice: {
    fontWeight: '700',
  },
  fine: {
    textAlign: 'center',
    opacity: 0.6,
  },
});

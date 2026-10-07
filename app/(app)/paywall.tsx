import { Ionicons } from '@expo/vector-icons';
import { useRouter, useLocalSearchParams } from 'expo-router';
import { useCallback, useRef, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { ThemedText } from '@/components/themed-text';
import { Button } from '@/components/ui/button';
import { NativeSheet } from '@/components/ui/native-sheet';
import { Surface } from '@/components/ui/surface';
import { Radii, Spacing, withAlpha } from '@/constants/theme';
import { PLUS_FEATURES } from '@/features/subscription/limits';
import { SKY_HISTORY_PLUS } from '@/features/home/sky-history';
import { useSubscription } from '@/features/subscription/subscription-context';
import { useThemeColor } from '@/hooks/use-theme-color';

/**
 * What Plus actually does, in the reader's own terms rather than as a list
 * of features. Lives in the app's own sheet instead of a system alert, so it
 * is reachable, themeable and announced properly.
 */
const PLUS_EXPLANATION =
  'Plus gives your shared archive more storage, more letters for the future, PDF chapter keepsakes, and Sky History — the ability to rewind your sky to any month you have been together. Your live sky, shared memories, plans and everyday resurfacing stay free. One purchase covers both of you.';

export default function PaywallScreen() {
  const router = useRouter();
  // Which lock sent the reader here. One line about the feature they were
  // trying to use, above the unchanged plan shelf — not a second paywall.
  const { feature } = useLocalSearchParams<{ feature?: string }>();
  const soughtFeature = feature === 'sky-history' ? SKY_HISTORY_PLUS : null;
  const insets = useSafeAreaInsets();
  const { status, isPlus, isAvailable, plans, purchase, restore, refresh, activationPending } = useSubscription();
  const [selected, setSelected] = useState<string | null>(null);
  const [operation, setOperation] = useState<'purchase' | 'restore' | 'refresh' | null>(null);
  const operationRef = useRef(false);
  const busy = operation !== null;
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [explaining, setExplaining] = useState(false);
  const background = useThemeColor({}, 'background');
  const accent = useThemeColor({}, 'accent');
  const accentInk = useThemeColor({}, 'accentInk');
  const border = useThemeColor({}, 'border');
  const textSecondary = useThemeColor({}, 'textSecondary');
  const textMuted = useThemeColor({}, 'textMuted');
  const danger = useThemeColor({}, 'danger');

  // No plan is preselected. The shelf highlights what the reader taps, and
  // the Continue button stays disabled until they have actually chosen —
  // quietly defaulting to the second option is the sort of thing that reads
  // as a trick once someone notices it.
  const selectedPlan = plans.find((p) => p.id === selected) ?? null;
  const storeUnavailable = status === 'unavailable';
  const canPurchase = isAvailable && !storeUnavailable && Boolean(selectedPlan) && !busy && !activationPending;

  const handlePurchase = async () => {
    if (!canPurchase || !selectedPlan || operationRef.current) return;
    operationRef.current = true;
    setOperation('purchase');
    setError('');
    setNotice('');
    try {
      const result = await purchase(selectedPlan.id);
      if (result.ok) {
        router.back();
      } else if (result.reason !== 'cancelled' && result.error !== 'Purchase canceled.') {
        setError(result.error);
      }
    } catch {
      setError('Could not complete your purchase. Please try again.');
    } finally {
      operationRef.current = false;
      setOperation(null);
    }
  };

  const handleRestore = async () => {
    if (operationRef.current || storeUnavailable || !isAvailable || activationPending) return;
    operationRef.current = true;
    setOperation('restore');
    setError('');
    setNotice('');
    try {
      const result = await restore();
      if (!result.ok) {
        setError(result.error ?? 'Could not restore purchases.');
      } else if (result.isPlus) {
        router.back();
      } else {
        setNotice('Restore completed, no active Plus found on this account.');
      }
    } catch {
      setError('Could not restore purchases. Please try again.');
    } finally {
      operationRef.current = false;
      setOperation(null);
    }
  };

  const handleRefresh = async () => {
    if (operationRef.current) return;
    operationRef.current = true;
    setOperation('refresh');
    setError('');
    setNotice('');
    try {
      await refresh();
    } catch {
      setError('Could not load plans. Please try again.');
    } finally {
      operationRef.current = false;
      setOperation(null);
    }
  };

  const handleCloseExplanation = useCallback(() => setExplaining(false), []);

  if (isPlus) {
    return (
      <View style={[styles.center, { backgroundColor: background, paddingTop: Spacing[24] }]}>
        <ThemedText type="title">You have Aoi Plus</ThemedText>
        <ThemedText type="body" style={styles.sub}>
          Plus is active on this account.
        </ThemedText>
        <Button label="Back" onPress={() => router.back()} />
      </View>
    );
  }

  return (
    <ScrollView
      contentContainerStyle={[
        styles.content,
        {
          paddingTop: Spacing[24],
          paddingBottom: insets.bottom + Spacing[32],
        },
      ]}
      contentInsetAdjustmentBehavior="never"
      showsVerticalScrollIndicator={false}
      style={{ backgroundColor: background }}
    >
      <ThemedText type="body" style={styles.sub}>
        More room to preserve what you share. One Plus covers your shared Space.
      </ThemedText>

      {storeUnavailable ? (
        <ThemedText accessibilityRole="alert" type="body" style={{ color: danger }}>
          Purchasing is currently unavailable. Please try again later.
        </ThemedText>
      ) : null}

      <Surface variant="raised" style={styles.card}>
        {PLUS_FEATURES.map((feature) => (
          // A real list row, so a screen reader announces three separate
          // features rather than one run of "dot dot" prefixed text.
          <View key={feature} style={styles.feature}>
            <Ionicons color={accentInk} name="checkmark" size={18} />
            <ThemedText type="body" style={styles.featureText}>
              {feature}
            </ThemedText>
          </View>
        ))}
      </Surface>

      {soughtFeature ? (
        <Surface style={styles.sought}>
          <ThemedText type="subheading">{soughtFeature.title}</ThemedText>
          <ThemedText type="caption" style={{ color: textSecondary }}>
            {soughtFeature.body}
          </ThemedText>
        </Surface>
      ) : null}

      {plans.length > 0 ? (
        <View accessibilityRole="radiogroup" style={styles.plans}>
          {plans.map((plan) => {
            const isSelected = plan.id === selectedPlan?.id;
            return (
              <Pressable
                accessibilityRole="radio"
                aria-checked={isSelected}
                accessibilityLabel={`${plan.title}, ${plan.priceString}`}
                accessibilityState={{ checked: isSelected, disabled: busy || activationPending }}
                disabled={busy || activationPending}
                key={plan.id}
                onPress={() => { if (!operationRef.current && !activationPending) setSelected(plan.id); }}
                style={({ pressed }) => [
                  styles.plan,
                  {
                    // Colour carries selection, never a width change: a
                    // selected card that grows a pixel reflows the whole
                    // shelf at the moment of the tap.
                    backgroundColor: isSelected ? withAlpha(accent, 0.1) : 'transparent',
                    borderColor: isSelected ? accent : border,
                    opacity: busy ? 0.55 : pressed ? 0.85 : 1,
                  },
                ]}
              >
                <ThemedText type="bodyEmphasis">{plan.title}</ThemedText>
                <ThemedText type="title">{plan.priceString}</ThemedText>
              </Pressable>
            );
          })}
        </View>
      ) : null}

      {/* Every status line is a live region: on a slow store connection this
          is the only thing telling the reader the purchase landed. */}
      <View accessibilityLiveRegion="polite" style={styles.status}>
        {error ? (
          <ThemedText accessibilityRole="alert" type="caption" style={{ color: danger }}>
            {error}
          </ThemedText>
        ) : null}
        {notice ? (
          <ThemedText type="caption" style={{ color: textSecondary }}>
            {notice}
          </ThemedText>
        ) : null}
        {activationPending && !isPlus ? (
          <ThemedText type="caption" style={{ color: textSecondary }}>
            Purchase received, confirming Plus on your Space…
          </ThemedText>
        ) : null}
        {plans.length === 0 && !storeUnavailable && status !== 'loading' ? (
          <ThemedText type="caption" style={{ color: textSecondary }}>
            No plans available yet. Please try again later.
          </ThemedText>
        ) : null}
      </View>

      <View style={styles.actions}>
        <Button
          disabled={!canPurchase}
          accessibilityState={{ busy: operation === 'purchase', disabled: !canPurchase }}
          accessibilityLiveRegion="polite"
          label={
            operation === 'purchase'
              ? 'Purchasing…'
              : activationPending
                ? 'Confirming Plus…'
              : status === 'loading'
                ? 'Loading plans…'
                : storeUnavailable
                  ? 'Purchasing unavailable'
                  : selectedPlan
                    ? `Continue, ${selectedPlan.priceString}`
                    : 'Choose a plan'
          }
          onPress={handlePurchase}
        />
        <Button
          disabled={busy || storeUnavailable || !isAvailable || activationPending}
          accessibilityState={{ busy: operation === 'restore', disabled: busy || storeUnavailable || !isAvailable || activationPending }}
          accessibilityLiveRegion="polite"
          label={operation === 'restore' ? 'Restoring…' : 'Restore purchase'}
          onPress={handleRestore}
          variant="secondary"
        />
        {(storeUnavailable || plans.length === 0) && status !== 'loading' && !activationPending ? (
          <Button
            label={operation === 'refresh' ? 'Loading plans…' : 'Retry plans'}
            disabled={busy}
            accessibilityState={{ busy: operation === 'refresh', disabled: busy }}
            onPress={handleRefresh}
            variant="ghost"
          />
        ) : null}
      </View>

      <View style={styles.fine}>
        <ThemedText type="caption" style={{ color: textMuted, textAlign: 'center' }}>
          Billed through Apple / Google where available. Cancel anytime. Prices vary by region.
        </ThemedText>
        <Pressable
          accessibilityHint="Explains what Aoi Plus includes"
          accessibilityLabel="Why Plus?"
          accessibilityRole="button"
          hitSlop={Spacing[12]}
          onPress={() => setExplaining(true)}
          style={({ pressed }) => [styles.whyButton, pressed && styles.whyButtonPressed]}
        >
          <ThemedText type="caption" style={{ color: accentInk, textAlign: 'center' }}>
            Why Plus?
          </ThemedText>
        </Pressable>
      </View>

      <NativeSheet onClose={handleCloseExplanation} visible={explaining}>
        <View accessibilityViewIsModal style={styles.explanation}>
          <ThemedText type="title">Why Plus?</ThemedText>
          <ThemedText type="body" style={{ color: textSecondary }}>
            {PLUS_EXPLANATION}
          </ThemedText>
          <Button label="Got it" onPress={handleCloseExplanation} />
        </View>
      </NativeSheet>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  content: {
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
  sub: {
    textAlign: 'center',
  },
  card: {
    gap: Spacing[8],
  },
  feature: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: Spacing[8],
  },
  featureText: {
    flex: 1,
  },
  sought: {
    gap: Spacing[4],
  },
  plans: {
    flexDirection: 'row',
    gap: Spacing[12],
  },
  plan: {
    flex: 1,
    alignItems: 'center',
    borderRadius: Radii.card,
    borderWidth: 1,
    gap: Spacing[4],
    minHeight: 72,
    justifyContent: 'center',
    padding: Spacing[12],
  },
  status: {
    gap: Spacing[4],
  },
  actions: {
    gap: Spacing[8],
  },
  fine: {
    alignItems: 'center',
    gap: Spacing[4],
  },
  whyButton: {
    alignItems: 'center',
    justifyContent: 'center',
    minHeight: 44,
    paddingHorizontal: Spacing[12],
  },
  whyButtonPressed: {
    opacity: 0.6,
  },
  explanation: {
    gap: Spacing[12],
    padding: Spacing[16],
    paddingBottom: Spacing[32],
  },
});

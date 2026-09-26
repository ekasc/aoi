import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { useCallback, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { ThemedText } from '@/components/themed-text';
import { Button } from '@/components/ui/button';
import { NativeSheet } from '@/components/ui/native-sheet';
import { Surface } from '@/components/ui/surface';
import { Radii, Spacing, withAlpha } from '@/constants/theme';
import { PLUS_FEATURES } from '@/features/subscription/limits';
import { useSubscription } from '@/features/subscription/subscription-context';
import { useThemeColor } from '@/hooks/use-theme-color';

/**
 * What Plus actually does, in the reader's own terms rather than as a list
 * of features. Lives in the app's own sheet instead of a system alert, so it
 * is reachable, themeable and announced properly.
 */
const PLUS_EXPLANATION =
  'Plus raises the limits on your shared Space: more room for photos and voice, more letters for the future, and PDF chapter keepsakes. One purchase covers both of you.';

export default function PaywallScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { status, isPlus, isAvailable, plans, purchase, restore, activationPending } = useSubscription();
  const [selected, setSelected] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
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

  const handleCloseExplanation = useCallback(() => setExplaining(false), []);

  if (isPlus) {
    return (
      <View style={[styles.center, { backgroundColor: background, paddingTop: insets.top + Spacing[24] }]}>
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
          paddingTop: insets.top + Spacing[24],
          paddingBottom: insets.bottom + Spacing[32],
        },
      ]}
      contentInsetAdjustmentBehavior="never"
      showsVerticalScrollIndicator={false}
      style={{ backgroundColor: background }}
    >
      <ThemedText type="display">Aoi Plus</ThemedText>
      <ThemedText type="body" style={styles.sub}>
        One Plus covers your whole shared Space, both of you enjoy it.
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

      {plans.length > 0 ? (
        <View accessibilityRole="radiogroup" style={styles.plans}>
          {plans.map((plan) => {
            const isSelected = plan.id === selectedPlan?.id;
            return (
              <Pressable
                accessibilityRole="radio"
                accessibilityLabel={`${plan.title}, ${plan.priceString}`}
                accessibilityState={{ checked: isSelected, disabled: busy }}
                key={plan.id}
                onPress={() => setSelected(plan.id)}
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
          label={
            busy
              ? 'Working…'
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
          disabled={busy || storeUnavailable}
          label={busy ? 'Working…' : 'Restore purchase'}
          onPress={handleRestore}
          variant="secondary"
        />
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

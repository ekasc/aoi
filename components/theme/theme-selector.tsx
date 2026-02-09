import { useEffect, useMemo } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import Animated, { FadeIn, ReduceMotion } from 'react-native-reanimated';

import { ThemedText } from '@/components/themed-text';
import {
  BeachThemeOrder,
  BeachThemes,
  type BeachThemeId,
} from '@/constants/theme-presets';
import { Spacing } from '@/constants/theme';
import { useAoiTheme } from '@/features/theme/theme-context';
import { useThemeColor } from '@/hooks/use-theme-color';

type ThemeSelectorProps = {
  showDescriptions?: boolean;
};

type ThemeSwatchProps = {
  accent: string;
  partnerAccent: string;
  thread: string;
};

function ThemeSwatch({ accent, partnerAccent, thread }: ThemeSwatchProps) {
  return (
    <View style={styles.swatchRow}>
      <View style={[styles.swatchDot, { backgroundColor: accent }]} />
      <View style={[styles.swatchDot, { backgroundColor: partnerAccent }]} />
      <View style={[styles.swatchDot, { backgroundColor: thread }]} />
    </View>
  );
}

let hasPlayedThemeSelectorIntro = false;

export function ThemeSelector({ showDescriptions = true }: ThemeSelectorProps) {
  const { selectedThemeId, setSelectedThemeId, mode } = useAoiTheme();
  const shouldAnimateIntro =
    process.env.EXPO_OS !== 'android' && !hasPlayedThemeSelectorIntro;
  const border = useThemeColor({}, 'border');
  const surface = useThemeColor({}, 'surface');
  const surface2 = useThemeColor({}, 'surface2');
  const accent = useThemeColor({}, 'accent');
  const text = useThemeColor({}, 'text');
  const muted = useThemeColor({}, 'muted');
  const onAccent = useThemeColor({}, 'onAccent');

  const themes = useMemo(
    () => BeachThemeOrder.map((themeId) => BeachThemes[themeId]),
    []
  );

  useEffect(() => {
    hasPlayedThemeSelectorIntro = true;
  }, []);

  return (
    <View style={styles.container}>
      {themes.map((theme, index) => {
        const isSelected = selectedThemeId === theme.id;
        const palette = theme[mode];
        const handleSelect = () => void setSelectedThemeId(theme.id as BeachThemeId);

        return (
          <Animated.View
            entering={
              shouldAnimateIntro
                ? FadeIn.duration(240).delay(index * 80).reduceMotion(ReduceMotion.System)
                : undefined
            }
            key={theme.id}
          >
            <Pressable
              accessibilityLabel={`Choose ${theme.name} theme`}
              accessibilityRole="button"
              onPress={handleSelect}
              style={[
                styles.option,
                {
                  borderColor: isSelected ? accent : border,
                  backgroundColor: isSelected ? accent : surface,
                },
              ]}
            >
              <View style={styles.optionTopRow}>
                <View style={styles.labelBlock}>
                  <ThemedText
                    type="title"
                    style={{ color: isSelected ? onAccent : text }}
                    selectable
                  >
                    {theme.name}
                  </ThemedText>
                  {showDescriptions ? (
                    <ThemedText
                      type="caption"
                      style={{ color: isSelected ? onAccent : muted }}
                      selectable
                    >
                      {theme.description}
                    </ThemedText>
                  ) : null}
                </View>
                <ThemeSwatch
                  accent={palette.accent}
                  partnerAccent={palette.partnerAccent}
                  thread={palette.thread}
                />
              </View>

              <View
                style={[
                  styles.sampleStrip,
                  { borderColor: isSelected ? onAccent : border, backgroundColor: surface2 },
                ]}
              >
                <View style={[styles.sampleCell, { backgroundColor: palette.background }]} />
                <View style={[styles.sampleCell, { backgroundColor: palette.surface }]} />
                <View style={[styles.sampleCell, { backgroundColor: palette.surface2 }]} />
              </View>
            </Pressable>
          </Animated.View>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    gap: Spacing[8],
  },
  option: {
    minHeight: 44,
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: 18,
    borderCurve: 'continuous',
    padding: Spacing[12],
    gap: Spacing[8],
  },
  optionTopRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    gap: Spacing[8],
  },
  labelBlock: {
    flex: 1,
    gap: Spacing[4],
  },
  swatchRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginTop: 2,
  },
  swatchDot: {
    width: 12,
    height: 12,
    borderRadius: 999,
  },
  sampleStrip: {
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: 12,
    overflow: 'hidden',
    flexDirection: 'row',
  },
  sampleCell: {
    flex: 1,
    height: 12,
  },
});

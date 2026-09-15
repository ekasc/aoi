import { Redirect } from 'expo-router';
import { useState } from 'react';
import { StyleSheet, View } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { Button } from '@/components/ui/button';
import { Divider } from '@/components/ui/divider';
import { MediaFrame } from '@/components/ui/media-frame';
import { Screen } from '@/components/ui/screen';
import { SectionHeading } from '@/components/ui/section-heading';
import { PaperTextInput } from '@/components/ui/text-input';
import { Spacing } from '@/constants/theme';
import { useAoiTheme } from '@/features/theme/theme-context';

/**
 * Development-only visual reference for the Editorial Paper foundation.
 * Not linked from any navigation; for design inspection on web/device.
 * Uses neutral labels only — no sample relationship content.
 *
 * Genuinely development-only: production builds (`__DEV__ === false`)
 * redirect to the app root instead of rendering gallery content.
 */
export default function DevFoundations() {
  if (!__DEV__) {
    return <Redirect href="/" />;
  }
  return <FoundationsGallery />;
}

function FoundationsGallery() {
  const { colors } = useAoiTheme();
  const [inputValue, setInputValue] = useState('');
  const [busy, setBusy] = useState(false);

  const swatches: { name: string; value: string }[] = [
    { name: 'background', value: colors.background },
    { name: 'backgroundSubtle', value: colors.backgroundSubtle },
    { name: 'surface', value: colors.surface },
    { name: 'textPrimary', value: colors.textPrimary },
    { name: 'textSecondary', value: colors.textSecondary },
    { name: 'textMuted', value: colors.textMuted },
    { name: 'border', value: colors.border },
    { name: 'borderStrong', value: colors.borderStrong },
    { name: 'primary', value: colors.primary },
    { name: 'primaryPressed', value: colors.primaryPressed },
    { name: 'primaryText', value: colors.primaryText },
    { name: 'accent', value: colors.accent },
    { name: 'destructive', value: colors.destructive },
    { name: 'destructiveBackground', value: colors.destructiveBackground },
    { name: 'disabled', value: colors.disabled },
    { name: 'overlay', value: colors.overlay },
  ];

  return (
    <Screen scroll>
      <SectionHeading kicker="Reference" title="Foundations" />
      <ThemedText type="body">
        Neutral reference sheet for palette, type, controls, and rhythm.
      </ThemedText>

      <SectionHeading kicker="Color" title="Palette roles" />
      <View style={styles.swatches}>
        {swatches.map((swatch) => (
          <View key={swatch.name} style={styles.swatchRow}>
            <View style={[styles.swatchDot, { backgroundColor: swatch.value }]} />
            <ThemedText type="supporting" style={styles.swatchName}>
              {swatch.name}
            </ThemedText>
            <ThemedText type="caption">{swatch.value}</ThemedText>
          </View>
        ))}
      </View>

      <Divider />

      <SectionHeading kicker="Type" title="Typography roles" />
      <ThemedText type="display">Display heading</ThemedText>
      <ThemedText type="title">Content title</ThemedText>
      <ThemedText type="body">
        Body copy carries the quiet reading surface of the archive.
      </ThemedText>
      <ThemedText type="bodyEmphasis">Body emphasis for gentle stress.</ThemedText>
      <ThemedText type="supporting">Supporting detail in a smaller measure.</ThemedText>
      <ThemedText type="caption">Caption for timestamps and hints.</ThemedText>
      <ThemedText type="label">Field label</ThemedText>
      <ThemedText type="meta">Section kicker</ThemedText>

      <Divider />

      <SectionHeading kicker="Controls" title="Buttons" />
      <Button label="Primary action" onPress={() => setBusy((value) => !value)} />
      <Button label="Secondary action" variant="secondary" onPress={() => {}} />
      <Button label="Text action" variant="ghost" onPress={() => {}} />
      <Button label="Destructive action" variant="destructive" onPress={() => {}} />
      <Button label={busy ? 'Working…' : 'Disabled state'} disabled onPress={() => {}} />

      <Divider />

      <SectionHeading kicker="Controls" title="Inputs" />
      <PaperTextInput
        label="Field label"
        value={inputValue}
        onChangeText={setInputValue}
        placeholder="Placeholder text"
      />
      <PaperTextInput
        label="Field with error"
        value={inputValue}
        onChangeText={setInputValue}
        placeholder="Placeholder text"
        error="Something needs attention."
      />
      <PaperTextInput
        label="Disabled field"
        value="Unavailable value"
        placeholder="Placeholder text"
        editable={false}
      />

      <Divider />

      <SectionHeading kicker="Media" title="Image frame" />
      <MediaFrame>
        <ThemedText type="caption">4:3 media placeholder</ThemedText>
      </MediaFrame>

      <ThemedText type="caption">
        Gutter 16 · section rhythm 24 · hairline borders · touch minimum 44.
      </ThemedText>
    </Screen>
  );
}

const styles = StyleSheet.create({
  swatches: {
    gap: Spacing[8],
  },
  swatchRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing[8],
  },
  swatchDot: {
    width: 20,
    height: 20,
    borderRadius: 10,
  },
  swatchName: {
    flex: 1,
  },
});

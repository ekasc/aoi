import { Image } from 'expo-image';
import { StyleSheet, View } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { Button } from '@/components/ui/button';
import { Screen } from '@/components/ui/screen';
import { Spacing } from '@/constants/theme';
import type { PhotoCheck } from '@/features/album/photo-check';

export function PhotoCheckScreen({ result, busy, checking, onChoose, onCancel }: {
  result: PhotoCheck | null; busy: boolean; checking: boolean;
  onChoose: () => void; onCancel: () => void;
}) {
  return <Screen scroll>
    <View style={styles.content}>
      <ThemedText>Choose a photo you know contains both of you.</ThemedText>
      <ThemedText type="caption">This pauses discovery. Your photo stays on this phone and is not added to your album.</ThemedText>
      <Button label={result?.kind === 'ready' ? 'Choose another photo' : 'Choose a photo'} onPress={onChoose} disabled={busy} />
      {checking ? <>
        <ThemedText accessibilityLiveRegion="polite">Preparing face previews…</ThemedText>
        <Button label="Cancel check" variant="secondary" onPress={onCancel} />
      </> : null}
      {!result && !checking ? <ThemedText>No photo selected yet.</ThemedText> : null}
      {result?.kind === 'cancelled' ? <ThemedText accessibilityLiveRegion="polite">Check canceled. You can choose another photo.</ThemedText> : null}
      {result?.kind === 'failed' ? <ThemedText accessibilityRole="alert">{result.message}</ThemedText> : null}
      {result?.kind === 'ready' ? <View style={styles.content}>
        <ThemedText accessibilityLiveRegion="polite">{result.detected === 0 ? 'No faces were found. Try a clearer photo.' : result.detected === 1 ? 'Only one face was found. Try a photo where both faces are visible.' : `${result.detected} faces found.`}</ThemedText>
        {result.detected > 0 ? <>
          <ThemedText>Are the faces upright, with eyes, nose, and mouth visible?</ThemedText>
          <View style={styles.crops}>
            {result.crops.map((crop) => <View key={crop.face} style={styles.crop}>
              <ThemedText type="label">Face {crop.face}</ThemedText>
              {crop.uri ? <Image source={{ uri: crop.uri }} cachePolicy="none" contentFit="contain" style={styles.image} accessibilityLabel={`Aligned preview of face ${crop.face}`} />
                : <ThemedText>Could not prepare this face. Try a clearer photo.</ThemedText>}
            </View>)}
          </View>
          {result.detected > 8 ? <ThemedText type="caption">Showing the first eight faces.</ThemedText> : null}
          <ThemedText type="caption">This checks how faces are prepared, not who they belong to. If a face is cut off, sideways, or missing, tell me what you see.</ThemedText>
        </> : null}
      </View> : null}
    </View>
  </Screen>;
}

const styles = StyleSheet.create({
  content: { gap: Spacing[16] }, crops: { flexDirection: 'row', flexWrap: 'wrap', gap: Spacing[16] },
  crop: { flexGrow: 1, flexBasis: 144, gap: Spacing[8] }, image: { width: '100%', aspectRatio: 1 },
});

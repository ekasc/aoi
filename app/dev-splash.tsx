import { Redirect, useLocalSearchParams } from 'expo-router';
import { Stack } from 'expo-router/stack';
import { useCallback, useEffect, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { useSharedValue } from 'react-native-reanimated';

import { LaunchSplash } from '@/components/launch-splash';
import { ThemedText } from '@/components/themed-text';
import { Button } from '@/components/ui/button';
import { BeachThemeOrder, BeachThemes } from '@/constants/theme-presets';
import { useAoiTheme } from '@/features/theme/theme-context';

export default function DevSplash() {
  if (!__DEV__) return <Redirect href="/" />;
  return <><Stack.Screen options={{ headerShown: false }} /><SplashPreview /></>;
}

function SplashPreview() {
  const { frame, exit: exitFrame } = useLocalSearchParams<{ frame?: string; exit?: string }>();
  const requestedFrame = frame === undefined ? undefined : Number(frame);
  const stillFrame = requestedFrame !== undefined && Number.isFinite(requestedFrame)
    ? Math.min(1, Math.max(0, requestedFrame)) : undefined;
  const artworkProgress = useSharedValue(stillFrame ?? 1);
  useEffect(() => { artworkProgress.value = stillFrame ?? 1; }, [artworkProgress, stillFrame]);
  const requestedExit = exitFrame === undefined ? undefined : Number(exitFrame);
  const stillExit = requestedExit !== undefined && Number.isFinite(requestedExit) ? Math.min(1, Math.max(0, requestedExit)) : undefined;
  const exitProgress = useSharedValue(stillExit ?? 0);
  useEffect(() => { exitProgress.value = stillExit ?? 0; }, [exitProgress, stillExit]);
  const { colors, selectedThemeId, setSelectedThemeId } = useAoiTheme();
  const [ready, setReady] = useState(false);
  const [visible, setVisible] = useState(true);
  const [replay, setReplay] = useState(0);
  const hide = useCallback(() => setVisible(false), []);

  function restart() {
    setReady(false);
    setVisible(true);
    setReplay((value) => value + 1);
  }

  function replayFastLaunch() {
    setReady(true);
    setVisible(true);
    setReplay((value) => value + 1);
  }

  return (
    <View style={[styles.root, { backgroundColor: colors.background }]}>
      <View style={styles.result}>
        <ThemedText type="title">Splash dismissed</ThemedText>
        <Button label="Replay splash" onPress={restart} />
      </View>
      {visible ? <LaunchSplash key={`${selectedThemeId}-${replay}`} ready={ready} onHidden={hide}
        artworkProgress={stillFrame === undefined ? undefined : artworkProgress}
        exitProgress={stillExit === undefined ? undefined : exitProgress} /> : null}
      <View style={[styles.controls, { backgroundColor: colors.surface }]}>
        <Button label={`Theme: ${BeachThemes[selectedThemeId].name}`} variant="secondary" onPress={() => {
          const next = BeachThemeOrder[(BeachThemeOrder.indexOf(selectedThemeId) + 1) % BeachThemeOrder.length];
          void setSelectedThemeId(next);
          restart();
        }} />
        <Button label="Finish loading" onPress={() => setReady(true)} disabled={!visible || ready} />
        <Button label="Replay fast launch" variant="secondary" onPress={replayFastLaunch} />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  result: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 20 },
  controls: { position: 'absolute', top: 40, left: 16, right: 16, padding: 12, gap: 8, borderRadius: 16 },
});

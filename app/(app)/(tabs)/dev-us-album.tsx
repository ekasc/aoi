import * as ImagePicker from 'expo-image-picker';
import { Stack } from 'expo-router';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { ScrollView, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { ThemedText } from '@/components/themed-text';
import { Button } from '@/components/ui/button';
import { Spacing } from '@/constants/theme';
import { openAlbumMedia, sealAlbumMedia } from '@/features/album/album';
import { generateMediaKey } from '@/features/album/crypto';
import { generateDeviceKeys, spaceKeyFor, verificationFingerprint } from '@/features/album/keys';
import { createLocalAlbumRepository } from '@/features/album/local-album-repository';
import { generateRecoveryPhrase, spaceKeyFromPhrase } from '@/features/album/recovery';
import { useThemeColor } from '@/hooks/use-theme-color';

/**
 * THROWAWAY. A test rig, not a screen.
 *
 * It exists so the part of the album that actually carries risk can be
 * exercised on a real phone without a native build: the key stack is pure JS
 * plus expo-secure-store, so all of it runs in Expo Go today.
 *
 * What it does, end to end:
 *   1. makes a real identity for this device
 *   2. shows the fingerprint, which is the thing two people compare
 *   3. shows a recovery phrase, once
 *   4. picks photos, seals each one under a random media key, wraps that
 *      under the space key, and stores it through the local repository
 *   5. reads them back, so a round trip is visible rather than asserted
 *
 * What it cannot do here: watch the library for new photos. That needs
 * expo-media-library and a bare observer, and therefore a dev build. The
 * screen says so rather than implying the automatic path is covered.
 */

const SPACE_ID = 'dev-album-space';

type Step = { at: string; what: string; ok: boolean };

export default function DevUsAlbumScreen() {
  const insets = useSafeAreaInsets();
  const background = useThemeColor({}, 'background');
  const border = useThemeColor({}, 'border');
  const muted = useThemeColor({}, 'textSecondary');
  const accent = useThemeColor({}, 'accent');

  const [steps, setSteps] = useState<Step[]>([]);
  const [phrase, setPhrase] = useState<string | null>(null);
  const [phraseWorks, setPhraseWorks] = useState<boolean | null>(null);
  const [sealedCount, setSealedCount] = useState(0);
  const [roundTrip, setRoundTrip] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const log = useCallback((what: string, ok = true) => {
    setSteps((current) => [...current, { at: new Date().toLocaleTimeString(), what, ok }]);
  }, []);

  // Keys are made in memory on purpose: this is a rig, and persisting them
  // would only make it look more like the real thing than it is.
  const [device] = useState(() => generateDeviceKeys('dev-device', new Date()));
  const [partner] = useState(() => generateDeviceKeys('dev-partner', new Date()));
  const [spaceKey] = useState(() => spaceKeyFor(device, partner.agreement.publicKey));

  const repository = createLocalAlbumRepository(SPACE_ID);

  // A pure function of keys that never change, so it is computed rather than
  // stored. No effect, no setState, nothing to cascade.
  const fingerprint = useMemo(
    () => verificationFingerprint(device.signing.publicKey, partner.signing.publicKey),
    [device, partner],
  );

  useEffect(() => {
    void repository.listMedia().then((rows) => setSealedCount(rows.length));
  }, [repository]);

  const makePhrase = useCallback(() => {
    const next = generateRecoveryPhrase();
    setPhrase(next);
    setPhraseWorks(null);
    log('Recovery phrase generated');
  }, [log]);

  const checkPhrase = useCallback(() => {
    if (!phrase) {
      return;
    }
    // The real test: does the phrase reproduce the same space key the live
    // one is using? A phrase that derives something else recovers nothing.
    try {
      const recovered = spaceKeyFromPhrase(phrase);
      const same = Buffer.from(recovered).equals(Buffer.from(spaceKey));
      setPhraseWorks(same);
      log(`Phrase reproduces the space key: ${same ? 'yes' : 'no'}`, same);
    } catch (error) {
      setPhraseWorks(false);
      log(`Phrase rejected: ${(error as Error).message}`, false);
    }
  }, [log, phrase, spaceKey]);

  const sealPhotos = useCallback(async () => {
    setBusy(true);
    setRoundTrip(null);
    try {
      const picked = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ['images'],
        allowsMultipleSelection: true,
        allowsEditing: false,
        quality: 0.8,
        exif: false,
      });
      if (picked.canceled) {
        log('Pick cancelled', false);
        return;
      }
      for (const asset of picked.assets) {
        const bytes = await fetch(asset.uri).then((r) => r.arrayBuffer());
        const meta = {
          createdAt: new Date().toISOString(),
          byteLength: bytes.byteLength,
          mimeType: asset.mimeType ?? 'image/jpeg',
          ...(asset.width !== undefined ? { width: asset.width } : {}),
          ...(asset.height !== undefined ? { height: asset.height } : {}),
        };
        await repository.putMedia(
          sealAlbumMedia(spaceKey, new Uint8Array(bytes), meta, generateMediaKey),
        );
      }
      const rows = await repository.listMedia();
      setSealedCount(rows.length);

      // Read the first one back, so a round trip is shown rather than trusted.
      if (rows[0]) {
        const opened = openAlbumMedia(spaceKey, rows[0]);
        setRoundTrip(
          `${rows.length} sealed · first opens to ${opened.byteLength} bytes`,
        );
        log(`Sealed and reopened ${rows.length} photo(s)`);
      }
    } catch (error) {
      log(`Failed: ${(error as Error).message}`, false);
    } finally {
      setBusy(false);
    }
  }, [log, repository, spaceKey]);

  return (
    <ScrollView
      contentContainerStyle={[
        styles.content,
        { paddingTop: insets.top + Spacing[16], paddingBottom: insets.bottom + Spacing[32] },
      ]}
      contentInsetAdjustmentBehavior="never"
      style={{ backgroundColor: background }}
    >
      <Stack.Screen options={{ title: 'Album probe' }} />

      <ThemedText type="title">Album probe</ThemedText>
      <ThemedText type="body" style={{ color: muted }}>
        Throwaway. The real key stack, on this phone, right now.
      </ThemedText>

      <View style={[styles.limits, { borderColor: border }]}>
        <Text style={[styles.limitsTitle, { color: accent }]}>What this cannot do in Expo Go</Text>
        <Text style={[styles.limitsBody, { color: muted }]}>
          Watch the library for new photos. That needs a native observer and
          a dev build.{'\n'}Recognise which photos are the two of you. That needs
          {'\n'}a face model, also a dev build.{'\n\n'}Everything below runs today.
        </Text>
      </View>

      <Panel title="Fingerprint" border={border} muted={muted}>
        <Text selectable style={[styles.fingerprint, { color: muted }]}>
          {fingerprint ?? '…'}
        </Text>
        <ThemedText type="caption" style={{ color: muted }}>
          Read this to the other person. If it does not match what they see,
          stop.
        </ThemedText>
      </Panel>

      <Panel title="Recovery" border={border} muted={muted}>
        <View style={styles.actions}>
          <Button label={phrase ? 'Make another' : 'Make a phrase'} onPress={makePhrase} size="sm" />
          {phrase ? <Button label="Does it recover?" onPress={checkPhrase} size="sm" variant="secondary" /> : null}
        </View>
        {phrase ? <Text selectable style={[styles.phrase, { color: muted }]}>{phrase}</Text> : null}
        {phraseWorks !== null ? (
          <ThemedText type="caption" style={{ color: phraseWorks ? muted : '#ff6b6b' }}>
            {phraseWorks
              ? 'It reproduces the same space key. Written down, it would work.'
              : 'It does not recover this album.'}
          </ThemedText>
        ) : null}
      </Panel>

      <Panel title="Photos" border={border} muted={muted}>
        <View style={styles.actions}>
          <Button
            disabled={busy}
            label={busy ? 'Sealing…' : 'Pick and seal photos'}
            onPress={sealPhotos}
            size="sm"
          />
        </View>
        <ThemedText type="caption" style={{ color: muted }}>
          {roundTrip ?? `${sealedCount} sealed so far`}
        </ThemedText>
      </Panel>

      <Panel title="Log" border={border} muted={muted}>
        {steps.length === 0 ? (
          <ThemedText type="caption" style={{ color: muted }}>
            Nothing yet.
          </ThemedText>
        ) : (
          steps.map((step) => (
            <Text key={`${step.at}-${step.what}`} style={[styles.logLine, { color: muted }]}>
              {step.at} {step.ok ? '·' : '×'} {step.what}
            </Text>
          ))
        )}
      </Panel>
    </ScrollView>
  );
}

function Panel({
  title,
  border,
  muted,
  children,
}: {
  title: string;
  border: string;
  muted: string;
  children: React.ReactNode;
}) {
  return (
    <View style={[styles.panel, { borderColor: border }]}>
      <ThemedText type="label" style={{ color: muted }}>
        {title}
      </ThemedText>
      {children}
    </View>
  );
}

const styles = StyleSheet.create({
  content: { gap: Spacing[16], paddingHorizontal: Spacing[16] },
  limits: { borderRadius: 12, borderWidth: StyleSheet.hairlineWidth, gap: Spacing[8], padding: Spacing[12] },
  limitsTitle: { fontSize: 13, fontWeight: '600' },
  limitsBody: { fontSize: 13, lineHeight: 19 },
  panel: { borderRadius: 12, borderWidth: StyleSheet.hairlineWidth, gap: Spacing[8], padding: Spacing[12] },
  actions: { flexDirection: 'row', flexWrap: 'wrap', gap: Spacing[8] },
  fingerprint: { fontSize: 17, letterSpacing: 1.5, lineHeight: 26 },
  phrase: { fontSize: 13, lineHeight: 20 },
  logLine: { fontSize: 12, lineHeight: 17 },
});

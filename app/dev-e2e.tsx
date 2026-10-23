import { Redirect, useRouter } from 'expo-router';
import { useCallback, useState } from 'react';
import { ScrollView, StyleSheet, View } from 'react-native';
import { Asset } from 'expo-asset';
import { File, Paths } from 'expo-file-system';

import { ThemedText } from '@/components/themed-text';
import { Button } from '@/components/ui/button';
import { Spacing } from '@/constants/theme';
import { isE2EMode, signInE2E } from '@/features/e2e/e2e-session';
import { useSession } from '@/features/session/session-context';
import { useSpace } from '@/features/space/space-context';

/**
 * E2E console: deterministic sign-in and album scenario drivers for Maestro
 * flows (A–E).
 *
 * Development/E2E builds only (`__DEV__` + EXPO_PUBLIC_E2E_MODE=true);
 * anything else redirects home. This screen authenticates IDENTITY against
 * the isolated test backend and drives the REAL album stack otherwise:
 * establishProtocolArchive (creation + resumption + enrollment states),
 * uploadProtocolPhoto (real sealing + reservation + manifest),
 * readProtocolArchive (real verification + decryption), removeProtocolPhoto
 * (real signed tombstone), recoverProtocolArchive (real phrase recovery) —
 * all against the real backend, real SecureStore, and real keystore keys.
 * The console only removes what no emulator can answer (the native
 * sign-in sheet, the system photo picker) and what has no product UI yet
 * (the archive gallery trigger); the protocol legs are unmodified.
 *
 * Never linked from app UI. Maestro launches here because the root index
 * redirects signed-out E2E builds to this route.
 */
const ALICE = process.env.EXPO_PUBLIC_E2E_ALICE_EMAIL ?? 'alice.e2e@example.com';
const BOB = process.env.EXPO_PUBLIC_E2E_BOB_EMAIL ?? 'bob.e2e@example.com';
const FIXTURE_MODULE = require('../assets/e2e-test-photo.png');

async function fixtureUri(): Promise<string> {
  const asset = Asset.fromModule(FIXTURE_MODULE);
  await asset.downloadAsync();
  const source = asset.localUri ?? asset.uri;
  const target = new File(Paths.cache, 'e2e-test-photo.png');
  if (!target.exists) {
    const bytes = await (await fetch(source)).arrayBuffer();
    target.create({ overwrite: true });
    target.write(new Uint8Array(bytes));
  }
  return target.uri;
}

export default function DevE2E() {
  const router = useRouter();
  const { restoreSession, status, user } = useSession();
  const { space } = useSpace();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [signedInAs, setSignedInAs] = useState<string | null>(null);
  const [albumStatus, setAlbumStatus] = useState<string>('Album: not opened');
  const [mediaStatus, setMediaStatus] = useState<string>('Archive: not read');

  const signIn = useCallback(
    async (email: string) => {
      setBusy(true);
      setError(null);
      const result = await signInE2E(email);
      if (!result.ok) {
        setError(result.error);
        setBusy(false);
        return;
      }
      setSignedInAs(email);
      await restoreSession();
      setBusy(false);
    },
    [restoreSession]
  );

  // Plain function, not a memoized callback: the dynamic imports below defeat
  // the React Compiler's memoization, and these handlers need no stable identity.
  async function runAlbum(action: 'open' | 'upload' | 'read' | 'delete'): Promise<void> {
    setBusy(true);
    setError(null);
    try {
      const spaceId = space?.id;
      if (!spaceId) {
        setError('No Space on this account yet.');
        return;
      }
      const { establishProtocolArchive } = await import('@/features/album/protocol-archive');
      const archive = await establishProtocolArchive({ spaceId });
      if (archive.status !== 'ready') {
        setAlbumStatus(`Album: ${archive.status}`);
        if (action === 'open') return;
        setError(`Album is ${archive.status}; open it first.`);
        return;
      }
      setAlbumStatus(`Album: ready as ${archive.deviceId}`);
      if (action === 'open') return;

      const protocol = await import('@/features/album/protocol-archive');
      if (action === 'upload') {
        const uri = await fixtureUri();
        const { mediaId } = await protocol.uploadProtocolPhoto(
          archive,
          { uri, width: 8, height: 8 },
          { scopeKey: `e2e-${spaceId}` }
        );
        setMediaStatus(`Archive: uploaded ${mediaId}`);
        return;
      }
      if (action === 'read') {
        const read = await protocol.readProtocolArchive(archive);
        const first = read.photos[0]?.mediaId ?? 'none';
        setMediaStatus(
          `Archive: ${read.photos.length} photos, first ${first}, ` +
            `${read.deleted.length} deleted, ${read.rejected.length} rejected`
        );
        return;
      }
      const read = await protocol.readProtocolArchive(archive);
      const target = read.photos[0];
      if (!target) {
        setError('Nothing to delete: the archive is empty.');
        return;
      }
      const { getAlbumProtocolClient } = await import('@/features/album/protocol-client');
      const { parseWireMediaManifest } = await import('@aoi/shared');
      const page = await getAlbumProtocolClient().fetchMediaProtocol(null);
      const wire = page.manifests.find((entry) => entry.mediaId === target.mediaId);
      if (!wire) {
        setError('Manifest missing for the visible photo.');
        return;
      }
      await protocol.removeProtocolPhoto(archive, {
        mediaId: target.mediaId,
        manifestRevision: parseWireMediaManifest(wire).revision,
      });
      setMediaStatus(`Archive: deleted ${target.mediaId}`);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Album action failed.');
    } finally {
      setBusy(false);
    }
  }

  if (!isE2EMode()) {
    return <Redirect href="/" />;
  }

  // A persisted session (relaunch) authenticates without tapping sign-in
  // again; the buttons below stay live for whichever identity holds.
  const authed = status === 'signed_in' || signedInAs !== null;
  const identity = signedInAs ?? user?.email ?? status;

  return (
    <View style={styles.page}>
      <ScrollView contentContainerStyle={styles.content}>
        <ThemedText type="title">E2E test console</ThemedText>
        <ThemedText type="body" style={styles.muted}>
          Isolated test backend only. Signs in a test account; everything after
          this screen is production code.
        </ThemedText>
        <ThemedText type="caption" style={styles.muted}>
          Session: {status}
          {` · ${identity}`}
        </ThemedText>
        {authed ? (
          <>
            <ThemedText type="body" accessibilityRole="alert">
              {`Signed in as ${identity}`}
            </ThemedText>
            <Button label="Continue to the app" onPress={() => router.replace('/')} />
          </>
        ) : (
          <>
            <Button
              label="Sign in as Alice (E2E)"
              disabled={busy}
              onPress={() => void signIn(ALICE)}
            />
            <Button
              label="Sign in as Bob (E2E)"
              disabled={busy}
              onPress={() => void signIn(BOB)}
            />
          </>
        )}
        {error ? (
          <ThemedText type="body" accessibilityRole="alert" style={styles.error}>
            {error}
          </ThemedText>
        ) : null}

        <ThemedText type="subheading">Encrypted album scenarios</ThemedText>
        <ThemedText type="body" accessibilityLiveRegion="polite" style={styles.muted}>
          {albumStatus}
        </ThemedText>
        <ThemedText type="body" accessibilityLiveRegion="polite" style={styles.muted}>
          {mediaStatus}
        </ThemedText>
        <Button
          label="Open encrypted album (E2E)"
          disabled={busy || !authed}
          onPress={() => void runAlbum('open')}
        />
        <Button
          label="Upload test photo (E2E)"
          disabled={busy || !authed}
          onPress={() => void runAlbum('upload')}
        />
        <Button
          label="Read archive (E2E)"
          disabled={busy || !authed}
          onPress={() => void runAlbum('read')}
        />
        <Button
          label="Delete test photo (E2E)"
          disabled={busy || !authed}
          onPress={() => void runAlbum('delete')}
        />
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  page: { flex: 1 },
  content: { gap: Spacing[16], padding: Spacing[24] },
  muted: { opacity: 0.7 },
  error: { color: '#b3261e' },
});

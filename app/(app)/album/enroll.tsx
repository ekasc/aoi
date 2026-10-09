import { Stack, useRouter } from 'expo-router';
import { useCallback, useEffect, useState } from 'react';
import { ScrollView, StyleSheet, View } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { Button } from '@/components/ui/button';
import { Spacing } from '@/constants/theme';
import {
  acceptEnrolmentOffer,
  establishProtocolArchive,
  joiningFingerprint,
  pinVerifiedAnchor,
  type ProtocolArchive,
} from '@/features/album/protocol-archive';
import type { SpaceTrustAnchor } from '@aoi/shared';
import { createLocalKeyStore } from '@/features/album/local-key-store';
import { getOrCreateDeviceId } from '@/features/album/device-id';
import { useSpace } from '@/features/space/space-context';

/**
 * Joining a Space from this device.
 *
 * The order is the security property, and the screen enforces it rather than
 * describing it: the fingerprint is shown first, nothing is pinned until a
 * person says they compared it, and only then is an approval waited for. There
 * is no path through this screen that reaches the archive without that press.
 */

type Step =
  | { kind: 'checking' }
  | { kind: 'unverified'; fingerprint: string; anchor: SpaceTrustAnchor }
  | { kind: 'waiting'; fingerprint: string }
  | { kind: 'failed'; message: string };

export default function EnrolDeviceRoute() {
  const router = useRouter();
  const { space } = useSpace();
  const spaceId = space?.id;
  const [step, setStep] = useState<Step>({ kind: 'checking' });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(
    async (pinIfUnverified: boolean, shownAnchor?: SpaceTrustAnchor) => {
      if (!spaceId) return;
      // Yield once before touching state: an effect that sets state
      // synchronously cascades renders, and this runs from one.
      await Promise.resolve();
      setBusy(true);
      setError(null);
      try {
        const deviceId = await getOrCreateDeviceId();
        const device = await createLocalKeyStore().ensureDevice(spaceId, deviceId);

        let archive: ProtocolArchive = await establishProtocolArchive({ spaceId, deviceId });

        if (archive.status === 'unverified') {
          const fingerprint = joiningFingerprint(
            device.signing.publicKey,
            archive.anchor.rootSigningPublicKey
          );
          if (!pinIfUnverified) {
            // The anchor travels with the step: confirmation pins exactly the
            // root this code was computed from, never a refetched one.
            setStep({ kind: 'unverified', fingerprint, anchor: archive.anchor });
            return;
          }
          // Confirmation was for the anchor shown before, not for whatever the
          // server returns now. Revalidate the candidate rather than pinning it
          // blind.
          const fresh: ProtocolArchive = await establishProtocolArchive({ spaceId, deviceId });
          if (fresh.status !== 'unverified' || !shownAnchor) {
            setStep({
              kind: 'failed',
              message: 'This Space changed while you were comparing. Start over.',
            });
            return;
          }
          const { anchorsMatch } = await import('@/features/album/protocol-local-state');
          if (!anchorsMatch(shownAnchor, fresh.anchor)) {
            setStep({
              kind: 'failed',
              message: 'This Space changed while you were comparing. Start over.',
            });
            return;
          }
          await pinVerifiedAnchor(spaceId, shownAnchor);
          archive = await establishProtocolArchive({ spaceId, deviceId });
        }

        if (archive.status === 'ready') {
          router.replace('/(app)/(tabs)/(memories)');
          return;
        }

        const pinned = await import('@/features/album/protocol-local-state').then((m) =>
          m.readPinnedAnchor(spaceId)
        );
        const fingerprint =
          pinned.state === 'pinned'
            ? joiningFingerprint(device.signing.publicKey, pinned.anchor.rootSigningPublicKey)
            : '';

        if (archive.status === 'waiting') {
          setStep({ kind: 'waiting', fingerprint });
          return;
        }
        if (archive.status === 'blocked') {
          setStep({
            kind: 'failed',
            message: 'This Space could not be verified on this device.',
          });
          return;
        }
        setStep({
          kind: 'failed',
          message: 'Could not reach the shared album. Check your connection and try again.',
        });
      } catch {
        setStep({ kind: 'failed', message: 'Could not reach the shared album.' });
      } finally {
        setBusy(false);
      }
    },
    [router, spaceId]
  );

  useEffect(() => {
    // Deferred by a tick so the effect itself never sets state synchronously,
    // which is what the lint rule is about.
    const timer = setTimeout(() => void load(false), 0);
    return () => clearTimeout(timer);
  }, [load]);

  /** After approval has been left for this device, collect it and publish it. */
  const collect = useCallback(async () => {
    if (!spaceId) return;
    setBusy(true);
    setError(null);
    try {
      const result = await acceptEnrolmentOffer({ spaceId });
      if (result.status === 'ready') {
        router.replace('/(app)/(tabs)/(memories)');
        return;
      }
      if (result.status === 'waiting') {
        setError('The other person has not approved this device yet.');
        return;
      }
      setError('That approval could not be verified. Ask them to approve again.');
    } catch {
      setError('Could not reach the shared album.');
    } finally {
      setBusy(false);
    }
  }, [router, spaceId]);

  return (
    <View style={styles.page}>
      <Stack.Screen options={{ title: 'Join this album' }} />
      <ScrollView contentContainerStyle={styles.content}>
        {step.kind === 'checking' ? (
          <ThemedText type="body" style={styles.muted}>
            Checking this Space…
          </ThemedText>
        ) : null}

        {step.kind === 'unverified' ? (
          <>
            <ThemedText type="subheading">Compare these two codes</ThemedText>
            <ThemedText type="body" style={styles.muted}>
              Read this aloud with the other person. They must see exactly the same
              code. If it differs, stop — this is not their album.
            </ThemedText>
            <View style={styles.fingerprint}>
              <ThemedText type="title" accessibilityLabel={`Verification code ${step.fingerprint}`}>
                {step.fingerprint}
              </ThemedText>
            </View>
            <Button
              label="The codes match"
              disabled={busy}
              onPress={() =>
                step.kind === 'unverified'
                  ? void load(true, step.anchor)
                  : void load(true)
              }
              accessibilityHint="Accepts this Space's root and asks to join"
            />
            <Button
              label="They do not match"
              variant="secondary"
              disabled={busy}
              onPress={() => setStep({ kind: 'failed', message: 'The codes did not match, so nothing was saved.' })}
            />
          </>
        ) : null}

        {step.kind === 'waiting' ? (
          <>
            <ThemedText type="subheading">Waiting for approval</ThemedText>
            <ThemedText type="body" style={styles.muted}>
              Ask the other person to approve this device. You will see their code
              when they do.
            </ThemedText>
            {step.fingerprint ? (
              <View style={styles.fingerprint}>
                <ThemedText type="body">{step.fingerprint}</ThemedText>
              </View>
            ) : null}
            {error ? (
              <ThemedText type="body" accessibilityRole="alert" style={styles.error}>
                {error}
              </ThemedText>
            ) : null}
            <Button label="Check again" disabled={busy} onPress={() => void collect()} />
            <Button label="Back" variant="secondary" onPress={() => router.back()} />
          </>
        ) : null}

        {step.kind === 'failed' ? (
          <>
            <ThemedText type="subheading">Not joined</ThemedText>
            <ThemedText type="body" accessibilityRole="alert" style={styles.error}>
              {step.message}
            </ThemedText>
            <Button label="Try again" disabled={busy} onPress={() => void load(false)} />
            <Button label="Back" variant="secondary" onPress={() => router.back()} />
          </>
        ) : null}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  page: { flex: 1 },
  content: { gap: Spacing[16], padding: Spacing[24] },
  muted: { opacity: 0.7 },
  error: { color: '#b3261e' },
  fingerprint: { paddingVertical: Spacing[16] },
});

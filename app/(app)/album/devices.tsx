import { Stack, useRouter } from 'expo-router';
import { useCallback, useEffect, useState } from 'react';
import { ScrollView, StyleSheet, View } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { Button } from '@/components/ui/button';
import { Spacing } from '@/constants/theme';
import {
  approveEnrolmentClaim,
  enrolmentFingerprint,
  establishProtocolArchive,
  pendingEnrolmentClaims,
  type PendingEnrolmentClaim,
  type ProtocolArchiveReady,
} from '@/features/album/protocol-archive';
import { useSpace } from '@/features/space/space-context';

/**
 * Devices asking to join, and the one place approval happens.
 *
 * Approval is a deliberate press after a comparison, not a list you can tap
 * through: choosing a request only reveals its code, and the approve action
 * lives beside that code. The server relays claims and carries the signed record
 * back; it never authorises anything.
 */

type View_ =
  | { kind: 'loading' }
  | { kind: 'unavailable'; message: string }
  | { kind: 'ready'; session: ProtocolArchiveReady; claims: PendingEnrolmentClaim[] }
  | { kind: 'approved'; deviceId: string };

export default function DevicesRoute() {
  const router = useRouter();
  const { space } = useSpace();
  const spaceId = space?.id;
  const [state, setState] = useState<View_>({ kind: 'loading' });
  const [selected, setSelected] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!spaceId) return;
    // Yield once before touching state: an effect that sets state
    // synchronously cascades renders, and this runs from one.
    await Promise.resolve();
    setBusy(true);
    setError(null);
    try {
      const archive = await establishProtocolArchive({ spaceId });
      if (archive.status !== 'ready') {
        setState({
          kind: 'unavailable',
          message:
            archive.status === 'blocked'
              ? 'This Space could not be verified on this device.'
              : 'Could not reach the shared album.',
        });
        return;
      }
      const claims = await pendingEnrolmentClaims(archive);
      setState({ kind: 'ready', session: archive, claims });
      setSelected((current) =>
        current && claims.some((claim) => claim.deviceId === current) ? current : null
      );
    } catch {
      setState({ kind: 'unavailable', message: 'Could not reach the shared album.' });
    } finally {
      setBusy(false);
    }
  }, [spaceId]);

  useEffect(() => {
    // Deferred by a tick so the effect itself never sets state synchronously,
    // which is what the lint rule is about.
    const timer = setTimeout(() => void load(), 0);
    return () => clearTimeout(timer);
  }, [load]);

  const claim =
    state.kind === 'ready'
      ? (state.claims.find((candidate) => candidate.deviceId === selected) ?? null)
      : null;

  const approve = useCallback(async () => {
    if (state.kind !== 'ready' || !claim) return;
    setBusy(true);
    setError(null);
    try {
      await approveEnrolmentClaim(state.session, claim, new Date().toISOString());
      setState({ kind: 'approved', deviceId: claim.deviceId });
    } catch {
      setError('Could not approve that device. Try again.');
    } finally {
      setBusy(false);
    }
  }, [claim, state]);

  return (
    <View style={styles.page}>
      <Stack.Screen options={{ title: 'Devices' }} />
      <ScrollView contentContainerStyle={styles.content}>
        {state.kind === 'loading' ? (
          <ThemedText type="body" style={styles.muted}>
            Checking for requests…
          </ThemedText>
        ) : null}

        {state.kind === 'unavailable' ? (
          <>
            <ThemedText type="body" accessibilityRole="alert" style={styles.error}>
              {state.message}
            </ThemedText>
            <Button label="Try again" disabled={busy} onPress={() => void load()} />
          </>
        ) : null}

        {state.kind === 'approved' ? (
          <>
            <ThemedText type="subheading">Approved</ThemedText>
            <ThemedText type="body" style={styles.muted}>
              That device can now join. It will collect the approval the next time it
              opens the album.
            </ThemedText>
            <Button label="Done" onPress={() => void load()} />
          </>
        ) : null}

        {state.kind === 'ready' ? (
          <>
            {state.claims.length === 0 ? (
              <>
                <ThemedText type="subheading">No requests</ThemedText>
                <ThemedText type="body" style={styles.muted}>
                  When someone asks to join this album from their phone, they appear
                  here.
                </ThemedText>
              </>
            ) : (
              <>
                <ThemedText type="subheading">Waiting to join</ThemedText>
                {state.claims.map((candidate) => (
                  <Button
                    key={candidate.deviceId}
                    label={
                      candidate.deviceId === selected
                        ? `Selected: ${candidate.deviceId}`
                        : `Device ${candidate.deviceId.slice(0, 8)}`
                    }
                    variant={candidate.deviceId === selected ? 'primary' : 'secondary'}
                    onPress={() => setSelected(candidate.deviceId)}
                    accessibilityLabel={`Choose device ${candidate.deviceId}`}
                  />
                ))}
              </>
            )}

            {claim ? (
              <>
                <ThemedText type="body" style={styles.muted}>
                  Read this code aloud with them. It must match exactly.
                </ThemedText>
                <View style={styles.fingerprint}>
                  <ThemedText
                    type="title"
                    accessibilityLabel={`Verification code ${enrolmentFingerprint(state.session, claim.signingPublicKey)}`}
                  >
                    {enrolmentFingerprint(state.session, claim.signingPublicKey)}
                  </ThemedText>
                </View>
                {error ? (
                  <ThemedText type="body" accessibilityRole="alert" style={styles.error}>
                    {error}
                  </ThemedText>
                ) : null}
                <Button
                  label="Approve this device"
                  disabled={busy}
                  onPress={() => void approve()}
                  accessibilityHint="Signs this device in after the codes were compared"
                />
                <Button
                  label="Not now"
                  variant="secondary"
                  onPress={() => setSelected(null)}
                />
              </>
            ) : null}

            <Button label="Refresh" variant="secondary" disabled={busy} onPress={() => void load()} />
          </>
        ) : null}

        <Button label="Back" variant="secondary" onPress={() => router.back()} />
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  page: { flex: 1 },
  content: { gap: Spacing[12], padding: Spacing[24] },
  muted: { opacity: 0.7 },
  error: { color: '#b3261e' },
  fingerprint: { paddingVertical: Spacing[16] },
});

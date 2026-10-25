import { Stack, useRouter } from 'expo-router';
import { useCallback, useEffect, useState } from 'react';
import { ScrollView, StyleSheet, View } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { Button } from '@/components/ui/button';
import { Spacing } from '@/constants/theme';
import {
  approveEnrolmentClaim,
  enrolledProtocolDevices,
  enrolmentFingerprint,
  establishProtocolArchive,
  pendingEnrolmentClaims,
  revokeProtocolDevice,
  type EnrolledDevice,
  type PendingEnrolmentClaim,
  type ProtocolArchiveReady,
} from '@/features/album/protocol-archive';
import { useSpace } from '@/features/space/space-context';
import { useThemeColor } from '@/hooks/use-theme-color';

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
  | { kind: 'ready'; session: ProtocolArchiveReady; claims: PendingEnrolmentClaim[]; devices: EnrolledDevice[] }
  | { kind: 'approved'; deviceId: string };

export default function DevicesRoute() {
  const router = useRouter();
  const danger = useThemeColor({}, 'danger');
  const { space } = useSpace();
  const spaceId = space?.id;
  const [state, setState] = useState<View_>({ kind: 'loading' });
  const [selected, setSelected] = useState<string | null>(null);
  const [revoking, setRevoking] = useState<string | null>(null);
  const [revokedNotice, setRevokedNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!spaceId) return;
    // Yield once before touching state: an effect that sets state
    // synchronously cascades renders, and this runs from one.
    await Promise.resolve();
    setBusy(true);
    setError(null);
    setRevokedNotice(null);
    setRevoking(null);
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
      const devices = await enrolledProtocolDevices(archive);
      setState({ kind: 'ready', session: archive, claims, devices });
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

  const revokeTarget =
    state.kind === 'ready' && revoking
      ? (state.devices.find((device) => device.deviceId === revoking) ?? null)
      : null;

  const revoke = useCallback(async () => {
    if (state.kind !== 'ready' || !revokeTarget) return;
    setBusy(true);
    setError(null);
    try {
      await revokeProtocolDevice(state.session, revokeTarget.deviceId, new Date().toISOString());
      setState({
        ...state,
        devices: state.devices.filter((device) => device.deviceId !== revokeTarget.deviceId),
      });
      setRevoking(null);
      setRevokedNotice(
        `Device ${revokeTarget.deviceId.slice(0, 8)} revoked. It will stop opening the shared album on its next check.`
      );
    } catch {
      setError('Could not revoke that device. Try again.');
    } finally {
      setBusy(false);
    }
  }, [revokeTarget, state]);

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
            <ThemedText type="body" accessibilityRole="alert" style={[styles.error, { color: danger }]}>
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
            <ThemedText type="subheading">Your devices</ThemedText>
            <ThemedText type="body" style={styles.muted}>
              These phones can open the shared album. Revoke one you no longer
              use; it will lose access on its next check.
            </ThemedText>
            {state.devices.filter((device) => device.trusted).length === 0 ? (
              <ThemedText type="body" style={styles.muted}>
                No trusted devices are enrolled yet.
              </ThemedText>
            ) : (
              state.devices
                .filter((device) => device.trusted)
                .map((device) => (
                  <View key={device.deviceId} style={styles.deviceRow}>
                    <ThemedText type="body">
                      Device {device.deviceId.slice(0, 8)}
                      {device.isCurrent ? ' · this phone' : ''}
                      {device.isRoot ? ' · root device' : ''}
                    </ThemedText>
                    <ThemedText type="caption" style={styles.muted}>
                      Added {device.createdAt.slice(0, 10)}
                    </ThemedText>
                    {!device.isCurrent ? (
                      <Button
                        label="Revoke"
                        variant="secondary"
                        size="sm"
                        onPress={() => {
                          setSelected(null);
                          setError(null);
                          setRevoking(device.deviceId);
                        }}
                        accessibilityLabel={`Revoke device ${device.deviceId}`}
                      />
                    ) : null}
                  </View>
                ))
            )}
            {revokeTarget ? (
              <>
                <ThemedText type="body" style={styles.muted}>
                  {revokeTarget.isRoot
                    ? `Revoke the root device ${revokeTarget.deviceId.slice(0, 8)}? This can lock out every phone that depends on it. Only continue if you have the recovery phrase. `
                    : `Revoke device ${revokeTarget.deviceId.slice(0, 8)}? It will stop opening the shared album on its next check. `}
                  This cannot be undone.
                </ThemedText>
                {error ? (
                  <ThemedText type="body" accessibilityRole="alert" style={[styles.error, { color: danger }]}>
                    {error}
                  </ThemedText>
                ) : null}
                <Button
                  label="Revoke this device"
                  disabled={busy}
                  onPress={() => void revoke()}
                />
                <Button
                  label="Cancel"
                  variant="secondary"
                  disabled={busy}
                  onPress={() => setRevoking(null)}
                />
              </>
            ) : null}
            {revokedNotice ? (
              <ThemedText type="body" accessibilityLiveRegion="polite" style={styles.muted}>
                {revokedNotice}
              </ThemedText>
            ) : null}

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
                <ThemedText type="body" style={styles.muted}>
                  Only approve a request you have compared aloud — the
                  characters identify the phone, not the person.
                </ThemedText>
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
                    accessibilityLabel={`Verification code ${enrolmentFingerprint(state.session, claim.signingPublicKey, claim.agreementPublicKey)}`}
                  >
                    {enrolmentFingerprint(state.session, claim.signingPublicKey, claim.agreementPublicKey)}
                  </ThemedText>
                </View>
                {error ? (
                  <ThemedText type="body" accessibilityRole="alert" style={[styles.error, { color: danger }]}>
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
  error: {},
  deviceRow: { gap: Spacing[4] },
  fingerprint: { paddingVertical: Spacing[16] },
});

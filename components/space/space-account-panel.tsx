import { useRouter } from 'expo-router';
import { useCallback, useMemo, useRef, useState } from 'react';
import { Linking, View } from 'react-native';

import { ThemeSelector } from '@/components/theme/theme-selector';
import { ThemedText } from '@/components/themed-text';
import { ActionSheet } from '@/components/ui/action-sheet';
import { Button } from '@/components/ui/button';
import { Divider } from '@/components/ui/divider';
import { Spacing } from '@/constants/theme';
import { exportRawArchive } from '@/features/export/raw-export';
import { getLegalLinks } from '@/features/legal/legal-links';
import { useSession } from '@/features/session/session-context';
import { useSpace } from '@/features/space/space-context';
import { haptics } from '@/features/haptics/haptics';
import { useThemeColor } from '@/hooks/use-theme-color';

/**
 * Everything account-level for the Space screen's Account segment:
 * appearance, data export, session, support & legal, and deletion. Rendered
 * inline (not a nested screen), so the profile and its account controls share
 * one route.
 */
export function SpaceAccountPanel() {
  const router = useRouter();
  const { signOut, deleteAccount, user } = useSession();
  const { leaveSpace, space } = useSpace();
  const userId = user?.id;
  const muted = useThemeColor({}, 'muted');
  const danger = useThemeColor({}, 'danger');

  const [signOutError, setSignOutError] = useState('');
  const [deleteError, setDeleteError] = useState('');
  const [leaveError, setLeaveError] = useState('');
  const [confirming, setConfirming] = useState<'delete' | 'leave' | null>(null);
  const [isDeleting, setIsDeleting] = useState(false);
  const [isLeaving, setIsLeaving] = useState(false);
  const destructiveInFlight = useRef(false);
  const [isExporting, setIsExporting] = useState(false);
  const [exportMessage, setExportMessage] = useState('');

  const handleSignOut = useCallback(async () => {
    haptics.tap();
    setSignOutError('');
    try {
      // signOut() quietly lets go of this device's push registration first
      // (single choke point — every sign-out path unregisters the token).
      await signOut();
      router.replace('/(public)');
    } catch {
      setSignOutError('Failed to sign out. Please try again.');
    }
  }, [router, signOut]);

  // Both destructive paths confirm in the app's own sheet rather than a
  // system alert: the copy is long, the sheet is themeable and announced as
  // a modal, and the row that opened it keeps its place underneath.
  const handleDeleteAccount = useCallback(() => {
    haptics.warning();
    setDeleteError('');
    setConfirming('delete');
  }, []);

  const handleLeaveSpace = useCallback(() => {
    haptics.warning();
    setLeaveError('');
    setConfirming('leave');
  }, []);

  const handleCloseConfirm = useCallback(() => {
    if (!destructiveInFlight.current) setConfirming(null);
  }, []);

  const handleConfirmDelete = useCallback(async () => {
    if (destructiveInFlight.current) return;
    destructiveInFlight.current = true;
    setDeleteError('');
    setIsDeleting(true);
    try {
      await deleteAccount();
      router.replace('/(public)');
    } catch {
      setDeleteError('Failed to delete account. Please try again.');
    } finally {
      setIsDeleting(false);
      destructiveInFlight.current = false;
    }
  }, [deleteAccount, router]);

  const handleConfirmLeave = useCallback(async () => {
    if (destructiveInFlight.current) return;
    destructiveInFlight.current = true;
    setLeaveError('');
    setIsLeaving(true);
    try {
      await leaveSpace();
      router.replace('/(auth)/space-setup');
    } catch {
      setLeaveError('Failed to leave space. Please try again.');
    } finally {
      setIsLeaving(false);
      destructiveInFlight.current = false;
    }
  }, [leaveSpace, router]);

  // Raw data export is intentionally never gated by Plus: it archives
  // whatever this account is currently authorized to read.
  const handleExportData = useCallback(async () => {
    if (isExporting || !userId) {
      return;
    }
    setIsExporting(true);
    setExportMessage('');
    try {
      const result = await exportRawArchive({ userId });
      if (result.status === 'shared') {
        setExportMessage(
          result.mediaErrors > 0
            ? `Archive shared, ${result.mediaErrors} media file(s) were unavailable (listed in manifest.json).`
            : 'Archive shared, save it somewhere safe.'
        );
      } else if (result.status === 'cancelled') {
        setExportMessage('Export cancelled.');
      } else {
        setExportMessage(`Export failed: ${result.error}`);
      }
    } catch {
      setExportMessage('Export failed. Please try again.');
    } finally {
      setIsExporting(false);
    }
  }, [isExporting, userId]);

  const legal = useMemo(() => getLegalLinks(), []);
  const legalRows = useMemo(() => {
    const rows: { label: string; url: string }[] = [];
    if (legal.privacyUrl) {
      rows.push({ label: 'Privacy policy', url: legal.privacyUrl });
    }
    if (legal.termsUrl) {
      rows.push({ label: 'Terms of service', url: legal.termsUrl });
    }
    if (legal.supportUrl) {
      rows.push({ label: 'Contact support', url: legal.supportUrl });
    }
    return rows;
  }, [legal]);
  const openLegalLink = useCallback(async (url: string) => {
    try {
      await Linking.openURL(url);
    } catch {
      // Link failure is quiet tender-error policy: the row stays for retry.
    }
  }, []);

  return (
    <>
      <Divider />
      <View style={styles.section}>
        <ThemedText type="meta" style={[styles.heading, { color: muted }]}>
          Appearance
        </ThemedText>
        <ThemeSelector showDescriptions={false} />
      </View>

      <Divider />
      <View style={styles.section}>
        <ThemedText type="meta" style={[styles.heading, { color: muted }]}>
          Your data
        </ThemedText>
        <ThemedText type="body">
          Download everything you can see right now, notes, photos, letters,
          plans, as one archive file. Free for everyone, before or without
          deleting anything.
        </ThemedText>
        <Button
          label={isExporting ? 'Preparing…' : 'Export my data'}
          variant="secondary"
          onPress={() => void handleExportData()}
          disabled={isExporting}
        />
        {exportMessage ? (
          <ThemedText accessibilityRole="alert" type="caption">
            {exportMessage}
          </ThemedText>
        ) : null}
      </View>

      <Divider />
      <View style={styles.section}>
        <ThemedText type="meta" style={[styles.heading, { color: muted }]}>
          Session
        </ThemedText>
        <Button label="Sign out" variant="secondary" onPress={handleSignOut} />
        {signOutError ? (
          <ThemedText accessibilityRole="alert" type="caption" style={{ color: danger }}>
            {signOutError}
          </ThemedText>
        ) : null}
        <ThemedText type="caption" style={{ color: muted }}>
          Signing out only ends this session, your space and history stay
          exactly as they are.
        </ThemedText>
      </View>

      {legalRows.length > 0 ? (
        <>
          <Divider />
          <View style={styles.section}>
            <ThemedText type="meta" style={[styles.heading, { color: muted }]}>
              Support & legal
            </ThemedText>
            {legalRows.map((row) => (
              <Button
                key={row.label}
                label={row.label}
                variant="ghost"
                onPress={() => void openLegalLink(row.url)}
              />
            ))}
          </View>
        </>
      ) : null}

      <Divider />
      <View style={styles.section}>
        <ThemedText type="meta" style={[styles.heading, { color: danger }]}>
          Danger zone
        </ThemedText>
        <Button
          label="Leave space"
          variant="secondary"
          onPress={handleLeaveSpace}
        />
        {leaveError ? (
          <ThemedText accessibilityRole="alert" type="caption" style={{ color: danger }}>
            {leaveError}
          </ThemedText>
        ) : null}
        <Button
          label="Delete account"
          variant="destructive"
          onPress={handleDeleteAccount}
        />
        {deleteError ? (
          <ThemedText accessibilityRole="alert" type="caption" style={{ color: danger }}>
            {deleteError}
          </ThemedText>
        ) : null}
      </View>

      <ActionSheet
        busy={isLeaving}
        error={leaveError}
        actions={[
          {
            label: isLeaving ? 'Leaving…' : 'Leave this space',
            onPress: () => void handleConfirmLeave(),
            variant: 'destructive',
          },
          { label: 'Cancel', onPress: handleCloseConfirm },
        ]}
        description={`You will leave “${space?.name ?? 'this space'}”. Your partner keeps the shared memories and can still read them, and leaving never deletes history. You lose access until you join or create another space. If you are the last member, the space closes.`}
        onClose={handleCloseConfirm}
        title="Leave this space?"
        visible={confirming === 'leave'}
      />

      <ActionSheet
        busy={isDeleting}
        error={deleteError}
        actions={[
          {
            label: isDeleting ? 'Deleting…' : 'Delete my account',
            onPress: () => void handleConfirmDelete(),
            variant: 'destructive',
          },
          { label: 'Cancel', onPress: handleCloseConfirm },
        ]}
        description="This permanently deletes your account and signs out every device. We erase your email, photo, login connections, preferences, location, and sessions. Your shared memories (notes, photos, letters, plans) stay with your partner. If you are the last member, the space closes. Backup copies age out automatically. This cannot be undone."
        onClose={handleCloseConfirm}
        title="Delete your account?"
        visible={confirming === 'delete'}
      />
    </>
  );
}

const styles = {
  section: { gap: Spacing[12] },
  heading: {
    textTransform: 'uppercase' as const,
    letterSpacing: 1,
    fontSize: 12,
  },
};

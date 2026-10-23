import * as Clipboard from 'expo-clipboard';
import { useCallback, useRef, useState } from 'react';
import { ScrollView, Share, StyleSheet, View } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { Button } from '@/components/ui/button';
import { NativeSheet } from '@/components/ui/native-sheet';
import { Spacing } from '@/constants/theme';
import { inviteMessage } from '@/features/space/invite-code';
import { useSession } from '@/features/session/session-context';
import { useSpace } from '@/features/space/space-context';
import { useThemeColor } from '@/hooks/use-theme-color';

type PartnerInvitationProps = {
  /**
   * `section` is the stable status block in Account: membership when the
   * partner has joined, an invitation when they have not.
   *
   * `inline` is the quiet second action under the first-page dedication, and
   * it only exists while the space is waiting. Inviting is easy to find, not
   * a badge that follows every tab.
   */
  variant?: 'section' | 'inline';
};

/**
 * The one invitation surface, shared by Account and the first empty page.
 *
 * It reads the space directly rather than taking a code or a waiting flag, so
 * both callers show the same server-derived membership state and the same
 * expiry recovery. Nothing here knows which tab is focused, where the tab bar
 * is, or whether the sky is on screen.
 */
export function PartnerInvitation({ variant = 'section' }: PartnerInvitationProps) {
  const { user } = useSession();
  const { space, regenerateInvite, refreshSpace } = useSpace();
  const muted = useThemeColor({}, 'muted');
  const danger = useThemeColor({}, 'danger');
  const [visible, setVisible] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [busy, setBusy] = useState(false);
  const inFlight = useRef(false);
  const [openedAt, setOpenedAt] = useState(() => Date.now());

  const waitingForPartner = Boolean(space) && !space?.partnerJoined;
  const inviteCode = space?.inviteCode ?? '';
  const expired = Boolean(space?.inviteExpiresAt && Date.parse(space.inviteExpiresAt) <= openedAt);

  const open = useCallback(() => {
    setOpenedAt(Date.now());
    setError('');
    setNotice('');
    setVisible(true);
  }, []);

  const handleShare = useCallback(async () => {
    if (inFlight.current) {
      return;
    }
    inFlight.current = true;
    setError('');
    setNotice('');
    setBusy(true);
    try {
      let code = inviteCode;
      // A dead code is replaced before the share sheet opens; sending the old
      // one would hand the partner a link that cannot join.
      if (!code || (space?.inviteExpiresAt && Date.parse(space.inviteExpiresAt) <= Date.now())) {
        try {
          code = await regenerateInvite();
        } catch {
          setError("Couldn't create a new code. Please try again.");
          return;
        }
        if (!code) {
          setError("Couldn't create a new code. Please try again.");
          return;
        }
        setOpenedAt(Date.now());
      }
      // Opening the share sheet is not delivery and not membership, so it
      // changes nothing about the state shown here.
      await Share.share({
        message: inviteMessage(
          code,
          user?.displayName?.trim() || 'Your partner',
          space?.partnerName ?? null,
        ),
      });
    } catch {
      setError("Couldn't open sharing. Try again.");
    } finally {
      inFlight.current = false;
      setBusy(false);
    }
  }, [inviteCode, regenerateInvite, space, user]);

  const handleCheck = useCallback(async () => {
    if (inFlight.current) {
      return;
    }
    inFlight.current = true;
    setBusy(true);
    setError('');
    setNotice('');
    try {
      await refreshSpace();
      setNotice('Space checked just now.');
    } catch {
      setError("Couldn't check your space. Check your connection and try again.");
    } finally {
      inFlight.current = false;
      setBusy(false);
    }
  }, [refreshSpace]);

  const handleCopy = useCallback(async () => {
    setError('');
    setNotice('');
    const now = Date.now();
    if (space?.inviteExpiresAt && Date.parse(space.inviteExpiresAt) <= now) {
      setOpenedAt(now);
      setError('This code has expired. Share invite makes a new one.');
      return;
    }
    try {
      await Clipboard.setStringAsync(inviteCode);
      setNotice('Invite code copied.');
    } catch {
      setError("Couldn't copy the code. You can select it above instead.");
    }
  }, [inviteCode, space]);

  if (!space) {
    return null;
  }

  const sheet = (
    <NativeSheet visible={visible} onClose={() => setVisible(false)}>
      <ScrollView
        accessibilityLabel={waitingForPartner ? 'Invite your partner' : "You're connected"}
        accessibilityViewIsModal
        aria-modal
        contentContainerStyle={styles.sheet}
        role="dialog"
        showsVerticalScrollIndicator={false}
      >
        <ThemedText type="title">
          {waitingForPartner ? 'Invite your partner' : "You're connected"}
        </ThemedText>
        {waitingForPartner ? (
          <>
            <ThemedText type="body">
              Your partner has not joined yet. You can keep saving memories while you wait.
            </ThemedText>
            {inviteCode && !expired ? (
              <ThemedText
                accessibilityLabel={`Invite code, ${inviteCode.split('').join(' ')}`}
                selectable
                type="subheading"
              >
                {inviteCode}
              </ThemedText>
            ) : (
              <ThemedText type="caption" style={{ color: muted }}>
                {inviteCode
                  ? 'This code has expired. Share invite makes a new one.'
                  : 'Share invite makes your code.'}
              </ThemedText>
            )}
            <Button
              accessibilityState={{ busy }}
              disabled={busy}
              label={busy ? 'Please wait…' : 'Share invite'}
              onPress={() => void handleShare()}
            />
            {inviteCode && !expired ? (
              <Button
                disabled={busy}
                label="Copy invite code"
                onPress={() => void handleCopy()}
                variant="secondary"
              />
            ) : null}
            <ThemedText type="caption" style={{ color: muted }}>
              On their phone, they sign in to Aoi, choose to join an existing space, and enter this code.
            </ThemedText>
            <Button
              disabled={busy}
              label="Check if they've joined"
              onPress={() => void handleCheck()}
              variant="secondary"
            />
          </>
        ) : (
          <ThemedText type="body">
            {space.partnerName?.trim() || 'Your partner'} has joined. Memories you save here are
            shared between you.
          </ThemedText>
        )}
        {notice ? (
          <ThemedText accessibilityLiveRegion="polite" type="caption">
            {notice}
          </ThemedText>
        ) : null}
        {error ? (
          <ThemedText accessibilityRole="alert" type="caption" style={{ color: danger }}>
            {error}
          </ThemedText>
        ) : null}
        <Button label="Done" onPress={() => setVisible(false)} variant="ghost" />
      </ScrollView>
    </NativeSheet>
  );

  if (variant === 'inline') {
    if (!waitingForPartner) {
      return null;
    }
    return (
      <>
        <Button
          accessibilityHint="Shows your invite code, sharing options and joining instructions"
          label="Invite your partner"
          onPress={open}
          size="sm"
          variant="ghost"
        />
        {sheet}
      </>
    );
  }

  return (
    <View style={styles.section}>
      <ThemedText type="bodyEmphasis">
        {waitingForPartner ? 'Waiting for your partner' : 'Connected'}
      </ThemedText>
      <ThemedText type="caption" style={{ color: muted }}>
        {waitingForPartner
          ? 'Invite them when it suits you. You can keep saving memories while you wait.'
          : `${space.partnerName?.trim() || 'Your partner'} can read and add to this space.`}
      </ThemedText>
      {waitingForPartner ? (
        <Button
          accessibilityHint="Shows your invite code, sharing options and joining instructions"
          label="Invite your partner"
          onPress={open}
          variant="secondary"
        />
      ) : null}
      {sheet}
    </View>
  );
}

const styles = StyleSheet.create({
  section: {
    gap: Spacing[8],
  },
  sheet: {
    padding: Spacing[24],
    gap: Spacing[16],
  },
});

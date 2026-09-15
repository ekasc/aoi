import { Stack, useFocusEffect, useLocalSearchParams, useRouter } from 'expo-router';
import { useCallback, useMemo, useRef, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Image } from 'expo-image';

import { AudioPlayer } from '@/components/media/audio-player';
import { ThemedText } from '@/components/themed-text';
import { ActionSheet } from '@/components/ui/action-sheet';
import { Button } from '@/components/ui/button';
import { Surface } from '@/components/ui/surface';
import { Spacing } from '@/constants/theme';
import { FontFamilies } from '@/constants/typography';
import { clampPhotoAspect } from '@/components/moments/moment-card';
import { MomentAttachments, hasOrderedAttachments } from '@/components/moments/moment-attachments';
import { useMoments } from '@/features/moments/moments-context';
import { resolveStagedUri } from '@/features/composer/staged-uri';
import { useMoment } from '@/features/moments/use-moment';
import { isOwnMoment } from '@/features/moments/ownership';
import { useThemeColor } from '@/hooks/use-theme-color';

function formatDetailDate(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return 'Date TBD';
  return date.toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' });
}

/**
 * Read detail for one memory. Photos bleed edge-to-edge in their natural
 * aspect (never cropped); title/body read in the serif face on a 24pt
 * prose gutter; author + date stay quiet; voice plays inline. Edit exists
 * only for the owner's own moment via a visible overflow with delete. Old chapter/goal entries resolve
 * through the bounded day-range fallback via the `at` occurredAt hint —
 * no archive sweep. Refreshes on refocus (never the initial mount) so an
 * edit never shows stale, and a deletion surfaces as not-found.
 */
export default function MomentDetailScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { id, at, returnTo } = useLocalSearchParams<{
    id?: string;
    at?: string | string[];
    returnTo?: string | string[];
  }>();
  const momentId = Array.isArray(id) ? id[0] : id;
  const atHint = Array.isArray(at) ? at[0] : at;
  const returnToValue = Array.isArray(returnTo) ? returnTo[0] : returnTo;
  const isUsOrigin = returnToValue === 'us';
  const { moment, isLoading, error, reload } = useMoment(momentId, atHint ?? null);
  const { removeMoment } = useMoments();
  const [photoAspect, setPhotoAspect] = useState<number | null>(null);
  const [overflowVisible, setOverflowVisible] = useState(false);
  const [confirmVisible, setConfirmVisible] = useState(false);
  const [isRemoving, setIsRemoving] = useState(false);
  const [removeError, setRemoveError] = useState<string | null>(null);
  const background = useThemeColor({}, 'background');
  const muted = useThemeColor({}, 'muted');

  const handlePhotoLoad = useCallback((event: { source: { width: number; height: number } }) => {
    const { width, height } = event.source;
    if (Number.isFinite(width) && Number.isFinite(height) && height > 0) {
      setPhotoAspect(clampPhotoAspect(width / height));
    }
  }, []);

  const firstFocusRef = useRef(true);
  useFocusEffect(
    useCallback(() => {
      if (firstFocusRef.current) {
        firstFocusRef.current = false;
        return;
      }
      reload();
    }, [reload]),
  );

  const handleClose = useCallback(() => {
    if (isUsOrigin) {
      router.dismissTo('/(app)/(tabs)/together');
    } else {
      router.back();
    }
  }, [isUsOrigin, router]);

  const detailScreenOptions = {
    title: 'Memory' as const,
    ...(isUsOrigin
      ? {
          headerLeft: () => (
            <Pressable
              accessibilityLabel="Back to Us"
              accessibilityRole="button"
              onPress={handleClose}
              style={styles.backButton}
            >
              <ThemedText type="body">Back</ThemedText>
            </Pressable>
          ),
        }
      : null),
  };

  const handleEdit = useCallback(() => {
    if (!moment) return;
    router.push({
      pathname: '/(app)/moment/edit/[id]' as const,
      params: { id: moment.id, at: atHint ?? moment.occurredAt },
    });
  }, [atHint, moment, router]);

  const handleOpenOverflow = useCallback(() => {
    setOverflowVisible(true);
  }, []);

  const handleCloseOverflow = useCallback(() => {
    setOverflowVisible(false);
  }, []);

  const handleEditFromOverflow = useCallback(() => {
    setOverflowVisible(false);
    handleEdit();
  }, [handleEdit]);

  const handleRequestDelete = useCallback(() => {
    setOverflowVisible(false);
    setRemoveError(null);
    setConfirmVisible(true);
  }, []);

  const handleCloseConfirm = useCallback(() => {
    if (isRemoving) return;
    setConfirmVisible(false);
    setRemoveError(null);
  }, [isRemoving]);

  const handleConfirmDelete = useCallback(async () => {
    if (!moment || isRemoving) return;
    setIsRemoving(true);
    setRemoveError(null);
    try {
      await removeMoment(moment.id);
      setConfirmVisible(false);
      handleClose();
    } catch {
      setRemoveError("Couldn't remove this moment right now. Try again?");
    } finally {
      setIsRemoving(false);
    }
  }, [handleClose, isRemoving, moment, removeMoment]);

  const overflowActions = useMemo(
    () => [
      { label: 'Edit', onPress: handleEditFromOverflow },
      { label: 'Delete', onPress: handleRequestDelete, variant: 'destructive' as const },
    ],
    [handleEditFromOverflow, handleRequestDelete],
  );

  const confirmActions = useMemo(
    () => [
      {
        label: isRemoving ? 'Removing…' : 'Remove',
        onPress: () => {
          void handleConfirmDelete();
        },
        variant: 'destructive' as const,
      },
      { label: 'Cancel', onPress: handleCloseConfirm },
    ],
    [handleCloseConfirm, handleConfirmDelete, isRemoving],
  );

  const handleRetry = useCallback(() => {
    reload();
  }, [reload]);

  if (isLoading) {
    return (
      <View style={[styles.center, { backgroundColor: background, paddingBottom: insets.bottom + Spacing[24] }]}>
        <Stack.Screen options={detailScreenOptions} />
        <ThemedText type="body" style={{ color: muted }}>
          Opening this memory…
        </ThemedText>
      </View>
    );
  }

  if (error || !moment) {
    const loadFailed = Boolean(error);
    return (
      <View style={[styles.center, { backgroundColor: background, paddingBottom: insets.bottom + Spacing[24] }]}>
        <Stack.Screen options={detailScreenOptions} />
        <Surface style={styles.missingCard}>
          <ThemedText type="title">{loadFailed ? 'Could not load this memory' : 'This memory is no longer available'}</ThemedText>
          <ThemedText type="caption" style={{ color: muted }}>
            {error ?? 'It may have been removed.'}
          </ThemedText>
        </Surface>
        <View style={styles.missingActions}>
          {error ? <Button label="Try again" variant="secondary" onPress={handleRetry} /> : null}
          <Button label="Back" variant="secondary" onPress={handleClose} />
        </View>
      </View>
    );
  }

  const title = moment.title?.trim() ?? '';
  const body = moment.body?.trim() ?? '';
  const authorName = moment.authorRole === 'you' ? 'You' : moment.authorName?.trim() || 'Partner';
  const own = isOwnMoment(moment);
  const hasOrdered = hasOrderedAttachments(moment);

  return (
    <>
    <ScrollView
      style={{ flex: 1, backgroundColor: background }}
      contentContainerStyle={[styles.content, { paddingTop: Spacing[16], paddingBottom: insets.bottom + Spacing[24] }]}
      showsVerticalScrollIndicator={false}
    >
      <Stack.Screen options={detailScreenOptions} />
      {hasOrdered ? (
        <MomentAttachments moment={moment} />
      ) : moment.mediaPreview ? (
        <Image
          accessibilityLabel={title ? `Photo for ${title}` : 'Memory photo'}
          contentFit="contain"
          source={{ uri: resolveStagedUri(moment.mediaPreview) }}
          onLoad={handlePhotoLoad}
          style={[styles.photo, { aspectRatio: photoAspect ?? 4 / 3 }]}
        />
      ) : null}
      <View style={styles.prose}>
        {title ? (
          <ThemedText type="title" selectable style={styles.serifTitle}>
            {title}
          </ThemedText>
        ) : null}
        <ThemedText type="caption" style={{ color: muted }}>
          {formatDetailDate(moment.occurredAt)} · {authorName}
        </ThemedText>
        {!hasOrdered && moment.audioUri ? <AudioPlayer uri={moment.audioUri} /> : null}
        {body ? (
          <ThemedText type="body" selectable style={styles.serifBody}>
            {body}
          </ThemedText>
        ) : null}
        {!title && !body && !moment.mediaPreview && !moment.audioUri && !hasOrdered ? (
          <ThemedText type="body" style={{ color: muted }}>
            This memory is empty.
          </ThemedText>
        ) : null}
        {own ? (
          <Pressable
            accessibilityLabel="Edit this memory"
            accessibilityRole="button"
            onPress={handleEdit}
            style={styles.editRow}
          >
            <ThemedText type="body">Edit</ThemedText>
          </Pressable>
        ) : null}
        {own ? (
          <Pressable
            accessibilityLabel="More actions"
            accessibilityRole="button"
            onPress={handleOpenOverflow}
            style={styles.editRow}
          >
            <ThemedText type="body">More actions</ThemedText>
          </Pressable>
        ) : null}
      </View>
    </ScrollView>
    <ActionSheet
      actions={overflowActions}
      onClose={handleCloseOverflow}
      title={title || 'This moment'}
      visible={overflowVisible}
    />
    <ActionSheet
      actions={confirmActions}
      description={removeError || 'This moment will be removed from your shared timeline'}
      onClose={handleCloseConfirm}
      title="Remove this moment?"
      visible={confirmVisible}
    />
    </>
  );
}

const styles = StyleSheet.create({
  center: {
    flex: 1,
    gap: Spacing[12],
    justifyContent: 'center',
    paddingHorizontal: Spacing[24],
  },
  missingCard: {
    gap: Spacing[8],
  },
  missingActions: {
    gap: Spacing[12],
  },
  content: {
    gap: Spacing[24],
  },
  photo: {
    width: '100%',
  },
  prose: {
    gap: Spacing[24],
    paddingHorizontal: Spacing[24],
  },
  serifTitle: {
    fontFamily: FontFamilies.display,
    fontSize: 26,
    lineHeight: 34,
    fontWeight: '400',
  },
  serifBody: {
    fontFamily: FontFamilies.display,
    fontSize: 20,
    lineHeight: 30,
    fontWeight: '400',
  },
  editRow: {
    alignSelf: 'flex-start',
    minHeight: 44,
    minWidth: 44,
    justifyContent: 'center',
    paddingVertical: Spacing[8],
  },
  backButton: {
    alignSelf: 'flex-start',
    minHeight: 44,
    minWidth: 44,
    justifyContent: 'center',
    paddingVertical: Spacing[8],
  },
});

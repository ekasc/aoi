import { Stack, useFocusEffect, useLocalSearchParams, useRouter } from 'expo-router';
import { useCallback, useMemo, useRef, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Image } from 'expo-image';

import { AudioPlayer } from '@/components/media/audio-player';
import { VideoPlayer } from '@/components/media/video-player';
import { ThemedText } from '@/components/themed-text';
import { ActionSheet } from '@/components/ui/action-sheet';
import { Button } from '@/components/ui/button';
import { Surface } from '@/components/ui/surface';
import { Spacing } from '@/constants/theme';
import { Typography } from '@/constants/typography';
import { clampPhotoAspect, isEditedMoment } from '@/components/moments/moment-card';
import {
  MeasuredPress,
  MomentAttachments,
  hasOrderedAttachments,
  orderedImageAttachments,
} from '@/components/moments/moment-attachments';
import { PhotoViewer, type ViewerPhoto } from '@/components/moments/photo-viewer';
import type { PhotoOrigin } from '@/components/moments/zoomable-photo';
import { UsExchange } from '@/components/home/us-exchange';
import { haptics } from '@/features/haptics/haptics';
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
  // Fullscreen photo session: the same viewer the feed uses (pinch zoom,
  // drag to dismiss), opened on the photo the reader tapped.
  const [viewerIndex, setViewerIndex] = useState<number | null>(null);
  // Window frame of the photo that opened the session (morph origin).
  const [viewerOrigin, setViewerOrigin] = useState<PhotoOrigin | undefined>(undefined);
  const [confirmVisible, setConfirmVisible] = useState(false);
  const [deleteSnapshot, setDeleteSnapshot] = useState<typeof moment>(null);
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

  // Photos this memory can show fullscreen, in order: the ordered
  // attachments when present, else the legacy single preview.
  const orderedImages = useMemo(() => {
    if (!moment) {
      return [] as { url: string }[];
    }
    if (hasOrderedAttachments(moment)) {
      return orderedImageAttachments(moment);
    }
    return moment.mediaPreview ? [{ url: moment.mediaPreview }] : [];
  }, [moment]);
  const viewerPhotos = useMemo<ViewerPhoto[]>(
    () =>
      orderedImages.map((image) => ({
        uri: image.url,
        label: moment?.title?.trim() ? `Photo: ${moment.title.trim()}` : 'Memory photo',
        momentId: moment?.id ?? '',
      })),
    [orderedImages, moment],
  );
  const handleOpenFullscreen = useCallback((index: number, origin?: PhotoOrigin) => {
    haptics.select();
    setViewerOrigin(origin);
    setViewerIndex(index);
  }, []);
  const handleCloseFullscreen = useCallback(() => {
    setViewerIndex(null);
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


  const handleRequestDelete = useCallback(() => {
    setDeleteSnapshot(moment);
    setRemoveError(null);
    setConfirmVisible(true);
  }, [moment]);

  const handleCloseConfirm = useCallback(() => {
    if (isRemoving) return;
    setConfirmVisible(false);
    setRemoveError(null);
  }, [isRemoving]);

  const handleConfirmDelete = useCallback(async () => {
    if (!deleteSnapshot || isRemoving) return;
    setIsRemoving(true);
    setRemoveError(null);
    try {
      await removeMoment(deleteSnapshot.id, deleteSnapshot.updatedAt ?? deleteSnapshot.createdAt);
      setConfirmVisible(false);
      handleClose();
    } catch (error) {
      setRemoveError(error instanceof Error ? error.message : "Couldn't delete this moment right now. Try again?");
    } finally {
      setIsRemoving(false);
    }
  }, [deleteSnapshot, handleClose, isRemoving, removeMoment]);

  const confirmActions = useMemo(
    () => [
      {
        label: isRemoving ? 'Deleting…' : 'Delete',
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
        <MomentAttachments moment={moment} onPhotoPress={handleOpenFullscreen} />
      ) : moment.videoUri ? (
        <VideoPlayer
          aspectRatio={16 / 9}
          label={title ? `Video: ${title}` : 'Video memory'}
          posterUri={moment.mediaPreview}
          uri={moment.videoUri}
        />
      ) : moment.mediaPreview ? (
        <MeasuredPress
          accessibilityHint="Opens fullscreen"
          accessibilityLabel={title ? `Open photo for ${title} fullscreen` : 'Open photo fullscreen'}
          onPress={(origin) => handleOpenFullscreen(0, origin)}
        >
          <Image
            accessible={false}
            contentFit="contain"
            source={{ uri: resolveStagedUri(moment.mediaPreview) }}
            onLoad={handlePhotoLoad}
            style={[styles.photo, { aspectRatio: photoAspect ?? 4 / 3 }]}
          />
        </MeasuredPress>
      ) : null}
      <View style={styles.prose}>
        {title ? (
          <ThemedText type="title" selectable style={styles.serifTitle}>
            {title}
          </ThemedText>
        ) : null}
        <ThemedText type="caption" style={{ color: muted }}>
          {formatDetailDate(moment.occurredAt)} · {authorName}{isEditedMoment(moment) ? ' · Edited' : null}
        </ThemedText>
        {!hasOrdered && moment.audioUri ? <AudioPlayer uri={moment.audioUri} /> : null}
        {body ? (
          <ThemedText type="body" selectable style={styles.serifBody}>
            {body}
          </ThemedText>
        ) : null}
        {!title && !body && !moment.mediaPreview && !moment.audioUri && !hasOrdered ? (
          <ThemedText type="body" style={{ color: muted }}>
            This memory is empty. Add a few words or a photo with Edit — or delete it if it was kept by mistake.
          </ThemedText>
        ) : null}
        <UsExchange moment={moment} />
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
            accessibilityLabel="Delete this memory"
            accessibilityRole="button"
            onPress={handleRequestDelete}
            style={styles.editRow}
          >
            <ThemedText type="body">Delete…</ThemedText>
          </Pressable>
        ) : null}
      </View>
    </ScrollView>
    <PhotoViewer
      initialIndex={viewerIndex ?? 0}
      onClose={handleCloseFullscreen}
      onOpenMemory={handleCloseFullscreen}
      photos={viewerPhotos}
      visible={viewerIndex !== null}
    />
    <ActionSheet
      actions={confirmActions}
      description="This moment will be deleted from your shared timeline"
      error={removeError ?? undefined}
      onClose={handleCloseConfirm}
      title="Delete this moment?"
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
  serifTitle: Typography.readTitle,
  serifBody: Typography.readBody,
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

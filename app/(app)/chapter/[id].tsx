import { Stack, useLocalSearchParams, useRouter } from 'expo-router';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { ScrollView, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { MomentCard } from '@/components/moments/moment-card';
import { ChapterCover } from '@/components/moments/chapter-cover';
import { ChapterPhotoStack } from '@/components/moments/chapter-photo-stack';
import { ThemedText } from '@/components/themed-text';
import { Button } from '@/components/ui/button';
import { Spacing } from '@/constants/theme';
import { exportChapterKeepsake } from '@/features/export/keepsake-export';
import { describeChapter } from '@/features/moments/chapters';
import { useMoments } from '@/features/moments/moments-context';
import { useSubscription } from '@/features/subscription/subscription-context';
import type { Moment } from '@/features/moments/types';
import { useSpace } from '@/features/space/space-context';
import { useThemeColor } from '@/hooks/use-theme-color';

type DetailState =
  | { status: 'loading' }
  | { status: 'ready'; chapterId: string; title: string; members: Moment[] }
  | { status: 'missing'; error: string | null };

/**
 * Chapter detail: the stable ID describes its own absolute range (computed
 * with the device calendar, no discovery round trip), which loads directly
 * and pages internally to completion. Members read as a curated chronology
 * reusing MomentCard (read-only, no duplicated logic). The cover/count are
 * derived from the loaded members, so detail never depends on Story state.
 */
export default function ChapterDetailScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { id } = useLocalSearchParams<{ id?: string }>();
  const chapterId = Array.isArray(id) ? id[0] : id;
  const { loadChapterRange } = useMoments();
  const { space } = useSpace();
  const background = useThemeColor({}, 'background');
  const muted = useThemeColor({}, 'muted');

  const described = useMemo(
    () => (chapterId ? describeChapter(chapterId, space?.relationshipStartDate ?? null) : null),
    [chapterId, space?.relationshipStartDate]
  );
  const [state, setState] = useState<DetailState>({ status: 'loading' });
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    let cancelled = false;
    setState({ status: 'loading' });
    (async () => {
      if (!described) {
        return null;
      }
      return loadChapterRange(described.range.fromMs, described.range.toMs);
    })().then(
      (members) => {
        if (cancelled) {
          return;
        }
        if (!described || !chapterId) {
          setState({ status: 'missing', error: null });
        } else {
          setState({ status: 'ready', chapterId, title: described.title, members: members ?? [] });
        }
      },
      (error: unknown) => {
        if (!cancelled) {
          setState({
            status: 'missing',
            error: error instanceof Error ? error.message : 'Could not load this chapter.',
          });
        }
      }
    );
    return () => {
      cancelled = true;
    };
  }, [chapterId, described, loadChapterRange, attempt]);

  const handleRetry = () => {
    setAttempt((value) => value + 1);
  };

  const handleOpenStackPhoto = useCallback(
    (moment: Moment) => {
      router.push({
        pathname: '/(app)/moment/[id]' as const,
        params: { id: moment.id, at: moment.occurredAt },
      });
    },
    [router],
  );

  const ready = state.status === 'ready' ? state : null;
  const members = ready?.members ?? [];
  const title = ready?.title ?? '';
  const readyId = ready?.chapterId ?? '';
  const coverPhotoUri =
    members.find((member) => member.type === 'media' && member.mediaPreview)?.mediaPreview ?? null;
  const subtitle = members.length === 1 ? '1 memory' : `${members.length} memories`;
  const [exportState, setExportState] = useState<'idle' | 'working' | 'error'>('idle');
  const [exportError, setExportError] = useState('');
  const { serverPlus, refreshServerPlus } = useSubscription();

  const handleExport = useCallback(async () => {
    // Gated on authoritative server state, never local RevenueCat isPlus:
    // Plus exports; known Free routes to upgrade; unknown stays honest with
    // a retry instead of claiming Free. (Local rendering can't be
    // cryptographically enforced against a modified binary; enforcement
    // here is the honest product path, not DRM.)
    if (!serverPlus) {
      setExportError('');
      setExportState('working');
      await refreshServerPlus();
      setExportState('idle');
      return;
    }
    if (!serverPlus.isPlus) {
      router.push('/(app)/paywall');
      return;
    }
    setExportError('');
    setExportState('working');
    try {
      // Photos resolve through the authenticated media path into local
      // staged files before rendering, so the print WebView never performs
      // authenticated HTTP itself. Staged originals are removed when the
      // export settles, success, cancel, or failure alike.
      const result = await exportChapterKeepsake({
        title,
        subtitle,
        filename: `aoi-keepsake-${readyId.replace(/[^a-z0-9]+/gi, '-')}`,
        members,
      });
      if (result.status === 'failed') {
        setExportError(result.error);
        setExportState('error');
      } else {
        // Shared and user-cancelled both leave the screen exactly as-is:
        // cancellation is never presented as an error.
        setExportState('idle');
      }
    } catch (error) {
      setExportError(error instanceof Error ? error.message : 'Could not export this keepsake.');
      setExportState('error');
    }
  }, [members, title, subtitle, readyId, serverPlus, refreshServerPlus, router]);

  if (state.status !== 'ready') {
    return (
      <View
        style={[
          styles.missing,
          {
            backgroundColor: background,
            paddingBottom: insets.bottom + Spacing[24],
          },
        ]}
      >
        <Stack.Screen options={{ title: 'Chapter' }} />
        {state.status === 'loading' ? (
          <ThemedText type="body" style={{ color: muted }}>
            Opening chapter…
          </ThemedText>
        ) : (
          <>
            <ThemedText type="title">This chapter is no longer available</ThemedText>
            <ThemedText type="caption" style={{ color: muted }}>
              {state.error ?? 'Its memories may have moved months or been removed.'}
            </ThemedText>
            {state.error ? (
              <Button label="Try again" onPress={handleRetry} variant="secondary" />
            ) : null}
            <Button label="Back to Story" onPress={() => router.back()} variant="secondary" />
          </>
        )}
      </View>
    );
  }

  return (
    <ScrollView
      style={{ flex: 1, backgroundColor: background }}
      contentContainerStyle={[
        styles.content,
        {
          paddingTop: Spacing[16],
          paddingBottom: insets.bottom + Spacing[24],
        },
      ]}
      showsVerticalScrollIndicator={false}
    >
      <Stack.Screen options={{ title }} />
      {coverPhotoUri ? (
        <ThemedText type="caption" style={{ color: muted, textAlign: 'center' }}>{subtitle}</ThemedText>
      ) : <ChapterCover
        chapter={{
          id: readyId,
          kind: readyId.startsWith('anniversary:') ? 'anniversary' : 'monthly',
          title,
          subtitle,
          memoryIds: members.map((member) => member.id),
          range: described?.range ?? { fromMs: 0, toMs: 0 },
          coverPhotoUri,
          monthKey: null,
          anniversaryYear: null,
        }}
        width={240}
      />}
      <ChapterPhotoStack moments={members} onOpenMoment={handleOpenStackPhoto} />
      <View style={styles.entries}>
        {members.map((member) => (
          <MomentCard
            key={member.id}
            moment={member}
            onPress={() =>
              router.push({
                pathname: '/(app)/moment/[id]' as const,
                params: { id: member.id, at: member.occurredAt },
              })
            }
          />
        ))}
      </View>
      <View style={styles.exportRow}>
        <Button
          label={
            exportState === 'working'
              ? 'Preparing…'
              : !serverPlus
                ? 'Check Plus status'
                : serverPlus.isPlus
                  ? 'Keep as PDF'
                  : 'Keep as PDF · Plus'
          }
          onPress={handleExport}
          variant="ghost"
          disabled={exportState === 'working'}
        />
        {!serverPlus && exportState !== 'working' ? (
          <ThemedText type="caption" style={{ color: muted }}>
            Couldn&apos;t confirm Plus status, check connection, then try again.
          </ThemedText>
        ) : null}
        {exportState === 'error' ? (
          <ThemedText accessibilityRole="alert" type="caption" style={{ color: muted }}>
            {exportError}
          </ThemedText>
        ) : null}
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  content: {
    paddingHorizontal: Spacing[16],
    gap: Spacing[24],
    alignItems: 'center',
  },
  entries: {
    width: '100%',
    gap: Spacing[24],
  },
  exportRow: {
    width: '100%',
    gap: Spacing[8],
    alignItems: 'flex-start',
  },
  missing: {
    flex: 1,
    justifyContent: 'center',
    paddingHorizontal: Spacing[16],
    gap: Spacing[8],
  },
});

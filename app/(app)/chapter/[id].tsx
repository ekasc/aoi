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
  const [attempt, setAttempt] = useState(0);
  const requestKey = `${chapterId ?? ''}:${attempt}`;
  const [stored, setStored] = useState<{ key: string; state: DetailState } | null>(null);
  // A new chapter, or a retry, reads as loading without a synchronous setState
  // inside the effect.
  const state: DetailState = stored?.key === requestKey ? stored.state : { status: 'loading' };

  useEffect(() => {
    let cancelled = false;
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
          setStored({ key: requestKey, state: { status: 'missing', error: null } });
        } else {
          setStored({
            key: requestKey,
            state: { status: 'ready', chapterId, title: described.title, members: members ?? [] },
          });
        }
      },
      (error: unknown) => {
        if (!cancelled) {
          setStored({
            key: requestKey,
            state: {
              status: 'missing',
              error: error instanceof Error ? error.message : 'Could not load this chapter.',
            },
          });
        }
      }
    );
    return () => {
      cancelled = true;
    };
  }, [chapterId, described, loadChapterRange, requestKey]);

  const handleRetry = () => {
    setAttempt((value) => value + 1);
  };

  // One navigator behind two stable adapters: the photo stack hands over a
  // whole Moment, the card hands over an id. Built inline per row they
  // changed identity every render, which is enough on its own to defeat the
  // memo on MomentCard and re-render every photo, video and audio player in
  // the chapter whenever anything above it moved.
  const navigateToMember = useCallback(
    (id: string, at: string | undefined) => {
      router.push({
        pathname: '/(app)/moment/[id]' as const,
        params: { id, at },
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

  const handleOpenStackPhoto = useCallback(
    (moment: Moment) => navigateToMember(moment.id, moment.occurredAt),
    [navigateToMember],
  );
  const openMember = useCallback(
    (momentId: string) => {
      const member = members.find((candidate) => candidate.id === momentId);
      navigateToMember(momentId, member?.occurredAt);
    },
    [members, navigateToMember],
  );
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
      {/* The cover is an illustration of the chapter, not a replacement for
          it. A photo used to swap the whole block out, so any chapter with
          media lost its title. */}
      {members.length > 0 ? (
      <ChapterCover
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
      />
      ) : null}
      <ThemedText type="caption" style={{ color: muted, textAlign: 'center' }}>
        {subtitle}
      </ThemedText>
      {members.length === 0 ? (
        <View accessibilityLiveRegion="polite" style={styles.empty}>
          <ThemedText type="title">Nothing kept here yet</ThemedText>
          <ThemedText type="body" style={{ color: muted, textAlign: 'center' }}>
            Memories you keep this month will gather here, in the order they
            happened.
          </ThemedText>
          <Button label="Keep a memory" onPress={() => router.push('/(app)/moment/new')} />
        </View>
      ) : (
        <>
          <ChapterPhotoStack moments={members} onOpenMoment={handleOpenStackPhoto} />
          <View style={styles.entries}>
            {members.map((member) => (
              <MomentCard key={member.id} moment={member} onPress={openMember} />
            ))}
          </View>
        </>
      )}
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
  empty: {
    alignItems: 'center',
    gap: Spacing[12],
    paddingHorizontal: Spacing[16],
    paddingVertical: Spacing[24],
    width: '100%',
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

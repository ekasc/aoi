import { Image } from 'expo-image';
import { useCallback, useRef, useState, type ReactNode } from 'react';
import {
  Pressable,
  ScrollView,
  StyleSheet,
  View,
  useWindowDimensions,
  type NativeScrollEvent,
  type NativeSyntheticEvent,
  type StyleProp,
  type ViewStyle,
} from 'react-native';

import type { PhotoOrigin } from '@/components/moments/zoomable-photo';
import { AudioPlayer } from '@/components/media/audio-player';
import { MediaFrame } from '@/components/ui/media-frame';
import { Radii, Spacing } from '@/constants/theme';
import { resolveStagedUri } from '@/features/composer/staged-uri';
import type { Moment } from '@/features/moments/types';
import { useThemeColor } from '@/hooks/use-theme-color';

/**
 * Local aspect clamp (mirrors MomentCard.clampPhotoAspect): portrait stays
 * portrait, landscape stays landscape, extremes letterbox. Duplicated
 * (not imported) to avoid a card<->attachments circular import.
 */
function clampPhotoAspect(aspect: number): number {
  if (!Number.isFinite(aspect) || aspect <= 0) {
    return 4 / 3;
  }
  return Math.min(16 / 9, Math.max(3 / 4, aspect));
}

/**
 * Ordered attachment renderer for delivered memories. Reads
 * `moment.attachments` (image/audio, max 10) in server order. Returns null
 * when absent so callers fall back to legacy mediaPreview/audioUri —
 * never rendering both (no duplicate first photo/audio).
 *
 * Article/detail keeps images inside the navigation Pressable (they open
 * detail); the feed pulls them out — tapping a feed photo does nothing,
 * long-press still opens actions, and the caption block stays the way in.
 * Audio stays outside so playback never navigates — hence the split.
 */
export function hasOrderedAttachments(moment: Moment): boolean {
  return !!moment.attachments && moment.attachments.length > 0;
}

export function orderedImageAttachments(moment: Moment): { mediaId: string; url: string }[] {
  return (moment.attachments ?? []).filter((a) => a.kind === 'image');
}

export function orderedAudioAttachments(moment: Moment): { mediaId: string; url: string }[] {
  return (moment.attachments ?? []).filter((a) => a.kind === 'audio');
}

function AttachmentImage({
  uri,
  label,
  aspectRatio,
  frameStyle,
}: {
  uri: string;
  /** Announced label, or undefined when a parent button names the photo. */
  label?: string;
  /** Optional fixed frame override; otherwise the photo's own measured ratio. */
  aspectRatio?: number;
  /**
   * Article/detail frame chrome. The timeline never reaches AttachmentImage —
   * timeline sets render through FeedPhoto (rounded, content-aligned, cover).
   */
  frameStyle?: StyleProp<ViewStyle>;
}) {
  const [aspect, setAspect] = useState<number | null>(null);
  const handleLoad = useCallback((event: { source: { width: number; height: number } }) => {
    const { width, height } = event.source;
    if (Number.isFinite(width) && Number.isFinite(height) && height > 0) {
      setAspect(clampPhotoAspect(width / height));
    }
  }, []);
  return (
    <MediaFrame aspectRatio={aspectRatio ?? aspect ?? 4 / 3} style={frameStyle}>
      <Image
        // A frame inside a parent button is decorative: the button already
        // names the photo, and announcing both reads twice.
        accessible={label === undefined ? false : undefined}
        accessibilityLabel={label}
        source={{ uri: resolveStagedUri(uri) }}
        style={styles.image}
        contentFit="contain"
        transition={200}
        onLoad={handleLoad}
      />
    </MediaFrame>
  );
}

/**
 * Timeline photo frame: content-aligned with the entry text and softly
 * rounded, the way a feed print sits inside its row. Uses a fixed ratio
 * when given one; otherwise it measures the photo and clamps it, falling
 * back to 4:3. May crop the way a feed print does.
 */
const TIMELINE_PHOTO_ASPECT = 4 / 3;

/** Strip print sizing: peek-sized, uniform, edge to edge. */
const STRIP_PHOTO_FRACTION = 0.78;
const STRIP_PHOTO_MAX = 320;
const STRIP_GAP = Spacing[8];

/**
 * Press wrapper that reports the frame it was tapped on, in window
 * coordinates, so the fullscreen viewer can morph out of (and back into) the
 * exact thumbnail the reader touched. Falls back to a plain press when the
 * node cannot be measured (mocked trees, races).
 */
export function MeasuredPress({
  accessibilityHint,
  accessibilityLabel,
  children,
  delayLongPress,
  onLongPress,
  onPress,
  radius,
}: {
  accessibilityHint: string;
  accessibilityLabel: string;
  children: ReactNode;
  delayLongPress?: number;
  onLongPress?: () => void;
  onPress?: (origin?: PhotoOrigin) => void;
  radius?: number;
}) {
  const nodeRef = useRef<View>(null);
  const handlePress = useCallback(() => {
    if (!onPress) {
      return;
    }
    const node = nodeRef.current;
    if (!node || typeof node.measureInWindow !== 'function') {
      onPress();
      return;
    }
    node.measureInWindow((x, y, width, height) => {
      onPress({ x, y, width, height, radius });
    });
  }, [onPress, radius]);

  return (
    <Pressable
      accessibilityHint={accessibilityHint}
      accessibilityLabel={accessibilityLabel}
      accessibilityRole="button"
      delayLongPress={delayLongPress}
      onLongPress={onLongPress}
      onPress={onPress ? handlePress : undefined}
      ref={nodeRef}
    >
      {children}
    </Pressable>
  );
}

export function FeedPhoto({
  uri,
  label,
  aspectRatio,
  onPress,
  onLongPress,
  actionLabel,
}: {
  uri: string;
  label: string;
  aspectRatio?: number;
  /** Fullscreen tap; when present the print becomes a button. */
  onPress?: (origin?: PhotoOrigin) => void;
  /** Own-moment hold for actions; rides the same button when present. */
  onLongPress?: () => void;
  /** Button name; defaults to the print label. */
  actionLabel?: string;
}) {
  const border = useThemeColor({}, 'border');
  const backgroundSubtle = useThemeColor({}, 'backgroundSubtle');
  const [measuredAspect, setMeasuredAspect] = useState<number | null>(null);
  const handleLoad = useCallback((event: { source: { width: number; height: number } }) => {
    const { width, height } = event.source;
    if (Number.isFinite(width) && Number.isFinite(height) && height > 0) {
      setMeasuredAspect(clampPhotoAspect(width / height));
    }
  }, []);
  const frame = (
    <View
      style={[
        styles.photoFrame,
        {
          aspectRatio: aspectRatio ?? measuredAspect ?? TIMELINE_PHOTO_ASPECT,
          borderColor: border,
          backgroundColor: backgroundSubtle,
        },
      ]}
    >
      <Image
        accessibilityLabel={label}
        source={{ uri: resolveStagedUri(uri) }}
        style={styles.image}
        contentFit="cover"
        transition={200}
        onLoad={aspectRatio === undefined ? handleLoad : undefined}
      />
    </View>
  );
  if (!onPress && !onLongPress) {
    return frame;
  }
  return (
    <MeasuredPress
      accessibilityHint={onPress ? 'Opens fullscreen' : 'Hold to edit or remove this moment'}
      accessibilityLabel={actionLabel ?? label}
      delayLongPress={400}
      onLongPress={onLongPress}
      onPress={onPress}
      radius={Radii.md}
    >
      {frame}
    </MeasuredPress>
  );
}

type OrderedImage = { mediaId: string; url: string };

/**
 * Hands a fullscreen tap on, with the measured frame only when there is one:
 * keeping the index-only call shape otherwise means every existing caller
 * keeps working unchanged.
 */
function forwardPhotoPress(
  onPhotoPress: (index: number, origin?: PhotoOrigin) => void,
  index: number,
  origin?: PhotoOrigin,
): void {
  if (origin) {
    onPhotoPress(index, origin);
    return;
  }
  onPhotoPress(index);
}

/**
 * Timeline photo sets read as one sideways strip: peek-sized prints in a
 * row, snapped stop to stop, instead of stacking every photo down the
 * chronology. The strip sits at entry level (outside the text column's
 * padding), and every stop centres its print: the content opens and closes
 * with half a viewport of padding, with neighbours peeking on both sides
 * of the centred print. One small dot row carries position; the photos
 * stay the only content.
 */
function MomentImagePager({
  images,
  onPhotoPress,
  onPhotoLongPress,
}: {
  images: OrderedImage[];
  /** Fullscreen tap per print; prints stay plain when absent. */
  onPhotoPress?: (index: number, origin?: PhotoOrigin) => void;
  /** Own-moment hold per print; rides the print button when present. */
  onPhotoLongPress?: () => void;
}) {
  const total = images.length;
  const [page, setPage] = useState(0);
  const { width: windowWidth } = useWindowDimensions();
  const accentInk = useThemeColor({}, 'accentInk');
  const border = useThemeColor({}, 'border');

  // Peek-sized prints: each fills most of the strip with neighbours
  // peeking on both sides, so the set reads as a sideways scroll.
  const photoWidth = Math.round(Math.min(STRIP_PHOTO_MAX, windowWidth * STRIP_PHOTO_FRACTION));
  const stride = photoWidth + STRIP_GAP;
  // Half a viewport of padding on each end centres the first and last
  // prints; every stop between them is already a multiple of the stride,
  // so the interval stops land centred with no alignment prop.
  const sideInset = Math.max(0, Math.round((windowWidth - photoWidth) / 2));

  const handleMomentumEnd = useCallback(
    (event: NativeSyntheticEvent<NativeScrollEvent>) => {
      const next = Math.round(event.nativeEvent.contentOffset.x / stride);
      setPage(Math.min(total - 1, Math.max(0, next)));
    },
    [total, stride]
  );

  const photo = (image: OrderedImage, index: number) => (
    <FeedPhoto
      key={image.mediaId}
      uri={image.url}
      label={`Photo ${index + 1} of ${total}`}
      aspectRatio={TIMELINE_PHOTO_ASPECT}
      onPress={onPhotoPress ? (origin) => forwardPhotoPress(onPhotoPress, index, origin) : undefined}
      onLongPress={onPhotoLongPress}
      actionLabel={`Open photo ${index + 1} of ${total} fullscreen`}
    />
  );

  return (
    <View style={styles.root} testID="moment-photo-carousel">
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        snapToInterval={stride}
        decelerationRate="fast"
        contentContainerStyle={{ paddingHorizontal: sideInset }}
        onMomentumScrollEnd={handleMomentumEnd}
      >
        {images.map((image, index) => (
          <View
            key={image.mediaId}
            style={{ width: photoWidth, marginRight: index === total - 1 ? 0 : STRIP_GAP }}
          >
            {photo(image, index)}
          </View>
        ))}
      </ScrollView>
      {total > 1 ? (
        <View style={styles.pageIndicator}>
          {images.map((image, index) => (
            <View
              key={image.mediaId}
              testID="photo-page-dot"
              style={[styles.pageDot, { backgroundColor: index === page ? accentInk : border }]}
            />
          ))}
        </View>
      ) : null}
    </View>
  );
}

export function MomentOrderedImages({
  moment,
  paged = false,
  onPhotoPress,
  onPhotoLongPress,
}: {
  moment: Moment;
  /** Timeline sets swipe as one content-aligned carousel; article/detail keeps the stack. */
  paged?: boolean;
  /** Fullscreen tap per photo (timeline); prints stay plain when absent. */
  onPhotoPress?: (index: number, origin?: PhotoOrigin) => void;
  /** Own-moment hold per photo; rides the photo button when present. */
  onPhotoLongPress?: () => void;
}) {
  const images = orderedImageAttachments(moment);
  if (images.length === 0) return null;
  // A lone feed photo has nothing to page through: one content-aligned print.
  if (paged && images.length > 1) {
    return <MomentImagePager images={images} onPhotoPress={onPhotoPress} onPhotoLongPress={onPhotoLongPress} />;
  }
  if (paged) {
    return (
      <FeedPhoto
        uri={images[0].url}
        label={`Memory photo 1 of ${images.length}`}
        onPress={onPhotoPress ? () => onPhotoPress(0) : undefined}
        onLongPress={onPhotoLongPress}
        actionLabel="Open photo fullscreen"
      />
    );
  }
  return (
    <View style={styles.root}>
      {images.map((attachment, index) => {
        const label = `Memory photo ${index + 1} of ${images.length}`;
        const frame = (
          <AttachmentImage
            key={attachment.mediaId}
            uri={attachment.url}
            label={onPhotoPress ? undefined : label}
          />
        );
        if (!onPhotoPress && !onPhotoLongPress) {
          return <View key={attachment.mediaId}>{frame}</View>;
        }
        // The detail screen's photos open the same fullscreen viewer the
        // feed uses (zoom, drag to dismiss); the frame itself becomes the
        // button, so the photo is announced once.
        return (
          <MeasuredPress
            accessibilityHint={
              onPhotoPress && onPhotoLongPress
                ? 'Opens fullscreen; hold to edit or remove this moment'
                : onPhotoPress
                  ? 'Opens fullscreen'
                  : 'Hold to edit or remove this moment'
            }
            // Only promise the tap when there is one: a hold-only frame
            // keeps the photo's own name instead of naming a tap that does
            // nothing.
            accessibilityLabel={
              onPhotoPress ? `Open photo ${index + 1} of ${images.length} fullscreen` : label
            }
            delayLongPress={400}
            key={attachment.mediaId}
            onLongPress={onPhotoLongPress}
            onPress={onPhotoPress ? (origin) => forwardPhotoPress(onPhotoPress, index, origin) : undefined}
            radius={Radii.sheet}
          >
            <AttachmentImage uri={attachment.url} label={undefined} />
          </MeasuredPress>
        );
      })}
    </View>
  );
}

export function MomentOrderedAudios({ moment }: { moment: Moment }) {
  const audios = orderedAudioAttachments(moment);
  if (audios.length === 0) return null;
  return (
    <View style={styles.root}>
      {audios.map((attachment) => (
        <AudioPlayer key={attachment.mediaId} uri={attachment.url} />
      ))}
    </View>
  );
}

export function MomentAttachments({
  moment,
  onPhotoPress,
}: {
  moment: Moment;
  /** Fullscreen tap per photo; the article stack stays plain when absent. */
  onPhotoPress?: (index: number, origin?: PhotoOrigin) => void;
}) {
  if (!hasOrderedAttachments(moment)) return null;
  return (
    <View style={styles.root}>
      <MomentOrderedImages moment={moment} onPhotoPress={onPhotoPress} />
      <MomentOrderedAudios moment={moment} />
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    gap: 12,
  },
  image: {
    width: '100%',
    height: '100%',
  },
  photoFrame: {
    width: '100%',
    aspectRatio: TIMELINE_PHOTO_ASPECT,
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: Radii.sheet,
    borderCurve: 'continuous',
    overflow: 'hidden',
  },
  pageIndicator: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
  },
  pageDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
  },
});

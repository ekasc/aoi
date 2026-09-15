import * as Haptics from 'expo-haptics';
import { useEffect, useMemo, useRef, useState } from 'react';
import {
  AccessibilityInfo,
  AppState,
  StyleSheet,
  View,
  useWindowDimensions,
  type AppStateStatus,
} from 'react-native';
import { Image } from 'expo-image';
import {
  Canvas,
  Circle,
  Group,
  LinearGradient,
  Path,
  Rect,
  vec,
} from '@shopify/react-native-skia';
import Animated, {
  Easing,
  cancelAnimation,
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  withRepeat,
  withSequence,
  withTiming,
} from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import cloudABank from '@/assets/images/memory-sky-cloud-a.png';
import cloudBBank from '@/assets/images/memory-sky-cloud-b.png';
// Web note (existing, native unaffected): SkiaReady gates on CanvasKit WASM
// loaded in-component; the parent fixture preloads WASM before main via the
// shared bootstrap. Do not change the shared bootstrap here.
import { SkiaReady } from '@/components/landing/skia-ready';
import {
  DAY_SKY_STAR_PARTNER,
  DAY_SKY_STAR_YOU,
  DARK_SKY_MID,
  DARK_SKY_TOP,
  LIGHT_SKY_MID,
  LIGHT_SKY_TOP,
  mixHex,
  starToneColor,
} from '@/components/home/sky-palette';
import { ThemedText } from '@/components/themed-text';
import { Spacing } from '@/constants/theme';
import {
  buildDaySkyField,
  bucketStarsByDepth,
  projectWorldToScreen,
  type DaySkySpatialStar,
} from '@/features/home/day-sky-spatial';
import { formatDaySkyCaption } from '@/features/home/day-sky';
import type { Moment } from '@/features/moments/types';
import { useThemeColor } from '@/hooks/use-theme-color';

export const MEMORY_SKY_MAX_STARS = 40;
// Taller sky to match the reference composition (~0.30 viewport, approved
// behind the header through above the question) instead of 0.25.
export const MEMORY_SKY_QUARTER = 0.3;
// Compact top-only backdrop for Memories/Plans: half the Us viewport
// fraction, same top safety. Affects canvas height only, never the model.
export const MEMORY_SKY_COMPACT_QUARTER = MEMORY_SKY_QUARTER / 2;
// Bottom feather blending the cloud/star layer into the page background.
// Fraction of the strip height, same background RGB at alpha 0 -> opaque
// (no BlurView, no literal 'transparent' which blends black and bands gray).
export const MEMORY_SKY_FEATHER_FRACTION = 0.35;
// Smooth veil stops: fully clear at the top edge, then barely-there,
// easing to opaque so there is never an abrupt top edge.
export const MEMORY_SKY_FEATHER_ALPHAS = [0, 0.05, 0.25, 0.65, 1] as const;
export const MEMORY_SKY_FEATHER_POSITIONS = [0, 0.35, 0.62, 0.85, 1] as const;
// Compact (Memories/Plans) blends to TRANSPARENT, never to an opaque colour:
// the page behind it is the accent-tinted FrostedBackdrop, not the flat
// `background` token, so any opaque background veil paints a mismatched band.
// The strip eases out through a five-stop alpha ramp over its whole height.
// (Full-size Us sits on a flat page and keeps its opaque melt + veil.)
export const MEMORY_SKY_COMPACT_GRADIENT_POSITIONS = [0, 0.36, 0.6, 0.82, 1] as const;
// Compact star fade band (virtual sy units): stars fade to 0 at the visible
// bottom so no glow is clipped mid-dot at the boundary.
export const MEMORY_SKY_COMPACT_STAR_FADE_BAND = 0.25;
// Twinkle pool floor in compact: near-zero-opacity (bottom-faded) stars
// never pop at the boundary.
export const MEMORY_SKY_COMPACT_TWINKLE_MIN_OPACITY = 0.05;
// Compact clouds stay in the upper region with clearance from the strip
// bottom; their PNG transparent feathering handles soft edges, overflow
// clipping only at sides. Width scale keeps aspect (never squashed).
export const MEMORY_SKY_COMPACT_CLOUD_SCALE = 0.62;
export const MEMORY_SKY_COMPACT_CLOUD_BOTTOM_CLEARANCE = 16;
export const MEMORY_SKY_COMPACT_CLOUD_B_TOP = -12;
export const MEMORY_SKY_COMPACT_CLOUD_A_OPACITY = 0.38;
export const MEMORY_SKY_COMPACT_CLOUD_B_OPACITY = 0.32;

/**
 * Same color at a given alpha (hex #RGB/#RRGGBB/#RRGGBBAA or rgb()/rgba()
 * in, rgba()/8-digit hex out). Keeps the feather in the live background
 * hue so light themes never get a gray band from 'transparent' (black RGB).
 */
export function backgroundAtAlpha(color: string, alpha: number): string {
  const clamped = Math.min(1, Math.max(0, alpha));
  const hex = color.match(/^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8})$/);
  if (hex) {
    let body = hex[1];
    if (body.length === 3) {
      body = body
        .split('')
        .map((c) => c + c)
        .join('');
    } else if (body.length === 8) {
      body = body.slice(0, 6);
    }
    const a = Math.round(clamped * 255)
      .toString(16)
      .padStart(2, '0');
    return `#${body}${a}`;
  }
  const rgb = color.match(/rgba?\(\s*(\d+)\s*[,\s]+\s*(\d+)\s*[,\s]+\s*(\d+)/);
  if (rgb) {
    return `rgba(${Number(rgb[1])}, ${Number(rgb[2])}, ${Number(rgb[3])}, ${clamped})`;
  }
  return color;
}

/** Feather veil colors: same background RGB from clear to opaque. */
export function featherVeilColors(
  background: string,
  alphas: readonly number[] = MEMORY_SKY_FEATHER_ALPHAS,
): string[] {
  return alphas.map((a) => backgroundAtAlpha(background, a));
}
/** Compact main gradient: dusk held, then a five-stop alpha ramp to clear.
 *  `mixHex` keeps the hue family while the alpha falls — no opaque stop, so
 *  the strip dissolves into whatever textured page sits behind it. */
export function compactSkyGradientColors(skyTop: string, skyMid: string, background: string): string[] {
  return [
    skyTop,
    skyMid,
    backgroundAtAlpha(mixHex(skyMid, background, 0.45), 0.6),
    backgroundAtAlpha(mixHex(skyMid, background, 0.82), 0.26),
    backgroundAtAlpha(background, 0),
  ];
}
/**
 * Compact star fade to 0 at the visible bottom (virtual sy units).
 * visibleBottom is the clipped bottom (skyHeight / (H * scaleX), clamped to
 * 1); stars at/below it are invisible, fading over FADE_BAND above it.
 */
export function fadeCompactStarOpacity(opacity: number, screenY: number, visibleBottom: number): number {
  const bottom = Number.isFinite(visibleBottom) ? Math.min(1, Math.max(0.2, visibleBottom)) : 1;
  if (screenY >= bottom) {
    return 0;
  }
  const start = bottom - MEMORY_SKY_COMPACT_STAR_FADE_BAND;
  if (screenY <= start) {
    return opacity;
  }
  const t = (screenY - start) / MEMORY_SKY_COMPACT_STAR_FADE_BAND;
  return opacity * (1 - t);
}
/** Compact twinkle eligibility: bottom-faded stars never pop at the edge. */
export function isCompactTwinkleEligible(opacity: number): boolean {
  return opacity >= MEMORY_SKY_COMPACT_TWINKLE_MIN_OPACITY;
}
// Cap on large focal sparkles: the one-star-per-day model is never
// truncated; beyond this many bright candidates the rest render as faint
// dots (deterministic by day hash, see plotted memo).
export const MEMORY_SKY_FOCAL_BRIGHT_MAX = 16;
// Virtual canvas matches a 390pt-wide reference phone at 0.30 viewport
// (844pt * 0.30 ~= 253). Fractions map uniformly, so no squash.
export const MEMORY_SKY_CANVAS_W = 390;
export const MEMORY_SKY_CANVAS_H = 253;
// Generated banks are 1200x500 transparent PNGs; containers keep this
// aspect so the art is never squashed — transparent edges bleed offscreen
// and clip via overflow hidden (no hard seams).
export const MEMORY_SKY_CLOUD_ASPECT = 500 / 1200;
// Extra overhang above the safe area so the strip always covers the top
// (the old strip started at y8 and left a notch stripe); the gradient top
// bleeds offscreen and the height below grows by the same amount so the
// bottom/question rhythm is unchanged.
export const MEMORY_SKY_TOP_SAFETY = 12;

/**
 * Compact header-block height for Memories/Plans: matches the renderer's own
 * skyHeight math exactly so the fixed header block never overlaps scroll content.
 */
export function compactSkyHeightForWindow(windowHeight: number): number {
  return Math.round(windowHeight * MEMORY_SKY_COMPACT_QUARTER) + MEMORY_SKY_TOP_SAFETY;
}

// Docked system tab bar clearance on iOS (single source): tab screens
// import it from here so they never pull a native tab-bar chain. Scroll
// views with automatic insets clear the translucent bar themselves; this
// pads fixed bottom content (FAB-adjacent lists) above the bar estimate.
export const SYSTEM_TAB_BAR_IOS_CLEARANCE = 50;

// System tab bar geometry lives in ./compact-sky-geometry (single source,
// zero imports, no Skia): tab screens import from there so they never pull
// this file's Skia chain. Re-exported here for compat so existing
// memory-sky mocks keep working.
export {
  FAB_ABOVE_BAR_GAP,
  SYSTEM_TAB_BAR_BOTTOM_GAP,
  SYSTEM_TAB_BAR_CONTENT_HEIGHT,
  fabBottomOffset,
  systemTabBarTopOffset,
} from './compact-sky-geometry';

// Together toolbar minHeight is 44 (unchanged in together.tsx). Used only to
// extend the cardless strip upward above the safe area and to drop the
// caption just below the strip in normal flow.
const TOGETHER_TOOLBAR_MIN_HEIGHT = 44;

export const MEMORY_SKY_TWINKLE_GAP_MIN = 1800;
export const MEMORY_SKY_TWINKLE_GAP_MAX = 4200;
export const MEMORY_SKY_TWINKLE_ON_MS = 900;

/** Slow frontal drift for the lower cloud bank (transform only). */
export const MEMORY_SKY_CLOUD_A = { amplitudePx: 36, durationMs: 64000 } as const;
/** Slower counter-drift for the upper wisps (transform only). */
export const MEMORY_SKY_CLOUD_B = { amplitudePx: 28, durationMs: 88000 } as const;

// Aoi's sky palette lives in ./sky-palette (Skia-free) so non-canvas
// surfaces share the exact colours. Re-exported here for existing callers.
export {
  DAY_SKY_STAR_DIM,
  DAY_SKY_STAR_PARTNER,
  DAY_SKY_STAR_YOU,
  DARK_SKY_MID,
  DARK_SKY_TOP,
  LIGHT_SKY_MID,
  LIGHT_SKY_TOP,
  starToneColor,
} from './sky-palette';

/**
 * Mostly tiny points with few tapered bright sparkles for depth variety:
 * deterministic 1 in 16, stable per day. Others are small dots. The
 * renderer caps how many of these render as large focal sparkles
 * (MEMORY_SKY_FOCAL_BRIGHT_MAX, deterministic by day hash); the rest
 * render as faint dots with no truncation of the one-star-per-day model.
 */
export function isBrightDayStar(dayIndex: number): boolean {
  return hashMomentId(`day-${dayIndex}-bright`) % 16 === 0;
}

export function hashMomentId(id: string): number {
  let hash = 0;
  for (let i = 0; i < id.length; i += 1) {
    hash = ((hash << 5) - hash + id.charCodeAt(i)) | 0;
  }
  return hash >>> 0;
}

export type MemorySkyStarLayout = {
  leftPct: number;
  topPct: number;
  size: number;
};

/**
 * Whether a theme background is dark (relative luminance < 0.4): picks the
 * dusk stops so the gradient always melts into the live app background,
 * independent of the system scheme. Handles hex and rgb() theme tokens.
 */
export function isDarkBackground(color: string): boolean {
  const hex = color.match(/#([0-9a-fA-F]{6})/)?.[1] ?? null;
  const rgb = color.match(/rgba?\((\d+)[,\s]+(\d+)[,\s]+(\d+)/);
  const parts = hex
    ? [hex.slice(0, 2), hex.slice(2, 4), hex.slice(4, 6)].map((h) => parseInt(h, 16))
    : rgb
      ? [Number(rgb[1]), Number(rgb[2]), Number(rgb[3])]
      : [246, 242, 247];
  const [r, g, b] = parts;
  return (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255 < 0.4;
}

/** Memory-fallback scatter: stable per id, lower two-thirds of the strip. */
export function starForMoment(id: string): MemorySkyStarLayout {
  const hash = hashMomentId(id);
  const size = 2 + ((hash >>> 14) % 3);
  const leftPct = 2 + (hash % 94);
  // Lower two-thirds of the strip so stars stay out of the center-top
  // cluster behind the toolbar title.
  const topPct = 34 + ((hash >>> 7) % 58);
  return { leftPct, topPct, size };
}

/**
 * Resting brightness varies per star (faint 0.15-0.50) so the field reads
 * as depth with mostly tiny pinpoints. Stable forever per id.
 */
export function starRestOpacity(starId: string): number {
  return 0.15 + ((hashMomentId(starId) >>> 20) % 8) * 0.05;
}

/** Bright-sparkle tilt so the few sparkles never align. Range -12..12deg. */
export function sparkleRotationDeg(starId: string): number {
  return (hashMomentId(starId) % 25) - 12;
}

/** Base dot radius on a 390pt screen: far 0.35, mid 0.6, near 0.9. */
function baseStarRadius(size: 2 | 3 | 4): number {
  if (size === 2) {
    return 0.35;
  }
  if (size === 3) {
    return 0.6;
  }
  return 0.9;
}

/** Dot radius shrinks with camera zoom, min 0.25px. */
function starRadiusForZoom(size: 2 | 3 | 4, zoom: number): number {
  const z = Number.isFinite(zoom) && zoom >= 1 ? zoom : 1;
  return Math.max(0.25, baseStarRadius(size) / z);
}

/** Sparkle half-length 3-5px, shrinks with zoom, min 2px. */
function sparkleHalfLengthForZoom(size: 2 | 3 | 4, zoom: number): number {
  const base = size === 2 ? 3 : size === 3 ? 4 : 5;
  const z = Number.isFinite(zoom) && zoom >= 1 ? zoom : 1;
  return Math.max(2, base / z);
}

function useSystemReduceMotion(): boolean {
  const [enabled, setEnabled] = useState(false);
  useEffect(() => {
    let alive = true;
    AccessibilityInfo.isReduceMotionEnabled().then(
      (value) => {
        if (alive) {
          setEnabled(value);
        }
      },
      () => {},
    );
    const subscription = AccessibilityInfo.addEventListener('reduceMotionChanged', (value) => {
      if (alive) {
        setEnabled(value);
      }
    });
    return () => {
      alive = false;
      subscription.remove();
    };
  }, []);
  return enabled;
}

function useAppActive(): boolean {
  const [active, setActive] = useState(
    () => AppState.currentState == null || AppState.currentState === 'active',
  );
  useEffect(() => {
    const subscription = AppState.addEventListener('change', (next: AppStateStatus) => {
      setActive(next === 'active');
    });
    return () => subscription.remove();
  }, []);
  return active;
}

function useDocumentVisible(): boolean {
  const [visible, setVisible] = useState(
    () => typeof document === 'undefined' || document.visibilityState !== 'hidden',
  );
  useEffect(() => {
    if (typeof document === 'undefined') {
      return;
    }
    const onChange = () => {
      setVisible(document.visibilityState !== 'hidden');
    };
    document.addEventListener('visibilitychange', onChange);
    return () => document.removeEventListener('visibilitychange', onChange);
  }, []);
  return visible;
}

type PlottedStar = {
  key: string;
  cx: number;
  cy: number;
  size: 2 | 3 | 4;
  r: number;
  sparkleR: number;
  opacity: number;
  color: string;
  bright: boolean;
  rotationDeg: number;
};

function fadeAboveQuestion(opacity: number, screenY: number): number {
  if (screenY <= 0.72) {
    return opacity;
  }
  const t = Math.min(1, (screenY - 0.72) / 0.23);
  return opacity * (1 - t * 0.7);
}

// Textured cloud bank drifting in front of the stars: one Animated wrapper
// per bank (transform only), fully static when motion is off.
function CloudLayer({
  source,
  testID,
  width,
  height,
  top,
  opacity,
  amplitudePx,
  durationMs,
  reverse,
  motionAllowed,
}: {
  source: number | string;
  testID: string;
  width: number;
  height: number;
  top: number;
  opacity: number;
  amplitudePx: number;
  durationMs: number;
  reverse: boolean;
  motionAllowed: boolean;
}) {
  const x = useSharedValue(reverse ? amplitudePx : -amplitudePx);

  useEffect(() => {
    if (!motionAllowed) {
      return;
    }
    x.value = withRepeat(
      withTiming(reverse ? -amplitudePx : amplitudePx, {
        duration: durationMs,
        easing: Easing.inOut(Easing.sin),
      }),
      -1,
      true,
    );
    return () => {
      cancelAnimation(x);
    };
  }, [motionAllowed, amplitudePx, durationMs, reverse, x]);

  const animatedStyle = useAnimatedStyle(() => ({
    transform: [{ translateX: x.value }],
  }));

  return (
    <Animated.View
      testID={testID}
      pointerEvents="none"
      accessible={false}
      style={[styles.cloudLayer, { width, height, top, opacity }, motionAllowed ? animatedStyle : null]}
    >
      <Image accessible={false} source={source} contentFit="cover" style={{ width, height }} />
    </Animated.View>
  );
}

// Single bounded twinkle overlay: one star glows at a time, then clears.
// The static field underneath never animates per star.
function TwinkleOverlay({ x, y, color }: { x: number; y: number; color: string }) {
  const opacity = useSharedValue(0);
  const scale = useSharedValue(0.7);

  useEffect(() => {
    opacity.value = withSequence(
      withTiming(1, { duration: 200 }),
      withTiming(0, { duration: 700 }),
    );
    scale.value = withSequence(
      withTiming(1, { duration: 450 }),
      withTiming(0.9, { duration: 450 }),
    );
    return () => {
      cancelAnimation(opacity);
      cancelAnimation(scale);
    };
  }, [opacity, scale]);

  const animatedStyle = useAnimatedStyle(() => ({
    opacity: opacity.value,
    transform: [{ scale: scale.value }],
  }));

  return (
    <View pointerEvents="none" accessible={false} style={[styles.twinkleBase, { left: x, top: y }]}>
      <Animated.View style={[styles.twinkleDot, { backgroundColor: color }, animatedStyle]} />
    </View>
  );
}

export function MemorySky({
  moments,
  daysTogether,
  startDate,
  focused = true,
  now,
  compact = false,
}: {
  moments: Moment[];
  daysTogether?: number | null;
  startDate?: string | null;
  focused?: boolean;
  now?: Date;
  compact?: boolean;
}) {
  const { width: windowWidth, height: windowHeight } = useWindowDimensions();
  const insets = useSafeAreaInsets();
  const background = useThemeColor({}, 'background');
  const muted = useThemeColor({}, 'muted');
  const isDark = isDarkBackground(background);
  const skyTop = isDark ? DARK_SKY_TOP : LIGHT_SKY_TOP;
  const skyMid = isDark ? DARK_SKY_MID : LIGHT_SKY_MID;
  const reduceMotion = useReducedMotion();
  const systemReduce = useSystemReduceMotion();
  const appActive = useAppActive();
  const docVisible = useDocumentVisible();
  const motionAllowed =
    !reduceMotion && !systemReduce && appActive && docVisible && focused;

  const skyFraction = compact ? MEMORY_SKY_COMPACT_QUARTER : MEMORY_SKY_QUARTER;
  const skyHeight =
    Math.round(windowHeight * skyFraction) + MEMORY_SKY_TOP_SAFETY;
  // Us (non-compact): absolute strip covering the top ~30% including the
  // notch — starts above the safe area (negative top extends upward over
  // the toolbar padding + notch plus TOP_SAFETY so the old y8 stripe can
  // never show) at full screen width (negative sides bleed over the
  // content padding). Transparent with no panel background/border; the
  // Skia dusk gradient fades to the themed background above the question.
  // Compact (Memories/Plans): the root itself is absolute top0 left0 right0
  // behind content (rendered as the immediate root child after
  // FrostedBackdrop), so the internal sky is simply top0 left0 right0 with
  // no dependence on toolbar height or insets. The screen-filling root
  // parent already includes the inset, giving full bleed with no spacer.
  const stripTop = compact
    ? 0
    : -(
        insets.top +
        TOGETHER_TOOLBAR_MIN_HEIGHT +
        Spacing[8] +
        Spacing[16] +
        MEMORY_SKY_TOP_SAFETY
      );
  // Caption sits just below the strip in normal flow (8px quiet gap, Us only).
  const captionMarginTop = Math.max(
    Spacing[8],
    skyHeight - insets.top - TOGETHER_TOOLBAR_MIN_HEIGHT - Spacing[16],
  );

  const field = useMemo(
    () => buildDaySkyField(daysTogether, moments, startDate ?? null, now ?? new Date()),
    [daysTogether, moments, startDate, now],
  );
  const isDayMode = field !== null;
  const visible = useMemo(() => moments.slice(0, MEMORY_SKY_MAX_STARS), [moments]);
  const dayCount = typeof daysTogether === 'number' ? daysTogether : 0;
  const count = isDayMode ? dayCount : moments.length;

  const buckets = useMemo(
    () => (field ? bucketStarsByDepth(field.stars) : null),
    [field],
  );
  const zoom = field ? field.camera.zoom : 1;

  // Compact visible bottom in virtual sy: uniform scale clips via overflow
  // hidden, so only the top skyHeight / (H * scaleX) shows. Stars fade to 0
  // there (renderer data), never clipped mid-glow.
  const compactVisibleBottomSy = compact
    ? Math.min(1, skyHeight / (MEMORY_SKY_CANVAS_H * (windowWidth / MEMORY_SKY_CANVAS_W)))
    : 1;

  // Plot every star once per field/camera change: world -> screen via the
  // calendar camera, then fractions -> canvas pixels. Static plain data for
  // the single batched Skia canvas (no animated view per star).
  const plotted = useMemo(() => {
    const canvasW = MEMORY_SKY_CANVAS_W;
    const canvasH = MEMORY_SKY_CANVAS_H;
    const plot = (worldX: number, worldY: number) => {
      const screen = projectWorldToScreen({ x: worldX, y: worldY }, zoom);
      return { cx: screen.x * canvasW, cy: screen.y * canvasH, sy: screen.y };
    };
    const out: { far: PlottedStar[]; mid: PlottedStar[]; near: PlottedStar[] } = {
      far: [],
      mid: [],
      near: [],
    };
    if (field && buckets) {
      const push = (star: DaySkySpatialStar) => {
        const p = plot(star.x, star.y);
        // Cull offscreen visually only; field.stars still holds all days.
        if (
          p.cx < -0.02 * canvasW ||
          p.cx > 1.02 * canvasW ||
          p.cy < -0.02 * canvasH ||
          p.cy > 1.02 * canvasH
        ) {
          return;
        }
        const key = `day-${star.dayIndex}`;
        // Memory days read slightly brighter, still faint (cap 0.65).
        const baseOpacity =
          star.tone === 'dim' ? star.opacity : Math.min(0.65, star.opacity + 0.1);
        const entry: PlottedStar = {
          key,
          cx: p.cx,
          cy: p.cy,
          size: star.size,
          r: starRadiusForZoom(star.size, zoom),
          sparkleR: sparkleHalfLengthForZoom(star.size, zoom),
          opacity: compact
            ? fadeCompactStarOpacity(baseOpacity, p.sy, compactVisibleBottomSy)
            : fadeAboveQuestion(baseOpacity, p.sy),
          color: starToneColor(star.tone),
          bright: isBrightDayStar(star.dayIndex),
          rotationDeg: sparkleRotationDeg(key),
        };
        if (star.size === 2) {
          out.far.push(entry);
        } else if (star.size === 3) {
          out.mid.push(entry);
        } else {
          out.near.push(entry);
        }
      };
      buckets.far.forEach(push);
      buckets.mid.forEach(push);
      buckets.near.forEach(push);
      // Focal cap: keep the N brightest candidates by day hash as large
      // sparkles, demote the rest to faint dots. Total plotted is unchanged
      // (no truncation); only the large-ray count is bounded (~12-18).
      {
        const all = [...out.far, ...out.mid, ...out.near];
        const candidates = all.filter((entry) => entry.bright);
        if (candidates.length > MEMORY_SKY_FOCAL_BRIGHT_MAX) {
          const rank = (key: string) => hashMomentId(`${key}-bright`);
          candidates.sort((a, b) => rank(a.key) - rank(b.key));
          const keep = new Set(
            candidates.slice(0, MEMORY_SKY_FOCAL_BRIGHT_MAX).map((entry) => entry.key),
          );
          for (const entry of candidates) {
            if (!keep.has(entry.key)) {
              entry.bright = false;
            }
          }
        }
      }
      return out;
    }
    for (const moment of visible) {
      const layout = starForMoment(moment.id);
      const p = { cx: (layout.leftPct / 100) * canvasW, cy: (layout.topPct / 100) * canvasH };
      if (
        p.cx < -0.02 * canvasW ||
        p.cx > 1.02 * canvasW ||
        p.cy < -0.02 * canvasH ||
        p.cy > 1.02 * canvasH
      ) {
        continue;
      }
      const size = layout.size as PlottedStar['size'];
      const entry: PlottedStar = {
        key: moment.id,
        cx: p.cx,
        cy: p.cy,
        size,
        r: starRadiusForZoom(size, 1),
        sparkleR: sparkleHalfLengthForZoom(size, 1),
        opacity: compact
          ? fadeCompactStarOpacity(starRestOpacity(moment.id), layout.topPct / 100, compactVisibleBottomSy)
          : fadeAboveQuestion(starRestOpacity(moment.id), layout.topPct / 100),
        color: moment.authorRole === 'partner' ? DAY_SKY_STAR_PARTNER : DAY_SKY_STAR_YOU,
        bright: hashMomentId(`${moment.id}-bright`) % 16 === 0,
        rotationDeg: sparkleRotationDeg(moment.id),
      };
      if (layout.size === 2) {
        out.far.push(entry);
      } else if (layout.size === 3) {
        out.mid.push(entry);
      } else {
        out.near.push(entry);
      }
    }
    return out;
  }, [field, buckets, zoom, visible, compact, compactVisibleBottomSy]);

  const starByKey = useMemo(() => {
    const map = new Map<string, PlottedStar>();
    for (const star of [...plotted.far, ...plotted.mid, ...plotted.near]) {
      map.set(star.key, star);
    }
    return map;
  }, [plotted]);

  const twinkleIds = useMemo(() => {
    if (!compact) {
      return [...starByKey.keys()];
    }
    return [...starByKey.entries()]
      .filter(([, star]) => isCompactTwinkleEligible(star.opacity))
      .map(([key]) => key);
  }, [starByKey, compact]);

  const newestKey = useMemo(() => {
    if (field && field.stars.length > 0) {
      return `day-${field.stars[field.stars.length - 1].dayIndex}`;
    }
    if (visible.length > 0) {
      return visible[visible.length - 1].id;
    }
    return undefined;
  }, [field, visible]);

  const [twinkleKey, setTwinkleKey] = useState<string | null>(null);
  const prevCountRef = useRef(count);

  // One owner for every sky timer: arrival haptic + priority showcase for
  // the newest star, otherwise a single recursive twinkle loop (exactly one
  // star at a time, bounded gaps). No timers at all when motion is off.
  useEffect(() => {
    const prev = prevCountRef.current;
    prevCountRef.current = count;
    if (!motionAllowed || twinkleIds.length === 0) {
      return;
    }
    let cancelled = false;
    let gapTimer: ReturnType<typeof setTimeout> | undefined;
    let clearTimer: ReturnType<typeof setTimeout> | undefined;
    const show = (key: string) => {
      if (cancelled) {
        return;
      }
      setTwinkleKey(key);
      clearTimer = setTimeout(() => {
        if (cancelled) {
          return;
        }
        setTwinkleKey(null);
        schedule();
      }, MEMORY_SKY_TWINKLE_ON_MS);
    };
    const schedule = () => {
      if (cancelled) {
        return;
      }
      const gap =
        MEMORY_SKY_TWINKLE_GAP_MIN +
        Math.random() * (MEMORY_SKY_TWINKLE_GAP_MAX - MEMORY_SKY_TWINKLE_GAP_MIN);
      gapTimer = setTimeout(() => {
        if (cancelled) {
          return;
        }
        const picked = twinkleIds[Math.floor(Math.random() * twinkleIds.length)];
        if (picked === undefined) {
          schedule();
          return;
        }
        show(picked);
      }, gap);
    };
    if (count > prev) {
      try {
        void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {});
      } catch {
        // Device-only: ignore on web.
      }
      if (newestKey !== undefined && twinkleIds.includes(newestKey)) {
        show(newestKey);
      } else {
        schedule();
      }
    } else {
      setTwinkleKey(null);
      schedule();
    }
    return () => {
      cancelled = true;
      if (gapTimer !== undefined) {
        clearTimeout(gapTimer);
      }
      if (clearTimer !== undefined) {
        clearTimeout(clearTimer);
      }
    };
  }, [motionAllowed, twinkleIds, newestKey, count]);

  const twinkleStar = twinkleKey ? (starByKey.get(twinkleKey) ?? null) : null;
  const twinkleAttr = (
    twinkleStar ? { 'data-star-key': twinkleStar.key } : {}
  ) as unknown as Record<string, string>;
  const scaleX = windowWidth / MEMORY_SKY_CANVAS_W;
  // Compact keeps the approved star shapes (uniform scale, lower half clips
  // via overflow hidden) instead of squashing the field vertically.
  const scaleY = compact ? scaleX : skyHeight / MEMORY_SKY_CANVAS_H;
  // Veil is the full-size sky's technique (flat page under it). The compact
  // strip must NOT use it: it blends to transparent through the gradient.
  const featherHeight = Math.round(skyHeight * MEMORY_SKY_FEATHER_FRACTION);
  const featherColors = useMemo(() => featherVeilColors(background), [background]);
  const featherPositions = [...MEMORY_SKY_FEATHER_POSITIONS];
  // Compact main gradient fades to same-hue transparent exactly at the
  // visible strip bottom (skyHeight); Us keeps the opaque background melt.
  const skyGradientColors = compact
    ? compactSkyGradientColors(skyTop, skyMid, background)
    : [skyTop, skyMid, background];
  const skyGradientPositions = compact
    ? [...MEMORY_SKY_COMPACT_GRADIENT_POSITIONS]
    : [0, 0.55, 1];

  const renderBucket = (stars: PlottedStar[]) => (
    <>
      {stars
        .filter((star) => !star.bright)
        .map((star) => (
          <Circle
            key={star.key}
            cx={star.cx * scaleX}
            cy={star.cy * scaleY}
            r={star.r}
            color={star.color}
            opacity={star.opacity}
          />
        ))}
      {stars
        .filter((star) => star.bright)
        .map((star) => {
          const cx = star.cx * scaleX;
          const cy = star.cy * scaleY;
          const R = star.sparkleR;
          const w = R * 0.22;
          const radians = (star.rotationDeg * Math.PI) / 180;
          const d =
            `M ${cx} ${cy - R} ` +
            `Q ${cx + w} ${cy - w} ${cx + R} ${cy} ` +
            `Q ${cx + w} ${cy + w} ${cx} ${cy + R} ` +
            `Q ${cx - w} ${cy + w} ${cx - R} ${cy} ` +
            `Q ${cx - w} ${cy - w} ${cx} ${cy - R} Z`;
          return (
            <Group key={star.key} origin={vec(cx, cy)} transform={[{ rotate: radians }]}>
              <Path
                path={d}
                color={star.color}
                opacity={Math.min(1, star.opacity + 0.2)}
              />
            </Group>
          );
        })}
    </>
  );

  const caption = isDayMode
    ? formatDaySkyCaption(dayCount)
    : count === 0
      ? 'Keep your first memory and light the sky'
      : count === 1
        ? '1 memory lighting your sky'
        : `${count} memories lighting your sky`;

  // Aspect-correct banks (never squashed): same 1200x500 ratio as the
  // source art; transparent edges bleed offscreen and clip (no hard seams).
  // Compact stays in the upper region with bottom clearance so PNG feathering
  // handles soft edges and overflow clips only at sides. Drift stays subtle.
  const cloudWidthFull = windowWidth + 120;
  const cloudHeightFull = Math.round(cloudWidthFull * MEMORY_SKY_CLOUD_ASPECT);
  const cloudWidth = compact
    ? Math.round(cloudWidthFull * MEMORY_SKY_COMPACT_CLOUD_SCALE)
    : cloudWidthFull;
  const cloudHeight = compact
    ? Math.round(cloudWidth * MEMORY_SKY_CLOUD_ASPECT)
    : cloudHeightFull;
  const cloudBTop = compact ? MEMORY_SKY_COMPACT_CLOUD_B_TOP : -24;
  const cloudATop = compact
    ? skyHeight - cloudHeight - MEMORY_SKY_COMPACT_CLOUD_BOTTOM_CLEARANCE
    : skyHeight - cloudHeightFull + 28;
  const cloudBOpacity = compact ? MEMORY_SKY_COMPACT_CLOUD_B_OPACITY : 0.45;
  const cloudAOpacity = compact ? MEMORY_SKY_COMPACT_CLOUD_A_OPACITY : 0.55;

  return (
    <View
      testID="memory-sky"
      pointerEvents="none"
      accessible={false}
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
      aria-hidden
      style={compact ? [styles.rootCompact, { height: skyHeight }] : styles.root}
    >
      <View
        testID="memory-sky-strip"
        pointerEvents="none"
        accessible={false}
        style={[
          styles.sky,
          compact
            ? {
                top: 0,
                left: 0,
                right: 0,
                height: skyHeight,
              }
            : {
                top: stripTop,
                left: -Spacing[16],
                right: -Spacing[16],
                height: skyHeight,
              },
        ]}
      >
        <View
          testID="memory-sky-canvas"
          pointerEvents="none"
          accessible={false}
          style={StyleSheet.absoluteFill}
        >
          <SkiaReady>
            {(ready) =>
              ready ? (
                <Canvas style={{ width: windowWidth, height: skyHeight }}>
                  <Rect x={0} y={0} width={windowWidth} height={skyHeight}>
                    <LinearGradient
                      start={vec(0, 0)}
                      end={vec(0, skyHeight)}
                      colors={skyGradientColors}
                      positions={skyGradientPositions}
                    />
                  </Rect>
                  <Group>
                    {renderBucket(plotted.far)}
                  </Group>
                  <Group>
                    {renderBucket(plotted.mid)}
                  </Group>
                  <Group>
                    {renderBucket(plotted.near)}
                  </Group>
                </Canvas>
              ) : (
                <View style={{ width: windowWidth, height: skyHeight }} />
              )
            }
          </SkiaReady>
        </View>
        <CloudLayer
          testID="memory-sky-cloud-b"
          source={cloudBBank}
          width={cloudWidth}
          height={cloudHeight}
          top={cloudBTop}
          opacity={cloudBOpacity}
          amplitudePx={MEMORY_SKY_CLOUD_B.amplitudePx}
          durationMs={MEMORY_SKY_CLOUD_B.durationMs}
          reverse
          motionAllowed={motionAllowed}
        />
        <CloudLayer
          testID="memory-sky-cloud-a"
          source={cloudABank}
          width={cloudWidth}
          height={cloudHeight}
          top={cloudATop}
          opacity={cloudAOpacity}
          amplitudePx={MEMORY_SKY_CLOUD_A.amplitudePx}
          durationMs={MEMORY_SKY_CLOUD_A.durationMs}
          reverse={false}
          motionAllowed={motionAllowed}
        />
        {motionAllowed && twinkleStar ? (
          <View
            testID="memory-sky-twinkle"
            pointerEvents="none"
            accessible={false}
            style={StyleSheet.absoluteFill}
            {...twinkleAttr}
          >
            <TwinkleOverlay
              x={twinkleStar.cx * scaleX}
              y={twinkleStar.cy * scaleY}
              color={twinkleStar.color}
            />
          </View>
        ) : null}
        {compact ? null : (
        <View
          testID="memory-sky-feather"
          pointerEvents="none"
          accessible={false}
          style={{ position: 'absolute', left: 0, right: 0, bottom: 0, height: featherHeight }}
        >
          <SkiaReady>
            {(ready) =>
              ready ? (
                <Canvas style={{ width: windowWidth, height: featherHeight }}>
                  <Rect x={0} y={0} width={windowWidth} height={featherHeight}>
                    <LinearGradient
                      start={vec(0, 0)}
                      end={vec(0, featherHeight)}
                      colors={featherColors}
                      positions={featherPositions}
                    />
                  </Rect>
                </Canvas>
              ) : (
                <View style={{ width: windowWidth, height: featherHeight }} />
              )
            }
          </SkiaReady>
        </View>
        )}
        {!isDayMode && visible.length === 0 ? (
          <View
            testID="memory-sky-star-empty"
            pointerEvents="none"
            accessible={false}
            style={[styles.emptyStar, { backgroundColor: muted }]}
          />
        ) : null}
      </View>
      {compact ? null : (
      <ThemedText
        type="caption"
        style={[styles.caption, { color: muted, marginTop: captionMarginTop }]}
      >
        {caption}
      </ThemedText>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  root: {},
  rootCompact: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    backgroundColor: 'transparent',
    overflow: 'hidden',
  },
  sky: {
    position: 'absolute',
    backgroundColor: 'transparent',
    overflow: 'hidden',
  },
  cloudLayer: {
    position: 'absolute',
    left: -60,
  },
  twinkleBase: {
    position: 'absolute',
    width: 12,
    height: 12,
    marginLeft: -6,
    marginTop: -6,
    alignItems: 'center',
    justifyContent: 'center',
  },
  twinkleDot: {
    width: 5,
    height: 5,
    borderRadius: 2.5,
  },
  caption: {
    textAlign: 'center',
  },
  emptyStar: {
    position: 'absolute',
    left: '50%',
    top: '50%',
    width: 3,
    height: 3,
    borderRadius: 2,
    opacity: 0.3,
  },
});

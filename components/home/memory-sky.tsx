import * as Haptics from 'expo-haptics';
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
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
  RadialGradient,
  Rect,
  Shader,
  Skia,
  vec,
  type SkRuntimeEffect,
} from '@shopify/react-native-skia';
import Animated, {
  Easing,
  cancelAnimation,
  runOnJS,
  useAnimatedReaction,
  useAnimatedStyle,
  useDerivedValue,
  useReducedMotion,
  useSharedValue,
  withRepeat,
  withSequence,
  withTiming,
  type SharedValue,
} from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import cloudABank from '@/assets/images/memory-sky-cloud-a.png';
import { SETUP_SKY_PEAK, blendSkyUniforms, settlingSkyHeight, skyBottomFeather } from '@/components/setup/sky-handover';
import cloudBBank from '@/assets/images/memory-sky-cloud-b.png';
// Web note (existing, native unaffected): SkiaReady gates on CanvasKit WASM
// loaded in-component; the parent fixture preloads WASM before main via the
// shared bootstrap. Do not change the shared bootstrap here.
import { SkiaReady } from '@/components/landing/skia-ready';
import {
  DAY_SKY_STAR_DIM,
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
import type { SkyItem } from '@/features/home/day-sky';
import { useThemeColor } from '@/hooks/use-theme-color';

export const MEMORY_SKY_MAX_STARS = 40;
// Taller sky to match the reference composition (~0.30 viewport, approved
// behind the header through above the question) instead of 0.25.
export const MEMORY_SKY_QUARTER = 0.3;
// Compact top-only backdrop for Memories/Plans: half the Us viewport
// fraction, same top safety. Affects canvas height only, never the model.
export const MEMORY_SKY_COMPACT_QUARTER = MEMORY_SKY_QUARTER / 2;
/**
 * The header band on a working screen (Plans): the sky is identity, not the
 * subject, so it takes the top of the page without eating it. About 40% less
 * than the compact band.
 */
export const MEMORY_SKY_HEADER_QUARTER = MEMORY_SKY_COMPACT_QUARTER * 0.6;
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
// The strip eases out through an eight-stop ramp over its whole height.
// (Full-size Us sits on a flat page and keeps its opaque melt + veil.)
/**
 * Where the band's dusk is at its lightest, as a fraction of the strip.
 *
 * A piecewise-linear ramp rounds a corner wherever it changes direction,
 * which is invisible on a short strip and a line drawn straight across the sky
 * on a tall band, so the ramp is built around an eased turn at this point.
 */
export const COMPACT_SKY_PEAK = 0.42;

export function compactSkyGradientPositions(peak: number): number[] {
  const turn = Math.min(0.9, Math.max(0.1, peak));
  const rest = 1 - turn;
  return [0, turn * 0.33, turn * 0.66, turn, turn + rest * 0.25, turn + rest * 0.5, turn + rest * 0.75, 1];
}

export const MEMORY_SKY_COMPACT_GRADIENT_POSITIONS = compactSkyGradientPositions(
  COMPACT_SKY_PEAK,
);
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
 * Cloud cover for a scenery sky: three banks, all held in the upper two
 * thirds.
 *
 * The banks are separate Views drawn over the gradient, so the sky's own fade
 * never thins them. A bank low on the strip therefore shows up as a grey blob
 * floating out past the sky, which is the "smoke" a first-run sky must not
 * have, so every ambient bank keeps clear of the faded bottom.
 */
export const MEMORY_SKY_AMBIENT_CLOUD_B_OPACITY = 0.3;
export const MEMORY_SKY_AMBIENT_CLOUD_A_OPACITY = 0.22;
export const MEMORY_SKY_AMBIENT_CLOUD_C_OPACITY = 0.14;
/** Top of the mid bank, as a fraction of the strip's height. */
export const MEMORY_SKY_AMBIENT_CLOUD_A_TOP = 0.2;
/** Top of the low wisps, as a fraction of the strip's height. */
export const MEMORY_SKY_AMBIENT_CLOUD_C_TOP = 0.42;
/** The low wisps are a smaller piece of the same bank, not a new one. */
export const MEMORY_SKY_AMBIENT_CLOUD_C_SCALE = 0.45;

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

/** What the Us sky is holding its breath for: a letter come due, or a
 *  question waiting on both of you. Null means a quiet sky. Us-only
 *  (`immersive`, which Us sets on its own); working-screen strips
 *  without `immersive` never glow. */
export type SkyGlowKind = 'letter' | 'question';

/** Time-of-day aura phase for the Us sky, derived from `now`. */
export type DayPhase = 'dawn' | 'day' | 'dusk' | 'night';

/** Subtle mid-stop tints per phase; day keeps the canonical palette. */
export const DAY_PHASE_TINTS = {
  dawn: '#E8A06A',
  day: null,
  dusk: '#C96F5A',
  night: '#232B4D',
} as const;

export function dayPhaseForHour(hour: number): DayPhase {
  const h = Number.isFinite(hour) ? ((Math.floor(hour) % 24) + 24) % 24 : 12;
  if (h >= 5 && h < 8) {
    return 'dawn';
  }
  if (h >= 8 && h < 17) {
    return 'day';
  }
  if (h >= 17 && h < 21) {
    return 'dusk';
  }
  return 'night';
}

/** Nudge the dusk mid-stop toward the phase tint (Us sky only). */
export function tintSkyMidForPhase(skyMid: string, phase: DayPhase): string {
  const tint = DAY_PHASE_TINTS[phase];
  return tint ? mixHex(skyMid, tint, 0.22) : skyMid;
}

/**
 * Us sky mood: the whole gradient runs a few degrees warmer when a letter
 * is waiting, cooler when a question is. No shapes, no pulse — just light.
 * Pure so it stays testable; applied only to the Us (`immersive`) stops.
 */
export function moodSkyStops(
  skyTop: string,
  skyMid: string,
  phase: DayPhase,
  glow: SkyGlowKind | null,
): [string, string] {
  const mid = tintSkyMidForPhase(skyMid, phase);
  if (glow === 'letter') {
    return [mixHex(skyTop, '#8A4B3C', 0.16), mixHex(mid, '#A9765B', 0.16)];
  }
  if (glow === 'question') {
    return [mixHex(skyTop, '#3A3F66', 0.16), mixHex(mid, '#6E6E9E', 0.16)];
  }
  return [skyTop, mid];
}

/** Feather veil colors: same background RGB from clear to opaque. */
export function featherVeilColors(
  background: string,
  alphas: readonly number[] = MEMORY_SKY_FEATHER_ALPHAS,
): string[] {
  return alphas.map((a) => backgroundAtAlpha(background, a));
}
/** Smoothstep, so the ramp's rate of change is zero at both of its ends. */
function easeInOut(t: number): number {
  return t * t * (3 - 2 * t);
}

/**
 * Compact main gradient: dusk held, then an alpha ramp to clear.
 *
 * `mixHex` keeps the hue family while the alpha falls — no opaque stop, so
 * the strip dissolves into whatever textured page sits behind it. Both the
 * colour and the alpha ride the same eased curve, so the sky brightens into
 * the mid and fades out of it without a seam at the turn.
 */
/**
 * The turn's colour, given where the turn is.
 *
 * The band's dusk turns at 0.42, and it is at its *lightest* there. A sky that
 * has opened up and taken the words inside it turns much later, and it has to
 * be darker at that point or the words cannot be read in light mode: white on
 * the band's mid is about 4:1. So the later the turn, the deeper it goes, and
 * the lightening that reads as dusk moves out to the horizon.
 */
export function skyTurnDepth(peak: number): number {
  return Math.min(1, Math.max(0, (peak - COMPACT_SKY_PEAK) / 0.36));
}

export function compactSkyTurnColor(skyTop: string, skyMid: string, peak: number): string {
  const depth = skyTurnDepth(peak);
  return depth > 0 ? mixHex(skyMid, skyTop, depth * 0.45) : skyMid;
}

/**
 * The compact ramp, turning at `peak` (0.42 is the band's dusk).
 *
 * The turn is a parameter because the sky is not always a band. When it opens
 * up and the words move inside it, the turn has to travel down with them:
 * the dusk is at its *lightest* where it turns, and words on the light half of
 * a dusk are unreadable in light mode. Past the words it melts to the page,
 * which is what the eye reads as the horizon.
 */
export function compactSkyGradientColors(
  skyTop: string,
  skyMid: string,
  background: string,
  peak: number = COMPACT_SKY_PEAK,
): string[] {
  const turn = Math.min(0.9, Math.max(0.1, peak));
  const turnColor = compactSkyTurnColor(skyTop, skyMid, turn);
  return compactSkyGradientPositions(turn).map((position, index) => {
    if (index === 0) {
      return skyTop;
    }
    if (position >= 1) {
      return backgroundAtAlpha(background, 0);
    }
    if (position === turn) {
      return turnColor;
    }
    if (position < turn) {
      const eased = easeInOut(position / turn);
      return backgroundAtAlpha(mixHex(skyTop, turnColor, eased), 1);
    }
    const eased = easeInOut((position - turn) / (1 - turn));
    return backgroundAtAlpha(mixHex(turnColor, background, eased), 1 - eased);
  });
}

/**
 * The compact sky's dusk, as a shader.
 *
 * The stop-ramp above is a fallback. This computes the same dusk as a
 * continuous function of position, which means there are no stops to
 * interpolate between and therefore no corner, at any band height, in any
 * theme, forever. It also carries the two lights, so one draw call replaces
 * the gradient and both radial overlays, and it adds a 255th of noise because
 * a gradation this wide across eight bits per channel shows its steps.
 *
 * Every uniform is fed from the live theme, so the shader is never told what
 * colour the sky is: it is told what the sky's three tones are and does the
 * rest.
 *
 * Two things about Skia runtime effects are easy to get wrong here. The
 * output is **premultiplied**: returning the colour unscaled alongside
 * `1.0 - fall` made the band far too bright and stopped it fading at all,
 * because the compositor read the colour as already multiplied by the alpha.
 * And the fragment coordinate is in canvas pixels, not in 0..1, so the two
 * lights take pixel positions and the vertical ramp divides by `uSize.y`.
 */
export const MEMORY_SKY_DUSK_SKSL = `
uniform float2 uSize;
uniform float4 uTop;
uniform float4 uMid;
uniform float4 uHorizon;
uniform float uPeak;
uniform float uFeather;
uniform float2 uLight;
uniform float uLightRadius;
uniform float uLightStrength;
uniform float4 uLightColor;
uniform float2 uGlow;
uniform float uGlowRadius;
uniform float uGlowStrength;
uniform float4 uGlowColor;
uniform float uDither;

float ease(float t) { return t * t * (3.0 - 2.0 * t); }

float hash(float2 p) {
  p = fract(p * float2(123.34, 456.21));
  p += dot(p, p + 45.32);
  return fract(p.x * p.y);
}

half4 main(float2 xy) {
  float v = xy.y / uSize.y;
  float rise = ease(clamp(v / uPeak, 0.0, 1.0));
  float fall = ease(clamp((v - uPeak) / (1.0 - uPeak), 0.0, 1.0));

  float3 col = mix(uTop.rgb, uMid.rgb, rise);
  if (v > uPeak) {
    col = mix(uMid.rgb, uHorizon.rgb, fall);
  }

  float light = uLightStrength * (1.0 - smoothstep(0.0, uLightRadius, distance(xy, uLight)));
  col = mix(col, uLightColor.rgb, light);
  float glow = uGlowStrength * (1.0 - smoothstep(0.0, uGlowRadius, distance(xy, uGlow)));
  col = mix(col, uGlowColor.rgb, glow);

  col += (hash(xy) - 0.5) * uDither;

  float fadeStart = max(0.0, uPeak - uFeather);
  float fade = ease(clamp((v - fadeStart) / (1.0 - fadeStart), 0.0, 1.0));
  float alpha = 1.0 - fade;
  return half4(half3(clamp(col, 0.0, 1.0) * alpha), half(alpha));
}
`;

let duskEffect: SkRuntimeEffect | null = null;

/**
 * Compiled once per launch. Returns null (and stays null for this render) when
 * the platform has no runtime effects, so the stop-ramp keeps the sky.
 */
function duskEffectOnce(): SkRuntimeEffect | null {
  if (duskEffect) {
    return duskEffect;
  }
  try {
    duskEffect = Skia?.RuntimeEffect?.Make(MEMORY_SKY_DUSK_SKSL) ?? null;
  } catch {
    duskEffect = null;
  }
  return duskEffect;
}

/** A theme colour as the unit floats a shader uniform wants. */
function colorToRgba(color: string): number[] {
  const hex = color.match(/^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8})$/);
  if (hex) {
    let body = hex[1];
    if (body.length === 3) {
      body = body
        .split('')
        .map((c) => c + c)
        .join('');
    }
    return [
      parseInt(body.slice(0, 2), 16) / 255,
      parseInt(body.slice(2, 4), 16) / 255,
      parseInt(body.slice(4, 6), 16) / 255,
      body.length === 8 ? parseInt(body.slice(6, 8), 16) / 255 : 1,
    ];
  }
  const fn = color.match(
    /rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)\s*(?:,\s*([\d.]+))?\)/,
  );
  if (fn) {
    return [
      Number(fn[1]) / 255,
      Number(fn[2]) / 255,
      Number(fn[3]) / 255,
      fn[4] === undefined ? 1 : Number(fn[4]),
    ];
  }
  return [0, 0, 0, 1];
}

export type DuskUniforms = Record<string, number | number[]>;

/**
 * The shader's uniform payload for one strip. Pure, so the geometry and the
 * palette can be asserted without a GPU.
 */
function peakFor(options: { peak?: number }): number {
  return Math.min(0.92, Math.max(0.1, options.peak ?? COMPACT_SKY_PEAK));
}

/**
 * The horizon light, given where the sky turns.
 *
 * It sits just below the turn, which is where a dusk's light actually is, and
 * it grows as the turn travels down: a sky that has opened up and taken the
 * words inside it needs the stretch below them to be doing something, or the
 * words sit on a flat field with nothing under them.
 */
function horizonLightFor(peak: number): SkyLight {
  return {
    ...MEMORY_SKY_HORIZON_GLOW,
    y: peak + 0.06,
    alpha: MEMORY_SKY_HORIZON_GLOW.alpha * (1 + skyTurnDepth(peak) * 1.6),
  };
}

export function duskSkyUniforms(options: {
  width: number;
  height: number;
  skyTop: string;
  skyMid: string;
  background: string;
  /** Where the dusk turns. Moves with the sky when it opens. */
  peak?: number;
  /**
   * How far the frame has pushed into the sky, 0 to 1.
   *
   * The field is not one flat picture: each depth travels a different
   * distance as the camera moves, which is the whole reason a view of a star
   * field reads as a place rather than as a texture. Far crawls, near sweeps,
   * clouds go first because they are nearest.
   */
  camera?: number;
}): DuskUniforms {
  const light = skyGlowGeometry(options.width, options.height);
  const glow = skyGlowGeometry(options.width, options.height, horizonLightFor(peakFor(options)));
  const peak = peakFor(options);
  const turn = compactSkyTurnColor(options.skyTop, options.skyMid, peak);
  return {
    uSize: [options.width, options.height],
    uTop: colorToRgba(options.skyTop),
    uMid: colorToRgba(turn),
    uHorizon: colorToRgba(options.background),
    uPeak: peak,
    uFeather: 0,
    uLight: [light.cx, light.cy],
    uLightRadius: light.radius,
    uLightStrength: MEMORY_SKY_GLOW.alpha,
    uLightColor: colorToRgba(mixHex(turn, '#FFFFFF', MEMORY_SKY_GLOW.lift)),
    uGlow: [glow.cx, glow.cy],
    uGlowRadius: glow.radius,
    uGlowStrength: MEMORY_SKY_HORIZON_GLOW.alpha,
    uGlowColor: colorToRgba(mixHex(turn, '#FFFFFF', MEMORY_SKY_HORIZON_GLOW.lift)),
    uDither: 1 / 255,
  };
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

export function headerSkyHeightForWindow(windowHeight: number): number {
  return Math.round(windowHeight * MEMORY_SKY_HEADER_QUARTER) + MEMORY_SKY_TOP_SAFETY;
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

/**
 * Ambient field size for a sky with no moments on it.
 *
 * The memory field is data: one star per day, one dot per memory. A sky that
 * is scenery rather than a readout (the setup hero, whose whole point is that
 * nobody is in it yet) still wants depth, so it gets an unnamed scatter. These
 * stars carry no meaning, never enter the caption count, and are dim points
 * rather than the pink and gold that belong to the two people.
 */
export const MEMORY_SKY_AMBIENT_COUNT = 48;

/**
 * Murmur3's 32-bit finalizer.
 *
 * `hashMomentId` is a rolling string hash, so seeds that differ by one
 * character (`ambient-0`, `ambient-1`) differ by a small amount and their high
 * bits barely move. Reading y off those bits put whole runs of ambient stars
 * in a straight horizontal line. The finalizer avalanches every input bit
 * across the output, so consecutive seeds land anywhere.
 */
function mix32(value: number): number {
  let h = value >>> 0;
  h ^= h >>> 16;
  h = Math.imul(h, 0x85ebca6b);
  h ^= h >>> 13;
  h = Math.imul(h, 0xc2b2ae35);
  h ^= h >>> 16;
  return h >>> 0;
}

/** Stable scatter for ambient star `index`, across the whole field. */
export function ambientStarForIndex(index: number): { xPct: number; yPct: number; size: 3 | 4 } {
  const hash = mix32(hashMomentId(`ambient-${index}`));
  // Nothing smaller than the mid size: a 0.35pt dot is a coin toss at
  // rasterisation time, and a scenery sky cannot afford half its field to
  // vanish. Depth comes from the 3/4 spread instead.
  const size: 3 | 4 = hash % 4 === 0 ? 4 : 3;
  return { xPct: 3 + (hash % 94), yPct: 4 + ((hash >>> 8) % 86), size };
}

/** Ambient stars are fainter than memory stars, and never reach full brightness. */
export function ambientStarOpacity(index: number): number {
  const hash = mix32(hashMomentId(`ambient-opacity-${index}`));
  return 0.14 + ((hash >>> 20) % 7) * 0.035;
}

/** A few ambient stars are tapered sparkles; the rest stay tiny points. */
export function isAmbientSparkle(index: number): boolean {
  return mix32(hashMomentId(`ambient-sparkle-${index}`)) % 9 === 0;
}

/**
 * The sky's lights, so the dusk is lit rather than merely ramped.
 *
 * The gradient runs top to bottom and, on a tall band, read as exactly that: a
 * flat vertical wash. Two wide, very low-alpha radials give the eye somewhere
 * to land and put the sky on a diagonal without either one ever resolving into
 * a visible object.
 */
export type SkyLight = {
  /** Where the light sits, as a fraction of the strip's width and height. */
  x: number;
  y: number;
  /**
   * Radius as a fraction of the strip's height, not its width.
   *
   * A strip sky is clipped at the bottom of its own canvas, so any light still
   * burning there is cut off mid-fall and leaves a hard seam across the band.
   * Measuring the fall-off vertically is what makes it possible to guarantee
   * that a light reaches nothing before the clip line.
   */
  radius: number;
  /** Peak alpha at the centre, before the fall-off to nothing. */
  alpha: number;
  /** How far the light lifts the sky colour toward white. */
  lift: number;
};

/** A cool light high on one side, like the last of the daylight. */
export const MEMORY_SKY_GLOW: SkyLight = {
  x: 0.82,
  y: -0.05,
  radius: 0.9,
  alpha: 0.13,
  lift: 0.28,
};

/** A broader, softer afterglow low on the other side, near the horizon. */
export const MEMORY_SKY_HORIZON_GLOW: SkyLight = {
  x: 0.3,
  y: 0.6,
  radius: 0.34,
  alpha: 0.12,
  lift: 0.34,
};

/** Centre and radius of one of the sky's lights, in canvas pixels. */
export function skyGlowGeometry(
  width: number,
  height: number,
  light: SkyLight = MEMORY_SKY_GLOW,
): { cx: number; cy: number; radius: number } {
  return {
    cx: width * light.x,
    cy: height * light.y,
    radius: height * light.radius,
  };
}

/** A light's colours: the sky's own hue lifted toward white, falling to nothing. */
export function skyGlowColors(
  skyMid: string,
  light: SkyLight = MEMORY_SKY_GLOW,
): [string, string] {
  const lifted = mixHex(skyMid, '#FFFFFF', light.lift);
  return [backgroundAtAlpha(lifted, light.alpha), backgroundAtAlpha(lifted, 0)];
}

/**
 * How long the sky waits between twinkles.
 *
 * The memory field twinkles rarely on purpose: a star arriving is an event,
 * and a busy sky would read as a notification badge. A scenery sky has no such
 * claim on the reader, so its unnamed stars twinkle often enough to feel alive.
 */
export const MEMORY_SKY_AMBIENT_TWINKLE_GAP_MIN = 1200;
export const MEMORY_SKY_AMBIENT_TWINKLE_GAP_MAX = 3000;

/**
 * The first light.
 *
 * A sky with no memories on it opens with one point of light finding its
 * place: it falls, settles, and the unnamed field fades in behind it. One
 * gesture, once, on the one screen whose whole subject is that nobody is in
 * the sky yet. It is the only choreography in the app, so it is also the only
 * thing a reduced-motion reader loses, and they lose it to the same sky with
 * no wait.
 */
export const MEMORY_SKY_FIRST_LIGHT_MS = 1600;
/** Where it comes to rest, as a fraction of the strip. */
export const MEMORY_SKY_FIRST_LIGHT_REST = { x: 0.5, y: 0.34 } as const;
/** How far above its resting place it starts, as a fraction of the strip. */
export const MEMORY_SKY_FIRST_LIGHT_DROP = 0.2;
/** Half-length of the first light's star, and half the side of its canvas. */
export const MEMORY_SKY_FIRST_LIGHT_SIZE = 8;

/**
 * A four-point star centred where you ask. The same taper the field's bright
 * stars are drawn with, so the first light is the brightest star in the sky
 * rather than a new kind of object.
 */
export function sparklePath(cx: number, cy: number, half: number): string {
  const w = half * 0.22;
  return (
    `M ${cx} ${cy - half} ` +
    `Q ${cx + w} ${cy - w} ${cx + half} ${cy} ` +
    `Q ${cx + w} ${cy + w} ${cx} ${cy + half} ` +
    `Q ${cx - w} ${cy + w} ${cx - half} ${cy} ` +
    `Q ${cx - w} ${cy - w} ${cx} ${cy - half} Z`
  );
}

/** The landing, on the frame it lands. Device-only; never throws. */
function landFirstLight() {
  try {
    void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {});
  } catch {
    // Device-only: ignore on web.
  }
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
  travel,
  handover,
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
  /** Camera travel, in pixels. The clouds are nearest, so they move most. */
  travel: number;
  motionAllowed: boolean;
  handover?: { progress: SharedValue<number>; top: number; opacity: number };
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
    transform: [{ translateX: x.value }, { translateY: handover
      ? settlingSkyHeight(handover.progress.value, handover.top, top) - top
      : travel }],
    opacity: handover
      ? settlingSkyHeight(handover.progress.value, handover.opacity, opacity)
      : opacity,
  }));

  return (
    <Animated.View
      testID={testID}
      pointerEvents="none"
      accessible={false}
      style={[styles.cloudLayer, { width, height, top, opacity }, animatedStyle]}
    >
      <Image accessible={false} source={source} contentFit="cover" style={{ width, height }} />
    </Animated.View>
  );
}

// Single bounded twinkle overlay: one star glows at a time, then clears.
// The static field underneath never animates per star.
/** A star's own rhythm: quick to brighten, slow to fade, slow to settle.
 *  Ambience rather than interaction, so it does not use `Motion`. */
const TWINKLE_RISE_MS = 200;
const TWINKLE_FALL_MS = 700;
const TWINKLE_SETTLE_MS = 450;

function TwinkleOverlay({ x, y, color }: { x: number; y: number; color: string }) {
  const opacity = useSharedValue(0);
  const scale = useSharedValue(0.7);

  useEffect(() => {
    opacity.value = withSequence(
      withTiming(1, { duration: TWINKLE_RISE_MS }),
      withTiming(0, { duration: TWINKLE_FALL_MS }),
    );
    scale.value = withSequence(
      withTiming(1, { duration: TWINKLE_SETTLE_MS }),
      withTiming(0.9, { duration: TWINKLE_SETTLE_MS }),
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

function SettlingShader({ source, from, to, progress }: {
  source: SkRuntimeEffect;
  from: DuskUniforms;
  to: DuskUniforms;
  progress: SharedValue<number>;
}) {
  const uniforms = useDerivedValue(() => {
    const blended = blendSkyUniforms(from, to, progress.value);
    blended.uFeather = skyBottomFeather(progress.value);
    return blended;
  });
  return <Shader source={source} uniforms={uniforms} />;
}

function SettlingStars({ progress, distance, source, children }: {
  progress: SharedValue<number>;
  distance: number;
  source: ReactNode;
  children: ReactNode;
}) {
  const memoryOpacity = useDerivedValue(() => Math.min(1, Math.max(0, (progress.value - 0.45) / 0.55)));
  const ambientOpacity = useDerivedValue(() => 1 - memoryOpacity.value);
  const travel = useDerivedValue(() => [{ translateY: settlingSkyHeight(progress.value, 0, -distance * 0.12) }]);
  return <>
    <Group opacity={memoryOpacity}>{children}</Group>
    <Group opacity={ambientOpacity} transform={travel}>{source}</Group>
  </>;
}

export function MemorySky({
  moments,
  daysTogether,
  startDate,
  focused = true,
  now,
  compact = false,
  immersive = false,
  header = false,
  ambient = false,
  opening = false,
  peak = COMPACT_SKY_PEAK,
  camera = 0,
  glow = null,
  presentationHeight,
  handoverProgress,
  onSceneLayout,
  onPress,
}: {
  moments: SkyItem[];
  daysTogether?: number | null;
  startDate?: string | null;
  focused?: boolean;
  now?: Date;
  compact?: boolean;
  /** Full Us sky height with a decorative, absolute layout. */
  immersive?: boolean;
  /** A working screen's header band: compact, then shorter again. */
  header?: boolean;
  /**
   * Give a sky with nothing of its own on it an unnamed ambient field, so a
   * scenery sky (the setup hero, whose point is that nobody is in it yet)
   * still has depth. Only takes effect while the sky is empty, and clears
   * itself the moment a first memory lands. The stars are dim, enter no
   * caption, and join the twinkle pool.
   */
  ambient?: boolean;
  /**
   * Open a sky with no memories on it with the first light: one point falling
   * into place, the unnamed field fading in behind it. Runs once, on mount,
   * and plays instantly under reduced motion.
   */
  opening?: boolean;
  /**
   * Where the dusk turns, as a fraction of the strip. The band's dusk turns at
   * 0.42; a sky that has opened up and taken the words inside it passes a
   * lower turn so it stays dark behind them.
   */
  peak?: number;
  /**
   * How far the frame has pushed into the sky, 0 to 1.
   *
   * The field is not one flat picture: each depth travels a different
   * distance as the camera moves, which is the whole reason a view of a star
   * field reads as a place rather than as a texture. Far crawls, near sweeps,
   * clouds go first because they are nearest.
   */
  camera?: number;
  /**
   * A tap anywhere on the sky. The whole field is one control rather than a
   * grid of tiny targets: stars are sub-pixel, so aiming at one is not
   * possible, and a miss that opens something is a far smaller failure than
   * a tap that opens nothing.
   */
  onPress?: () => void;
  /** What the Us sky holds its breath for. Us-only; compact never glows. */
  glow?: SkyGlowKind | null;
  presentationHeight?: number;
  /** The setup's sky settles into this renderer, which stays mounted at home. */
  handoverProgress?: SharedValue<number>;
  /** The loaded canvas is laid out. Not a GPU-paint acknowledgement. */
  onSceneLayout?: () => void;
}) {
  const { width: windowWidth, height: windowHeight } = useWindowDimensions();
  const sceneSize = useSharedValue({ width: 0, height: 0 });
  useAnimatedReaction(
    () => sceneSize.value.width > 0 && sceneSize.value.height > 0,
    (laidOut, previous) => {
      if (laidOut && !previous && onSceneLayout) runOnJS(onSceneLayout)();
    },
    [onSceneLayout],
  );
  const insets = useSafeAreaInsets();
  const compactLayout = compact && !immersive;
  const background = useThemeColor({}, 'background');
  const muted = useThemeColor({}, 'muted');
  const isDark = isDarkBackground(background);
  const skyTop = isDark ? DARK_SKY_TOP : LIGHT_SKY_TOP;
  const skyMid = isDark ? DARK_SKY_MID : LIGHT_SKY_MID;
  // Living-sky aura (Us full sky only): the dusk stops breathe with the
  // time of day — dawn gold, dusk ember, night deepened, day canonical —
  // and run a few degrees warmer/cooler for what is waiting. Static per
  // render (Us refreshes `now` on focus/foreground); the drift and twinkle
  // carry the continuous motion.
  const auraPhase = useMemo(
    () => dayPhaseForHour((now ?? new Date()).getHours()),
    [now],
  );
  const [moodTop, moodMid] = useMemo(
    () =>
      immersive
        ? moodSkyStops(skyTop, skyMid, auraPhase, glow ?? null)
        : [skyTop, skyMid] as [string, string],
    [immersive, skyTop, skyMid, auraPhase, glow],
  );
  const reduceMotion = useReducedMotion();
  const systemReduce = useSystemReduceMotion();
  const appActive = useAppActive();
  const docVisible = useDocumentVisible();
  const motionAllowed =
    !reduceMotion && !systemReduce && appActive && docVisible && focused;

  const skyFraction = header
    ? MEMORY_SKY_HEADER_QUARTER
    : compactLayout
      ? MEMORY_SKY_COMPACT_QUARTER
      : MEMORY_SKY_QUARTER;
  const skyHeight = presentationHeight ??
    (Math.round(windowHeight * skyFraction) + MEMORY_SKY_TOP_SAFETY);
  const canvasHeight = handoverProgress ? windowHeight : skyHeight;
  const viewportStyle = useAnimatedStyle(() => handoverProgress ? {
    height: settlingSkyHeight(handoverProgress.value, windowHeight, skyHeight),
    overflow: 'hidden',
  } : {});
  const emptyStarStyle = useAnimatedStyle(() => handoverProgress ? {
    top: skyHeight / 2,
    opacity: Math.min(1, Math.max(0, (handoverProgress.value - 0.45) / 0.55)),
  } : {});
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
  const stripTop = compactLayout
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
  const compactVisibleBottomSy = compactLayout
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
            opacity: compactLayout
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
        opacity: compactLayout
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
    // Ambient field: scenery for a sky that has nothing of its own on it yet.
    // Gated on an empty field, so an unnamed scatter can never be mistaken for
    // someone's memories, and so the sky clears its ambience the moment the
    // first memory lands.
    if (ambient && !field && visible.length === 0) {
      for (let index = 0; index < MEMORY_SKY_AMBIENT_COUNT; index += 1) {
        const layout = ambientStarForIndex(index);
        const p = { cx: (layout.xPct / 100) * canvasW, cy: (layout.yPct / 100) * canvasH };
        if (
          p.cx < -0.02 * canvasW ||
          p.cx > 1.02 * canvasW ||
          p.cy < -0.02 * canvasH ||
          p.cy > 1.02 * canvasH
        ) {
          continue;
        }
        const key = `ambient-${index}`;
        const opacity = ambientStarOpacity(index);
        const entry: PlottedStar = {
          key,
          cx: p.cx,
          cy: p.cy,
          size: layout.size,
          r: starRadiusForZoom(layout.size, 1),
          sparkleR: sparkleHalfLengthForZoom(layout.size, 1),
          opacity: compactLayout
            ? fadeCompactStarOpacity(opacity, layout.yPct / 100, compactVisibleBottomSy)
            : fadeAboveQuestion(opacity, layout.yPct / 100),
          color: DAY_SKY_STAR_DIM,
          bright: isAmbientSparkle(index),
          rotationDeg: sparkleRotationDeg(key),
        };
        if (layout.size === 3) {
          out.mid.push(entry);
        } else {
          out.near.push(entry);
        }
      }
    }
    return out;
  }, [ambient, field, buckets, zoom, visible, compactLayout, compactVisibleBottomSy]);

  const starByKey = useMemo(() => {
    const map = new Map<string, PlottedStar>();
    for (const star of [...plotted.far, ...plotted.mid, ...plotted.near]) {
      map.set(star.key, star);
    }
    return map;
  }, [plotted]);

  const twinkleIds = useMemo(() => {
    if (!compactLayout) {
      return [...starByKey.keys()];
    }
    return [...starByKey.entries()]
      .filter(([, star]) => isCompactTwinkleEligible(star.opacity))
      .map(([key]) => key);
  }, [starByKey, compactLayout]);

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
      const gapMin = ambient ? MEMORY_SKY_AMBIENT_TWINKLE_GAP_MIN : MEMORY_SKY_TWINKLE_GAP_MIN;
      const gapMax = ambient ? MEMORY_SKY_AMBIENT_TWINKLE_GAP_MAX : MEMORY_SKY_TWINKLE_GAP_MAX;
      const gap = gapMin + Math.random() * (gapMax - gapMin);
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
  }, [ambient, motionAllowed, twinkleIds, newestKey, count]);


  const twinkleStar = twinkleKey ? (starByKey.get(twinkleKey) ?? null) : null;
  const twinkleAttr = (
    twinkleStar ? { 'data-star-key': twinkleStar.key } : {}
  ) as unknown as Record<string, string>;
  // Us strip bleeds past the content padding on both sides (left/right -16
  // in the style below), so its gradient canvas must cover the strip — a
  // window-wide canvas anchored at the strip's left edge stops 16pt short
  // of the right edge and leaves a dark seam. Compact strips are exactly
  // window-wide, so the width is unchanged there.
  const skyCanvasW = compactLayout ? windowWidth : windowWidth + Spacing[16] * 2;
  const scaleX = skyCanvasW / MEMORY_SKY_CANVAS_W;
  // Compact keeps the approved star shapes (uniform scale, lower half clips
  // via overflow hidden) instead of squashing the field vertically.
  const scaleY = compactLayout ? scaleX : skyHeight / MEMORY_SKY_CANVAS_H;
  // Veil is the full-size sky's technique (flat page under it). The compact
  // strip must NOT use it: it blends to transparent through the gradient.
  const featherHeight = Math.round(skyHeight * MEMORY_SKY_FEATHER_FRACTION);
  const featherColors = useMemo(() => featherVeilColors(background), [background]);
  const featherPositions = [...MEMORY_SKY_FEATHER_POSITIONS];
  // Compact main gradient fades to same-hue transparent exactly at the
  // visible strip bottom (skyHeight); Us keeps the opaque background melt.
  const skyGradientColors = compactLayout
    ? compactSkyGradientColors(skyTop, skyMid, background, peak)
    : [moodTop, moodMid, background];
  const skyGradientPositions = compactLayout
    ? compactSkyGradientPositions(peak)
    : [0, 0.55, 1];
  // The sky's two lights: one cool light high on a side, one broad afterglow
  // near the horizon. Drawn over the gradient, under the stars, so the dusk
  // stops reading as a single flat ramp.
  const glowGeometry = useMemo(
    () => skyGlowGeometry(skyCanvasW, skyHeight),
    [skyCanvasW, skyHeight],
  );
  const glowColors = useMemo(() => skyGlowColors(skyMid), [skyMid]);
  // The fallback path is told the same horizon the shader is.
  const horizonLight = useMemo(() => horizonLightFor(peak), [peak]);
  const horizonGeometry = useMemo(
    () => skyGlowGeometry(skyCanvasW, skyHeight, horizonLight),
    [skyCanvasW, skyHeight, horizonLight],
  );
  const horizonColors = useMemo(
    () => skyGlowColors(skyMid, horizonLight),
    [skyMid, horizonLight],
  );
  // The shader paints the compact sky; the stop-ramp above stays as the
  // fallback for any platform without runtime effects.
  const duskEffect = compactLayout ? duskEffectOnce() : null;
  const duskUniforms = useMemo(
    () =>
      duskSkyUniforms({
        width: skyCanvasW,
        height: skyHeight,
        skyTop,
        skyMid,
        background,
        peak,
      }),
    [skyCanvasW, skyHeight, skyTop, skyMid, background, peak],
  );
  const sourceDuskUniforms = useMemo(() => duskSkyUniforms({
    width: skyCanvasW,
    height: canvasHeight,
    skyTop,
    skyMid,
    background,
    peak: SETUP_SKY_PEAK,
  }), [skyCanvasW, canvasHeight, skyTop, skyMid, background]);
  const sourceStars = useMemo<PlottedStar[]>(() => handoverProgress
    ? Array.from({ length: MEMORY_SKY_AMBIENT_COUNT }, (_, index) => {
      const layout = ambientStarForIndex(index);
      const key = `ambient-${index}`;
      return {
        key,
        cx: layout.xPct / 100 * MEMORY_SKY_CANVAS_W,
        cy: layout.yPct / 100 * MEMORY_SKY_CANVAS_H,
        size: layout.size,
        r: starRadiusForZoom(layout.size, 1),
        sparkleR: sparkleHalfLengthForZoom(layout.size, 1),
        opacity: fadeCompactStarOpacity(ambientStarOpacity(index), layout.yPct / 100,
          Math.min(1, windowHeight / (MEMORY_SKY_CANVAS_H * scaleX))),
        color: DAY_SKY_STAR_DIM,
        bright: isAmbientSparkle(index),
        rotationDeg: sparkleRotationDeg(key),
      };
    }) : [], [handoverProgress, windowHeight, scaleX]);

  // Depth, as travel: the same camera move, read at four distances.
  const travel = Math.min(1, Math.max(0, camera)) * skyHeight;
  // Kept modest: a taller strip means the same factors travel further, and a
  // camera that empties the sky of stars is a camera that undoes the night.
  const farTravel = -travel * 0.05;
  const midTravel = -travel * 0.13;
  const nearTravel = -travel * 0.24;
  const cloudTravel = -travel * 0.34;

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
          const radians = (star.rotationDeg * Math.PI) / 180;
          const d = sparklePath(cx, cy, R);
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

  // The sky's own reveal: the field and the dusk come in together. The first
  // light that used to fall here now lives with the screen that choreographs
  // it, because it has to be able to reach the horizon and the second light.
  const settle = useSharedValue(opening ? 0 : 1);
  useEffect(() => {
    if (!opening || reduceMotion) {
      settle.value = 1;
      return;
    }
    settle.value = 0;
    settle.value = withTiming(
      1,
      { duration: MEMORY_SKY_FIRST_LIGHT_MS, easing: Easing.bezier(0.16, 1, 0.3, 1) },
      (finished) => {
        if (finished) {
          runOnJS(landFirstLight)();
        }
      },
    );
    return () => {
      cancelAnimation(settle);
    };
  }, [opening, reduceMotion, settle]);

  const fieldStyle = useAnimatedStyle(() => ({
    opacity: Math.max(0, Math.min(1, (settle.value - 0.45) / 0.55)),
  }));

  const starBuckets = (
    <>
      <Group transform={[{ translateY: farTravel }]}>
        {renderBucket(plotted.far)}
      </Group>
      <Group transform={[{ translateY: midTravel }]}>
        {renderBucket(plotted.mid)}
      </Group>
      <Group transform={[{ translateY: nearTravel }]}>
        {renderBucket(plotted.near)}
      </Group>
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
  const cloudWidth = compactLayout
    ? Math.round(cloudWidthFull * MEMORY_SKY_COMPACT_CLOUD_SCALE)
    : cloudWidthFull;
  const cloudHeight = compactLayout
    ? Math.round(cloudWidth * MEMORY_SKY_CLOUD_ASPECT)
    : cloudHeightFull;
  const cloudBTop = compactLayout ? MEMORY_SKY_COMPACT_CLOUD_B_TOP : -24;
  const cloudATop = compactLayout
    ? skyHeight - cloudHeight - MEMORY_SKY_COMPACT_CLOUD_BOTTOM_CLEARANCE
    : skyHeight - cloudHeightFull + 28;
  const wispWidth = Math.round(cloudWidth * MEMORY_SKY_AMBIENT_CLOUD_C_SCALE);
  const wispHeight = Math.round(wispWidth * MEMORY_SKY_CLOUD_ASPECT);
  /** A bank's top, kept from hanging past the faded bottom of the strip. */
  const bankTop = (fraction: number, height: number) =>
    Math.min((handoverProgress ? windowHeight : skyHeight) * fraction,
      (handoverProgress ? windowHeight : skyHeight) - height - MEMORY_SKY_COMPACT_CLOUD_BOTTOM_CLEARANCE);

  type CloudLayerSpec = {
    testID: string;
    source: number | string;
    width: number;
    height: number;
    top: number;
    opacity: number;
    amplitudePx: number;
    durationMs: number;
    reverse: boolean;
  };

  const cloudLayers: CloudLayerSpec[] = ambient || handoverProgress
    ? [
        { testID: 'memory-sky-cloud-b', source: cloudBBank, width: cloudWidth, height: cloudHeight, top: cloudBTop, opacity: MEMORY_SKY_AMBIENT_CLOUD_B_OPACITY, amplitudePx: MEMORY_SKY_CLOUD_B.amplitudePx, durationMs: MEMORY_SKY_CLOUD_B.durationMs, reverse: true },
        { testID: 'memory-sky-cloud-a', source: cloudABank, width: cloudWidth, height: cloudHeight, top: bankTop(MEMORY_SKY_AMBIENT_CLOUD_A_TOP, cloudHeight), opacity: MEMORY_SKY_AMBIENT_CLOUD_A_OPACITY, amplitudePx: MEMORY_SKY_CLOUD_A.amplitudePx, durationMs: MEMORY_SKY_CLOUD_A.durationMs, reverse: false },
        { testID: 'memory-sky-cloud-c', source: cloudBBank, width: wispWidth, height: wispHeight, top: bankTop(MEMORY_SKY_AMBIENT_CLOUD_C_TOP, wispHeight), opacity: MEMORY_SKY_AMBIENT_CLOUD_C_OPACITY, amplitudePx: MEMORY_SKY_CLOUD_B.amplitudePx, durationMs: MEMORY_SKY_CLOUD_B.durationMs, reverse: true },
      ]
    : [
        { testID: 'memory-sky-cloud-b', source: cloudBBank, width: cloudWidth, height: cloudHeight, top: cloudBTop, opacity: compactLayout ? MEMORY_SKY_COMPACT_CLOUD_B_OPACITY : 0.45, amplitudePx: MEMORY_SKY_CLOUD_B.amplitudePx, durationMs: MEMORY_SKY_CLOUD_B.durationMs, reverse: true },
        { testID: 'memory-sky-cloud-a', source: cloudABank, width: cloudWidth, height: cloudHeight, top: cloudATop, opacity: compactLayout ? MEMORY_SKY_COMPACT_CLOUD_A_OPACITY : 0.55, amplitudePx: MEMORY_SKY_CLOUD_A.amplitudePx, durationMs: MEMORY_SKY_CLOUD_A.durationMs, reverse: false },
      ];

  return (
    <Animated.View
      testID="memory-sky"
      pointerEvents={onPress ? 'auto' : 'none'}
      accessible={onPress ? true : false}
      accessibilityElementsHidden={onPress ? undefined : true}
      importantForAccessibility={onPress ? 'yes' : 'no-hide-descendants'}
      aria-hidden={onPress ? undefined : true}
      onStartShouldSetResponder={onPress ? () => true : undefined}
      onResponderRelease={onPress}
      style={
        compactLayout
          ? [styles.rootCompact, { height: canvasHeight }, viewportStyle]
          : immersive
            ? [styles.rootImmersive, { height: Math.max(0, skyHeight + stripTop) }]
            : styles.root
      }
    >
      <View
        testID="memory-sky-strip"
        pointerEvents="none"
        accessible={false}
        style={[
          styles.sky,
          compactLayout
            ? {
                top: 0,
                left: 0,
                right: 0,
                height: canvasHeight,
              }
            : {
                top: stripTop,
                left: -Spacing[16],
                right: -Spacing[16],
                height: skyHeight,
              },
        ]}
      >
        {/*
          Everything the sky is made of goes inside one view, so the opening
          can bring the whole dusk in at once and the first light can arrive
          before it. Animating Skia's own opacity would have saved the wrapper,
          but that animation only runs where Skia's Reanimated recorder is
          active, and a sky that never arrives is worse than a wrapper view.
        */}
        <Animated.View
          testID="memory-sky-dusk"
          pointerEvents="none"
          accessible={false}
          style={[StyleSheet.absoluteFill, opening ? fieldStyle : undefined]}
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
                  <Canvas onSize={onSceneLayout ? sceneSize : undefined} style={{ width: skyCanvasW, height: canvasHeight }}>
                    {compactLayout && duskEffect ? (
                      <Rect x={0} y={0} width={skyCanvasW} height={canvasHeight}>
                        {handoverProgress
                          ? <SettlingShader source={duskEffect} from={sourceDuskUniforms} to={duskUniforms} progress={handoverProgress} />
                          : <Shader source={duskEffect} uniforms={duskUniforms} />}
                      </Rect>
                    ) : (
                      <>
                        <Rect x={0} y={0} width={skyCanvasW} height={skyHeight}>
                          <LinearGradient
                            start={vec(0, 0)}
                            end={vec(0, skyHeight)}
                            colors={skyGradientColors}
                            positions={skyGradientPositions}
                          />
                        </Rect>
                        <Rect x={0} y={0} width={skyCanvasW} height={skyHeight}>
                          <RadialGradient
                            c={vec(glowGeometry.cx, glowGeometry.cy)}
                            r={glowGeometry.radius}
                            colors={glowColors}
                            positions={[0, 1]}
                          />
                        </Rect>
                        <Rect x={0} y={0} width={skyCanvasW} height={skyHeight}>
                          <RadialGradient
                            c={vec(horizonGeometry.cx, horizonGeometry.cy)}
                            r={horizonGeometry.radius}
                            colors={horizonColors}
                            positions={[0, 1]}
                          />
                        </Rect>
                      </>
                    )}
                    {handoverProgress ? (
                      <SettlingStars progress={handoverProgress} distance={windowHeight - skyHeight} source={renderBucket(sourceStars)}>
                        {starBuckets}
                      </SettlingStars>
                    ) : starBuckets}
                  </Canvas>
                ) : (
                  <View style={{ width: skyCanvasW, height: skyHeight }} />
                )
              }
            </SkiaReady>
          </View>
          {cloudLayers.map((layer) => (
            <CloudLayer
              key={layer.testID}
              testID={layer.testID}
              source={layer.source}
              width={layer.width}
              height={layer.height}
              top={handoverProgress ? (layer.testID === 'memory-sky-cloud-b' ? cloudBTop : cloudATop) : layer.top}
              opacity={handoverProgress
                ? (layer.testID === 'memory-sky-cloud-b' ? MEMORY_SKY_COMPACT_CLOUD_B_OPACITY
                  : layer.testID === 'memory-sky-cloud-a' ? MEMORY_SKY_COMPACT_CLOUD_A_OPACITY : 0)
                : layer.opacity}
              amplitudePx={layer.amplitudePx}
              durationMs={layer.durationMs}
              reverse={layer.reverse}
              motionAllowed={motionAllowed}
              travel={cloudTravel}
              handover={handoverProgress ? { progress: handoverProgress, top: layer.top, opacity: layer.opacity } : undefined}
            />
          ))}
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
          {compactLayout ? null : (
            <View
              testID="memory-sky-feather"
              pointerEvents="none"
              accessible={false}
              style={{ position: 'absolute', left: 0, right: 0, bottom: 0, height: featherHeight }}
            >
              <SkiaReady>
                {(ready) =>
                  ready ? (
                    <Canvas style={{ width: skyCanvasW, height: featherHeight }}>
                      <Rect x={0} y={0} width={skyCanvasW} height={featherHeight}>
                        <LinearGradient
                          start={vec(0, 0)}
                          end={vec(0, featherHeight)}
                          colors={featherColors}
                          positions={featherPositions}
                        />
                      </Rect>
                    </Canvas>
                  ) : (
                    <View style={{ width: skyCanvasW, height: featherHeight }} />
                  )
                }
              </SkiaReady>
            </View>
          )}
        </Animated.View>
        {!isDayMode && visible.length === 0 && !ambient ? (
          <Animated.View
            testID="memory-sky-star-empty"
            pointerEvents="none"
            accessible={false}
            style={[styles.emptyStar, { backgroundColor: muted }, emptyStarStyle]}
          />
        ) : null}
      </View>
      {compactLayout || immersive ? null : (
      <ThemedText
        type="caption"
        style={[styles.caption, { color: muted, marginTop: captionMarginTop }]}
      >
        {caption}
      </ThemedText>
      )}
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  root: {},
  rootImmersive: {
    flexShrink: 0,
  },
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

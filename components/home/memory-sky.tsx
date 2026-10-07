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
  Oval,
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
  useFrameCallback,
  useReducedMotion,
  useSharedValue,
  withRepeat,
  withSequence,
  withTiming,
  type DerivedValue,
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
  PHOTO_SKY_DEPTH,
  PHOTO_SKY_HAZE_COOL,
  PHOTO_SKY_HAZE_WARM,
  PHOTO_SKY_STAR_COOL,
  PHOTO_SKY_STAR_WARM,
  SEA_FOAM,
  SEA_FOAM_DARK,
  SEA_SAND_DARK_DEEP,
  SEA_SAND_DARK_TOP,
  SEA_SAND_LIGHT_DEEP,
  SEA_SAND_LIGHT_TOP,
  SEA_SHELL_PALETTE,
  SEA_WATER_DARK_DEEP,
  SEA_WATER_DARK_SHALLOW,
  SEA_WATER_LIGHT_DEEP,
  SEA_WATER_LIGHT_SHALLOW,
  SEA_WET_DARK,
  SEA_WET_LIGHT,
  isBeachTheme,
  mixHex,
  skyStopsForTheme,
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
import { buildPhotoSkyField } from '@/features/home/photo-sky';
import { photoSkyGlyphScale, photoSkyPlane, type PhotoSkyCamera, type SkyViewport } from '@/features/home/photo-sky-camera';
import { formatDaySkyCaption } from '@/features/home/day-sky';
import type { SkyItem } from '@/features/home/day-sky';
import { useAoiTheme } from '@/features/theme/theme-context';
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
 * The beach, as a shader.
 *
 * Sand on top, sea on the bottom, and both are *procedural*: fbm noise for
 * dune shading and sand grain, stretched noise for wave relief, a foaming
 * crest at the waterline, and a sun-glitter path on the water. Nothing here
 * is a gradient band — every tone is mixed from noise, which is what makes it
 * read as a surface rather than a stripe.
 *
 * Static on purpose: no time uniform, so it costs nothing and never asks the
 * bridge to animate a canvas prop.
 */
export const MEMORY_SKY_BEACH_SKSL = `
uniform float2 uSize;
uniform float2 uPan;
uniform float uScale;
uniform float uShore;
uniform float4 uSandLight;
uniform float4 uSandDeep;
uniform float4 uWet;
uniform float4 uSeaShallow;
uniform float4 uSeaDeep;
uniform float4 uFoam;
uniform float2 uSun;
uniform float uFadeFrom;
uniform float uTime;
uniform float uDither;

float hash21(float2 p) {
  p = fract(p * float2(123.34, 456.21));
  p += dot(p, p + 45.32);
  return fract(p.x * p.y);
}

float vnoise(float2 p) {
  float2 i = floor(p);
  float2 f = fract(p);
  float2 u = f * f * (3.0 - 2.0 * f);
  float a = hash21(i);
  float b = hash21(i + float2(1.0, 0.0));
  float c = hash21(i + float2(0.0, 1.0));
  float d = hash21(i + float2(1.0, 1.0));
  return mix(mix(a, b, u.x), mix(c, d, u.x), u.y);
}

float fbm(float2 p) {
  float v = 0.0;
  float a = 0.5;
  for (int i = 0; i < 5; i++) {
    v += a * vnoise(p);
    p *= 2.03;
    a *= 0.5;
  }
  return v;
}

// Caustics: the bright web of refracted sunlight on the seabed. Summed,
// time-evolved light rays focusing — the standard real-time approximation.
float caustics(float2 uv, float time) {
  float2 p = uv * 6.28318 - 250.0;
  float2 i = p;
  float c = 1.0;
  float inten = 0.005;
  for (int n = 0; n < 3; n++) {
    float tn = time * (1.0 - (3.5 / float(n + 1)));
    i = p + float2(cos(tn - i.x) + sin(tn + i.y), sin(tn - i.y) + cos(tn + i.x));
    c += 1.0 / length(float2(p.x / (sin(i.x + tn) / inten), p.y / (cos(i.y + tn) / inten)));
  }
  c /= 3.0;
  c = 1.17 - pow(c, 1.4);
  return pow(abs(c), 8.0);
}

half4 main(float2 xy) {
  // Scene space: the shore is one flat plane the camera pans and zooms, so
  // the surface is sampled at the camera's transformed coordinate. Shells
  // use the same plane, which is what keeps them locked to the sand.
  float2 scene = (xy - uPan) / max(uScale, 0.0001);
  float v = scene.y / uSize.y;
  float hasShore = uShore > 0.001 ? 1.0 : 0.0;
  float t = uTime * 0.001;

  // ---- The ground: sand, everywhere. Water is a layer over it. ----
  float dune = fbm(scene * 0.016);
  float grain = vnoise(scene * 1.8);
  float ripple = sin(scene.y * 0.5 + fbm(scene * 0.03) * 6.0) * 0.5 + 0.5;
  float3 sand = mix(uSandDeep.rgb, uSandLight.rgb,
    clamp(dune * 0.7 + grain * 0.2 + ripple * 0.1, 0.0, 1.0));
  sand *= 0.94 + grain * 0.12;

  // ---- The waterline: meanders, and laps up the sand and back. ----
  float lap = sin(t * 0.5) * 0.5 * 0.06 + sin(t * 1.13 + 1.7) * 0.5 * 0.025;
  float meander = (fbm(float2(scene.x * 0.008, 3.0)) - 0.5) * 0.10
                + (fbm(float2(scene.x * 0.022, 9.0)) - 0.5) * 0.03;
  float shoreLine = uShore + (meander + lap) * hasShore;

  // ---- Depth: 0 at the waterline, deepening into the sea. ----
  float depth;
  float waterAmount;
  float3 ground = sand;
  if (hasShore > 0.5) {
    depth = smoothstep(shoreLine, shoreLine + 0.42, v);
    waterAmount = smoothstep(shoreLine - 0.006, shoreLine + 0.012, v);
  } else {
    // A band strip is water only: no sand under it.
    depth = 0.45 + v * 0.35;
    waterAmount = 1.0;
    ground = mix(uSeaShallow.rgb, uSeaDeep.rgb, 0.3);
  }

  // ---- Refraction: the rippling surface bends the view of the seabed, so
  //      the sand you see through the water wobbles. ----
  float2 wn = float2(
    fbm(float2(scene.x * 0.06, scene.y * 0.10 + t * 0.30)) - 0.5,
    fbm(float2(scene.x * 0.05 + 7.0, scene.y * 0.09 + t * 0.35)) - 0.5
  );
  float2 refr = wn * 0.055 * depth;
  ground *= 0.96 + vnoise((scene + refr) * 1.8) * 0.09;

  // ---- The body of water: absorbs toward its own colour with depth. ----
  float3 waterCol = mix(uSeaShallow.rgb, uSeaDeep.rgb, clamp(depth, 0.0, 1.0));
  float3 water = mix(ground, waterCol, clamp(depth * 1.2, 0.0, 1.0));

  // ---- Caustics: refracted sunlight webbing the seabed. ----
  float caust = caustics(scene * 0.02, t * 0.4);
  water += uFoam.rgb * caust * 0.20 * (1.0 - depth * 0.6);

  // ---- A soft sunlit patch on the surface. ----
  water += uFoam.rgb * exp(-pow(distance(scene, uSun) / (uSize.x * 0.5), 2.0)) * 0.06;

  float3 col = mix(sand, water, waterAmount);

  // ---- Wet sand darkening the strip above the waterline. ----
  if (hasShore > 0.5) {
    float wet = smoothstep(shoreLine - 0.18, shoreLine, v) * (1.0 - waterAmount);
    col = mix(col, uWet.rgb, wet * 0.5);
  }

  // ---- Foam: a thin, broken line at the waterline, swash washing past it. ----
  if (hasShore > 0.5) {
    float edge = v - shoreLine;
    float band = smoothstep(-0.03, 0.015, edge) * (1.0 - smoothstep(0.02, 0.09, edge));
    float foamTex = smoothstep(0.35, 0.92, fbm(float2(scene.x * 0.05, scene.y * 0.22 + t * 0.4) + 7.0));
    float swash = smoothstep(0.60, 0.95, fbm(float2(scene.x * 0.03, scene.y * 0.10 + t * 0.5) + 21.0))
                * (1.0 - smoothstep(0.01, 0.12, edge)) * step(0.0, edge);
    col = mix(col, uFoam.rgb, clamp(band * (0.25 + foamTex * 0.35) + swash * 0.25, 0.0, 1.0));
  }

  // A band strip dissolves into the page instead of ending on a hard edge.
  float alpha = 1.0 - smoothstep(uFadeFrom, 1.0, v);
  col += (hash21(scene) - 0.5) * uDither;
  return half4(half3(clamp(col, 0.0, 1.0) * alpha), half(alpha));
}
`;

let beachEffect: SkRuntimeEffect | null = null;

/** Compiled once per launch; null (and stays null) without runtime effects. */
function beachEffectOnce(): SkRuntimeEffect | null {
  if (beachEffect) {
    return beachEffect;
  }
  try {
    beachEffect = Skia?.RuntimeEffect?.Make(MEMORY_SKY_BEACH_SKSL) ?? null;
  } catch (error) {
    beachEffect = null;
    // Dev-only: surface the compiler's own message so a shader that silently
    // falls back can be diagnosed from the device instead of guessed at.
    if (__DEV__) {
      (globalThis as unknown as Record<string, unknown>).__aoiBeachShaderError =
        String(error);
    }
  }
  return beachEffect;
}

/** Where the sand ends and the sea begins, as a fraction of the strip. Sand
 *  dominates (the view is looking down at the shore), with the sea a body
 *  across the lower part of the frame. */
export const BEACH_SHORE_FRACTION = 0.58;

/** The beach shader's uniform payload for one strip. Pure. */
export function beachSkyUniforms(options: {
  width: number;
  height: number;
  shore?: number;
  sandLight: string;
  sandDeep: string;
  wet: string;
  seaShallow: string;
  seaDeep: string;
  foam?: string;
  /** Sun x as a fraction of the width. */
  sunX?: number;
  /**
   * Fraction of the strip below which alpha eases to nothing. 1 leaves the
   * surface opaque (a full scene); a band strip passes a value so the water
   * dissolves into the page instead of ending on a hard edge.
   */
  fadeFrom?: number;
  /** Scene-space pan the surface is sampled at (the flat-plane camera). */
  pan?: [number, number];
  /** Scene-space scale the surface is sampled at. */
  scale?: number;
  /** Milliseconds; drives the lapping shore and travelling water. */
  time?: number;
}): DuskUniforms {
  const shore = Math.min(0.9, Math.max(0, options.shore ?? BEACH_SHORE_FRACTION));
  const sunX = Math.min(1, Math.max(0, options.sunX ?? 0.7));
  const fadeFrom = Math.min(1, Math.max(0, options.fadeFrom ?? 1));
  const pan = options.pan ?? [0, 0];
  const scale = options.scale ?? 1;
  return {
    uSize: [options.width, options.height],
    uPan: [pan[0], pan[1]],
    uScale: scale,
    uTime: options.time ?? 0,
    uShore: shore,
    uSandLight: colorToRgba(options.sandLight),
    uSandDeep: colorToRgba(options.sandDeep),
    uWet: colorToRgba(options.wet),
    uSeaShallow: colorToRgba(options.seaShallow),
    uSeaDeep: colorToRgba(options.seaDeep),
    uFoam: colorToRgba(options.foam ?? SEA_FOAM),
    uSun: [options.width * sunX, options.height * shore],
    uFadeFrom: fadeFrom,
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
  SEA_SAND_DARK_DEEP,
  SEA_SAND_DARK_TOP,
  SEA_SAND_LIGHT_DEEP,
  SEA_SAND_LIGHT_TOP,
  SEA_SHELL_BLUSH,
  SEA_SHELL_BLUSH_RIB,
  SEA_SHELL_PALETTE,
  SEA_SHELL_PEARL,
  SEA_SHELL_PEARL_RIB,
  THEME_SKY_RAMPS,
  isBeachTheme,
  skyStopsForTheme,
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
  haloRadius?: number;
  haloOpacity?: number;
  /** Whose memory this is; the beach tints their shell pearl or blush. */
  role?: 'you' | 'partner';
};

/**
 * How many shells a beach band holds at most. Bands are decorative
 * backdrops, not censuses: past this many marks the strip turns to static,
 * so the field is sampled and the caption keeps the true count. The full sky
 * never samples.
 */
export const BEACH_BAND_CREATURE_MAX = 12;
/**
 * The header band is the shortest of all (it sits behind a working screen's
 * title), so it carries fewer shells again than the compact strip.
 */
export const BEACH_HEADER_CREATURE_MAX = 8;

/**
 * Stride sampling for day-mode beach bands: keep every nth day so the
 * school spans the whole relationship instead of bunching at one end.
 */
export function beachDayStride(totalDays: number, max: number = BEACH_BAND_CREATURE_MAX): number {
  return Math.max(1, Math.ceil(totalDays / Math.max(1, max)));
}

/**
 * Rank sampling for memory-mode beach bands: keep the best-ranked ids by
 * hash, so the survivors spread across the strip (positions are
 * hash-scattered) instead of clustering. Stable forever per id set.
 */
export function beachMomentKeep(ids: string[], max: number = BEACH_BAND_CREATURE_MAX): Set<string> {
  if (ids.length <= max) {
    return new Set(ids);
  }
  const rank = (id: string) => hashMomentId(`${id}-beach`);
  return new Set(
    [...ids].sort((a, b) => rank(a) - rank(b)).slice(0, max),
  );
}

/**
 * Where the sand shelf begins, as a fraction of the drawn strip, for the
 * plain strip and the full sky. Immersive (the Us photo field) is
 * water-dominant: the lagoon fills most of the frame and the sand is a shelf
 * at the bottom, so the field is water you look into, not a flat sand wall.
 */
export const BEACH_SAND_TOP = 0.52;
export const BEACH_SHORE_TOP = 0.8;

/**
 * Where a shell sits on the beach: the sand runs across the top of the strip
 * (looking down at the shore), so marks map onto it, keeping each field's own
 * spread.
 */
export function beachShellY(rawFraction: number): number {
  const t = Math.min(1, Math.max(0, rawFraction));
  return 0.05 + t * (0.52 - 0.05);
}

/**
 * The foam edge lapping the sand: a filled wave along `y`, screen px.
 * M/L/Q/Z verbs only, like every other path here.
 */
export function foamEdgePath(width: number, y: number, amp = 5): string {
  const w = Math.max(1, width);
  return (
    `M -10 ${y + 7} L -10 ${y} ` +
    `Q ${w * 0.125} ${y - amp} ${w * 0.25} ${y} ` +
    `Q ${w * 0.375} ${y + amp} ${w * 0.5} ${y} ` +
    `Q ${w * 0.625} ${y - amp} ${w * 0.75} ${y} ` +
    `Q ${w * 0.875} ${y + amp} ${w + 10} ${y} ` +
    `L ${w + 10} ${y + 7} Z`
  );
}

/**
 * Which of the four shell kinds a memory becomes: 0 scallop, 1 clam, 2 whelk,
 * 3 cowrie. Stable forever per key, so a shell never changes shape between
 * renders.
 */
export function shellKindFor(key: string): number {
  return hashMomentId(key) % 4;
}

/**
 * A scalloped fan: the outer arc bumps instead of sweeping smoothly, so the
 * edge reads as shell rather than as a plain arc.
 */
export function scallopFanPath(cx: number, cy: number, r: number, bumps = 7): string {
  const steps = bumps * 2;
  let d = `M ${cx - r} ${cy}`;
  for (let i = 1; i <= steps; i += 1) {
    const t = i / steps;
    const ang = Math.PI - t * Math.PI;
    const bump = i % 2 === 0 ? 1 : 1.07;
    d += ` L ${cx + Math.cos(ang) * r * bump} ${cy - Math.sin(ang) * r * bump}`;
  }
  return `${d} L ${cx + r} ${cy} Z`;
}

/**
 * One memory as a shell on the shore.
 *
 * Four kinds — the fan scallop, the ribbed clam, the spired whelk, and the
 * smooth cowrie — each drawn with *form* rather than flat fill: a body lit
 * from the upper left and falling into shade, ridges that catch a highlight
 * beside their shadow, a hinge, and a soft cast shadow set to one side. That
 * shading, not the outline, is what stops a shell reading as clip art.
 * Everything is plain numbers, path verbs, and Skia gradients.
 */
function ShellGlyph({ shellKey, cx, cy, r }: {
  shellKey: string;
  cx: number;
  cy: number;
  r: number;
}) {
  const h = hashMomentId(shellKey);
  const sizeFactor = 0.82 + ((h >>> 21) % 36) / 100;
  const rr = Math.max(7, r * 3) * sizeFactor;
  const kind = shellKindFor(shellKey);
  const rotation = ((h >>> 5) % 360) * (Math.PI / 180);
  const palette = SEA_SHELL_PALETTE[(h >>> 13) % SEA_SHELL_PALETTE.length];
  const body = palette.body;
  const dark = palette.rib;
  const light = mixHex(body, '#FFFFFF', 0.55);
  const shadow = '#3A2A12';
  // The light comes from the upper left, so the shade falls to the lower right.
  const lit = (x0: number, y0: number, x1: number, y1: number) => (
    <LinearGradient
      start={vec(x0, y0)}
      end={vec(x1, y1)}
      colors={[light, body, dark]}
      positions={[0, 0.42, 1]}
    />
  );

  const castShadow = (
    <Oval x={cx - rr * 1.05} y={cy - rr * 0.05} width={rr * 2.2} height={rr * 0.72} opacity={0.32}>
      <RadialGradient
        c={vec(cx + rr * 0.22, cy + rr * 0.16)}
        r={rr * 1.2}
        colors={[shadow, `${shadow}00`]}
        positions={[0, 1]}
      />
    </Oval>
  );
  const highlight = (
    <Oval x={cx - rr * 0.52} y={cy - rr * 0.72} width={rr * 0.5} height={rr * 0.3} color="#FFFFFF" opacity={0.6} />
  );

  let shape;
  if (kind === 0) {
    // Scallop: a scalloped fan of ribs radiating from the hinge.
    const ribs = [];
    for (let i = 1; i <= 6; i += 1) {
      const t = i / 7;
      const ang = Math.PI - t * Math.PI;
      const ex = cx + Math.cos(ang) * rr * 0.94;
      const ey = cy - Math.sin(ang) * rr * 0.94;
      ribs.push(<Path key={`sd${i}`} path={`M ${cx} ${cy} L ${ex} ${ey}`} color={dark} opacity={0.3} style="stroke" strokeWidth={0.7} />);
      ribs.push(<Path key={`sl${i}`} path={`M ${cx + rr * 0.06} ${cy} L ${ex + rr * 0.06} ${ey - rr * 0.08}`} color={light} opacity={0.6} style="stroke" strokeWidth={0.6} />);
    }
    shape = (
      <>
        <Path path={scallopFanPath(cx, cy, rr, 7)}>{lit(cx - rr, cy - rr, cx + rr, cy + rr)}</Path>
        {ribs}
        <Oval x={cx - rr * 0.22} y={cy - rr * 0.18} width={rr * 0.44} height={rr * 0.36} color={dark} opacity={0.5} />
      </>
    );
  } else if (kind === 1) {
    // Clam: an oval of concentric growth lines under a raised umbo.
    const arcs = [];
    for (let i = 1; i <= 5; i += 1) {
      const k = 0.28 + i * 0.15;
      arcs.push(<Path key={`cd${i}`} path={`M ${cx - rr * k} ${cy + rr * 0.08} Q ${cx} ${cy - rr * k * 0.85} ${cx + rr * k} ${cy + rr * 0.08}`} color={dark} opacity={0.4} style="stroke" strokeWidth={1} />);
    }
    shape = (
      <>
        <Oval x={cx - rr} y={cy - rr * 0.62} width={rr * 2} height={rr * 1.24}>{lit(cx - rr, cy - rr, cx + rr, cy + rr)}</Oval>
        {arcs}
        <Path path={`M ${cx - rr * 0.95} ${cy + rr * 0.12} Q ${cx} ${cy + rr * 0.56} ${cx + rr * 0.95} ${cy + rr * 0.12}`} color={dark} opacity={0.32} style="stroke" strokeWidth={1.1} />
        <Oval x={cx - rr * 0.19} y={cy - rr * 0.54} width={rr * 0.38} height={rr * 0.26} color={dark} opacity={0.55} />
      </>
    );
  } else if (kind === 2) {
    // Whelk: a body whorl under a rounded spire, banded.
    shape = (
      <>
        <Path path={`M ${cx - rr * 0.5} ${cy - rr * 0.1} L ${cx - rr * 0.14} ${cy - rr * 1.45} Q ${cx} ${cy - rr * 1.72} ${cx + rr * 0.14} ${cy - rr * 1.45} L ${cx + rr * 0.5} ${cy - rr * 0.1} Z`}>{lit(cx - rr, cy - rr * 1.7, cx + rr, cy)}</Path>
        <Oval x={cx - rr * 0.6} y={cy - rr * 0.28} width={rr * 1.2} height={rr * 1}>{lit(cx - rr, cy - rr, cx + rr, cy + rr)}</Oval>
        <Path path={`M ${cx - rr * 0.56} ${cy + rr * 0.02} Q ${cx} ${cy + rr * 0.3} ${cx + rr * 0.56} ${cy + rr * 0.02}`} color={dark} opacity={0.38} style="stroke" strokeWidth={1} />
        <Path path={`M ${cx - rr * 0.44} ${cy - rr * 0.32} Q ${cx} ${cy - rr * 0.12} ${cx + rr * 0.44} ${cy - rr * 0.32}`} color={dark} opacity={0.38} style="stroke" strokeWidth={1} />
        <Path path={`M ${cx - rr * 0.2} ${cy - rr * 0.72} Q ${cx} ${cy - rr * 0.56} ${cx + rr * 0.2} ${cy - rr * 0.72}`} color={dark} opacity={0.34} style="stroke" strokeWidth={0.9} />
      </>
    );
  } else {
    // Cowrie: a smooth, glossy oval with a slit and a row of teeth.
    const teeth = [];
    for (const t of [-0.42, -0.22, 0.22, 0.42]) {
      teeth.push(<Path key={`ct${t}`} path={`M ${cx + rr * t} ${cy + rr * 0.16} L ${cx + rr * t * 0.72} ${cy + rr * 0.32}`} color={dark} opacity={0.36} style="stroke" strokeWidth={0.9} />);
    }
    shape = (
      <>
        <Oval x={cx - rr * 0.82} y={cy - rr * 0.62} width={rr * 1.64} height={rr * 1.24}>{lit(cx - rr, cy - rr, cx + rr, cy + rr)}</Oval>
        <Path path={`M ${cx - rr * 0.72} ${cy + rr * 0.06} Q ${cx} ${cy + rr * 0.36} ${cx + rr * 0.72} ${cy + rr * 0.06}`} color={dark} opacity={0.5} style="stroke" strokeWidth={1.3} />
        {teeth}
      </>
    );
  }

  return (
    <Group key={shellKey}>
      {castShadow}
      <Group origin={vec(cx, cy)} transform={[{ rotate: rotation }]}>
        {shape}
        {highlight}
      </Group>
    </Group>
  );
}


/**
 * The beach surface: one shader, animated by a monotonic frame clock, and
 * (for the Us field) sampled in the same scene plane the shells use so the
 * water and the sand and the shells move as one. Kept as its own component so
 * the frame clock only runs where the beach actually renders.
 */
function BeachSurface({ effect, base, camera, planeViewport, rectWidth, rectHeight, animated }: {
  effect: SkRuntimeEffect;
  base: DuskUniforms;
  camera?: SharedValue<PhotoSkyCamera>;
  planeViewport: SkyViewport;
  rectWidth: number;
  rectHeight: number;
  animated: boolean;
}) {
  const clock = useSharedValue(0);
  useFrameCallback((info) => {
    'worklet';
    if (info.timeSinceFirstFrame != null) {
      clock.value = info.timeSinceFirstFrame;
    }
  }, animated);
  const uniforms = useDerivedValue(() => {
    const time = animated ? clock.value : 0;
    if (!camera) {
      return { ...base, uTime: time };
    }
    const plane = photoSkyPlane(camera.value, 0, planeViewport);
    return { ...base, uTime: time, uPan: [plane.x, plane.y], uScale: plane.scale };
  });
  return (
    <Rect x={0} y={0} width={rectWidth} height={rectHeight}>
      <Shader source={effect} uniforms={uniforms} />
    </Rect>
  );
}

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

type PhotoGlyphTransform = DerivedValue<{ scale: number }[]>;

function PhotoDepthLayer({ camera, depth, viewport, children }: {
  camera: SharedValue<PhotoSkyCamera>; depth: number; viewport: SkyViewport; children: (transform: PhotoGlyphTransform) => ReactNode;
}) {
  const transform = useDerivedValue(() => {
    const plane = photoSkyPlane(camera.value, depth, viewport);
    return [{ translateX: plane.x }, { translateY: plane.y }, { scale: plane.scale }];
  });
  const glyphTransform = useDerivedValue(() => {
    const plane = photoSkyPlane(camera.value, depth, viewport);
    return [{ scale: photoSkyGlyphScale(plane.scale) / plane.scale }];
  });
  return <Group transform={transform}>{children(glyphTransform)}</Group>;
}

function PhotoSkyAtmosphere({ camera, viewport, isDark, still }: {
  camera?: SharedValue<PhotoSkyCamera>; viewport: SkyViewport; isDark: boolean; still: boolean;
}) {
  const far = useDerivedValue(() => [{ translateX: still ? 0 : -(camera?.value.x ?? 0) * viewport.width * 0.025 },
    { translateY: still ? 0 : -(camera?.value.y ?? 0) * viewport.height * 0.025 }]);
  const near = useDerivedValue(() => [{ translateX: still ? 0 : -(camera?.value.x ?? 0) * viewport.width * 0.055 },
    { translateY: still ? 0 : -(camera?.value.y ?? 0) * viewport.height * 0.055 }]);
  return <>
    <Group transform={far}>
      <Rect x={-viewport.width} y={-viewport.height} width={viewport.width * 3} height={viewport.height * 3} opacity={isDark ? 0.16 : 0.1}>
        <RadialGradient c={vec(viewport.width * 0.32, viewport.height * 0.28)} r={viewport.width * 0.65}
          colors={[PHOTO_SKY_HAZE_COOL, `${PHOTO_SKY_HAZE_COOL}00`]} positions={[0, 1]} />
      </Rect>
    </Group>
    <Group transform={near}>
      <Rect x={-viewport.width} y={-viewport.height} width={viewport.width * 3} height={viewport.height * 3} opacity={isDark ? 0.12 : 0.08}>
        <RadialGradient c={vec(viewport.width * 0.74, viewport.height * 0.52)} r={viewport.width * 0.5}
          colors={[PHOTO_SKY_HAZE_WARM, `${PHOTO_SKY_HAZE_WARM}00`]} positions={[0, 1]} />
      </Rect>
    </Group>
  </>;
}

function TwinkleOverlay({ x, y, color, photoCamera, radius = 2.5, depth = 0, viewport }: {
  x: number; y: number; color: string; photoCamera?: SharedValue<PhotoSkyCamera>; radius?: number; depth?: number; viewport?: SkyViewport;
}) {
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
    opacity: opacity.value * (photoCamera ? 0.55 : 1),
    transform: [{ scale: scale.value }],
  }));

  const positionStyle = useAnimatedStyle(() => {
    if (!photoCamera || !viewport) return {};
    const plane = photoSkyPlane(photoCamera.value, depth, viewport);
    return { left: x * plane.scale + plane.x, top: y * plane.scale + plane.y, transform: [{ scale: photoSkyGlyphScale(plane.scale) }] };
  });
  const diameter = photoCamera ? radius * 2 : 5;

  return (
    <Animated.View pointerEvents="none" accessible={false} style={[styles.twinkleBase, { left: x, top: y }, positionStyle]}>
      <Animated.View style={[styles.twinkleDot, { backgroundColor: color, width: diameter, height: diameter, borderRadius: diameter / 2 }, animatedStyle]} />
    </Animated.View>
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
  starLimit = MEMORY_SKY_MAX_STARS,
  photoStars = false,
  photoCamera,
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
  themeId,
}: {
  moments: SkyItem[];
  /** Us represents every album photo; other screens retain their existing cap. */
  starLimit?: number | null;
  /** Us photo stars are readable against the full-height dusk. */
  photoStars?: boolean;
  photoCamera?: SharedValue<PhotoSkyCamera>;
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
  /**
   * Explicit theme for the dusk. Defaults to the selected theme: the sky
   * follows the theme picker like every other surface, instead of rendering
   * the After Hours wine dusk under every preset.
   */
  themeId?: string;
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
  const { selectedThemeId } = useAoiTheme();
  const isDark = isDarkBackground(background);
  // Beach sand, per mode: a sunlit top settling to a deeper floor.
  const sandTop = isDark ? SEA_SAND_DARK_TOP : SEA_SAND_LIGHT_TOP;
  const sandDeep = isDark ? SEA_SAND_DARK_DEEP : SEA_SAND_LIGHT_DEEP;
  // Per-theme dusk: the same ramp family as After Hours (dark top, lighter
  // mid melting into the live background), keyed by the selected preset so
  // Sunset Shore glows ember, Sea Glass runs teal, Deep Ocean goes pine
  // night, and Editorial Paper settles to espresso ink. Lagoon is the
  // exception: a daytime beach (bright cyan water over sunlit sand), where
  // memories walk as footprints along a shoreline trail instead of shining
  // as stars (see isBeach below). After Hours keeps
  // the canonical LIGHT_/DARK_SKY_* stops via the palette table.
  const activeThemeId = themeId ?? selectedThemeId;
  const stops = skyStopsForTheme(activeThemeId, isDark ? 'dark' : 'light');
  const skyTop = stops.top;
  const skyMid = stops.mid;
  // Beach mode: the Lagoon theme renders sea life instead of the star field.
  // Everything else (After Hours included) keeps the stars untouched.
  const isBeach = isBeachTheme(activeThemeId);
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
  // Compile the beach shader once, after the first paint, so switching to the
  // beach theme never stalls a frame compiling it — a stall reads as a
  // flicker the moment the theme changes.
  useEffect(() => {
    beachEffectOnce();
  }, []);

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
  const stripTop = compactLayout || photoStars
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
  const visible = useMemo(() => starLimit === null ? moments : moments.slice(0, starLimit), [moments, starLimit]);
  const dayCount = typeof daysTogether === 'number' ? daysTogether : 0;
  const count = isDayMode ? dayCount : moments.length;
  // Beach sampling: bands hold a small school, the full sky a larger one;
  // the caption keeps the true count, so no memory is ever uncounted, only
  // unpainted.
  const beachMax = !isBeach
    ? 0
    : header
      ? BEACH_HEADER_CREATURE_MAX
      : compactLayout
        ? BEACH_BAND_CREATURE_MAX
        : 40;
  const beachKeep = useMemo(
    () => (beachMax > 0 ? beachMomentKeep(visible.map((moment) => moment.id), beachMax) : null),
    [beachMax, visible],
  );

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
      const dayStride = beachMax > 0 ? beachDayStride(field.stars.length, beachMax) : 1;
      const push = (star: DaySkySpatialStar) => {
        // Band sampling: every nth day so 200 days together read as a calm
        // shore across the whole relationship, not static.
        if (dayStride > 1 && star.dayIndex % dayStride !== 0) {
          return;
        }
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
          bright: isBeach ? false : isBrightDayStar(star.dayIndex),
          rotationDeg: sparkleRotationDeg(key),
          role: star.tone === 'dim' ? undefined : star.tone,
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
    if (photoStars) {
      // The beach is a flat plane: every photo shell shares one depth, so the
      // camera moves them with the surface instead of sliding them across it.
      for (const star of buildPhotoSkyField(visible, isBeach)) {
        const size = star.depth === 'far' ? 2 : star.depth === 'mid' ? 3 : 4;
        const entry: PlottedStar = {
          key: star.id, cx: star.x * canvasW, cy: star.y * canvasH,
          size, r: star.radius, sparkleR: star.radius * 2.2,
          opacity: star.opacity, color: mixHex(PHOTO_SKY_STAR_COOL, PHOTO_SKY_STAR_WARM, star.warmth),
          bright: star.sparkle, rotationDeg: star.rotation,
          haloRadius: star.haloRadius, haloOpacity: star.haloOpacity,
        };
        out[star.depth].push(entry);
      }
      return out;
    }
    for (const moment of visible) {
      // Sampling: rank-kept survivors only; the caption keeps count.
      if (beachKeep && !beachKeep.has(moment.id)) {
        continue;
      }
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
        bright: isBeach ? false : hashMomentId(`${moment.id}-bright`) % 16 === 0,
        rotationDeg: sparkleRotationDeg(moment.id),
        role: moment.authorRole,
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
      const ambientMod = compactLayout || header ? 5 : 4;
      for (let index = 0; index < MEMORY_SKY_AMBIENT_COUNT; index += 1) {
        // Bands need only a hint of texture; the full sky keeps the field.
        if (beachMax > 0 && index % ambientMod !== 0) {
          continue;
        }
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
          bright: isBeach ? false : isAmbientSparkle(index),
          rotationDeg: sparkleRotationDeg(key),
        };
        if (layout.size === 3) {
          out.mid.push(entry);
        } else {
          out.near.push(entry);
        }
      }
    }
    // Beach: the beach runs sand-first, so every mark is a shell resting on
    // the sand band (spilling to the waterline), keeping the field's spread.
    if (isBeach) {
      const onSand = (entry: PlottedStar): PlottedStar => ({
        ...entry,
        cy: beachShellY(entry.cy / canvasH) * canvasH,
        bright: false,
      });
      out.far = out.far.map(onSand);
      out.mid = out.mid.map(onSand);
      out.near = out.near.map(onSand);
    }
    return out;
  }, [ambient, field, buckets, zoom, visible, compactLayout, compactVisibleBottomSy, photoStars, isBeach, beachMax, beachKeep, header]);

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
  const skyCanvasW = compactLayout || photoStars ? windowWidth : windowWidth + Spacing[16] * 2;
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
    : photoStars
      ? [mixHex(moodTop, PHOTO_SKY_DEPTH, 0.32), mixHex(moodMid, moodTop, 0.24), background]
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
  // The beach is one shader: procedural sand over the sea, plain numbers in,
  // nothing animated. A band strip (compact/header) keeps only the water and
  // dissolves it into the page, so an 88pt backdrop flows instead of showing
  // a sand/sea split it has no room for.
  const beachEffect = isBeach ? beachEffectOnce() : null;
  const beachWaterOnly = isBeach && (compactLayout || header);
  const beachUniforms = useMemo(
    () =>
      beachSkyUniforms({
        width: skyCanvasW,
        height: canvasHeight,
        shore: beachWaterOnly ? 0 : BEACH_SHORE_FRACTION,
        fadeFrom: beachWaterOnly ? 0.3 : 1,
        sandLight: isDark ? SEA_SAND_DARK_TOP : SEA_SAND_LIGHT_TOP,
        sandDeep: isDark ? SEA_SAND_DARK_DEEP : SEA_SAND_LIGHT_DEEP,
        wet: isDark ? SEA_WET_DARK : SEA_WET_LIGHT,
        seaShallow: isDark ? SEA_WATER_DARK_SHALLOW : SEA_WATER_LIGHT_SHALLOW,
        seaDeep: isDark ? SEA_WATER_DARK_DEEP : SEA_WATER_LIGHT_DEEP,
        foam: isDark ? SEA_FOAM_DARK : SEA_FOAM,
      }),
    [skyCanvasW, canvasHeight, isDark, beachWaterOnly],
  );
  // Flat-plane camera: the surface is sampled in the same scene space the
  // shells use, so sand and shells move together as one plane. The clock and
  // the scene sampling live in BeachSurface so they only exist when it renders.
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
        bright: isBeach ? false : isAmbientSparkle(index),
        rotationDeg: sparkleRotationDeg(key),
      };
    }) : [], [handoverProgress, windowHeight, scaleX, isBeach]);

  // Depth, as travel: the same camera move, read at four distances.
  const travel = Math.min(1, Math.max(0, camera)) * skyHeight;
  // Kept modest: a taller strip means the same factors travel further, and a
  // camera that empties the sky of stars is a camera that undoes the night.
  const farTravel = -travel * 0.05;
  const midTravel = -travel * 0.13;
  const nearTravel = -travel * 0.24;
  const cloudTravel = -travel * 0.34;

  const renderHalo = (star: PlottedStar) => {
    const radius = photoCamera ? Math.max(star.haloRadius ?? 0, star.r * 4) : star.haloRadius ?? 0;
    const cx = star.cx * scaleX;
    const cy = star.cy * scaleY;
    return <Oval key={`halo-${star.key}`} x={cx - radius} y={cy - radius} width={radius * 2} height={radius * 2} opacity={star.haloOpacity}>
      <RadialGradient c={vec(cx, cy)} r={radius}
        colors={[star.color, `${star.color}30`, `${star.color}00`]} positions={[0, 0.35, 1]} />
    </Oval>;
  };
  const renderCore = (star: PlottedStar) => {
    const cx = star.cx * scaleX;
    const cy = star.cy * scaleY;
    // Beach mode, every surface: a memory is a shell on the shore — one of
    // four kinds, tinted and turned by its key. Pure (no hooks here): plain
    // numbers and path verbs.
    if (isBeach) {
      return <ShellGlyph
        key={star.key}
        shellKey={star.key}
        cx={cx}
        cy={cy}
        r={star.r}
      />;
    }
    if (!star.bright) return <Circle key={star.key} cx={cx} cy={cy} r={star.r} color={star.color} opacity={star.opacity}>
      {photoStars && photoCamera ? <RadialGradient c={vec(cx, cy)} r={star.r}
        colors={['#FFF8FA', star.color, `${star.color}88`]} positions={[0, 0.5, 1]} /> : null}
    </Circle>;
    return <Group key={star.key} origin={vec(cx, cy)} transform={[{ rotate: (star.rotationDeg * Math.PI) / 180 }]}>
      <Path path={sparklePath(cx, cy, star.sparkleR)} color={star.color} opacity={Math.min(1, star.opacity + 0.2)} />
    </Group>;
  };
  const renderBucket = (stars: PlottedStar[], glyphTransform?: PhotoGlyphTransform) => glyphTransform ? (
    stars.map((star) => <Group key={star.key} origin={vec(star.cx * scaleX, star.cy * scaleY)} transform={glyphTransform}>
      {renderHalo(star)}
      {renderCore(star)}
    </Group>)
  ) : (
    <>
      {photoStars ? stars.filter((star) => (star.haloRadius ?? 0) > 0).map(renderHalo) : null}
      {stars.filter((star) => !star.bright).map(renderCore)}
      {stars.filter((star) => star.bright).map(renderCore)}
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

  const starBuckets = photoStars && photoCamera ? (
    <>
      <PhotoDepthLayer camera={photoCamera} depth={1.1} viewport={{ width: skyCanvasW, height: skyHeight }}>{(transform) => renderBucket(plotted.far, transform)}</PhotoDepthLayer>
      <PhotoDepthLayer camera={photoCamera} depth={0.45} viewport={{ width: skyCanvasW, height: skyHeight }}>{(transform) => renderBucket(plotted.mid, transform)}</PhotoDepthLayer>
      <PhotoDepthLayer camera={photoCamera} depth={0} viewport={{ width: skyCanvasW, height: skyHeight }}>{(transform) => renderBucket(plotted.near, transform)}</PhotoDepthLayer>
    </>
  ) : (
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

  // Fallback shore for a platform without Skia runtime effects: a gradient
  // sand band and foam edge. When the beach shader is available it paints the
  // whole surface and this stays null.
  const sandTopFrac = immersive || photoStars ? BEACH_SHORE_TOP : BEACH_SAND_TOP;
  const sandTopPx = sandTopFrac * skyHeight;
  const sandColors = compactLayout
    ? [sandTop, backgroundAtAlpha(sandTop, 0)]
    : immersive || photoStars
      ? [sandTop, sandDeep]
      : [sandTop, background];
  const beachSand = !isBeach || beachEffect ? null : (
    <>
      <Rect x={0} y={sandTopPx} width={skyCanvasW} height={Math.max(0, skyHeight - sandTopPx)}>
        <LinearGradient
          start={vec(0, sandTopPx)}
          end={vec(0, skyHeight)}
          colors={sandColors}
          positions={[0, 1]}
        />
      </Rect>
      <Path path={foamEdgePath(skyCanvasW, sandTopPx)} color="#FFFFFF" opacity={0.32} />
    </>
  );

  // Beach dressing: shells resting on the sand. Full sky only — bands are
  // 88pt tall with content scrolling over them, and shells there read as
  // dirt. Scenery, never data: fixed positions, no twinkle, no captions
  // counted.
  // The shore's own shells were scenery; the beach shader now paints the
  // ground, and every shell on screen is a memory, so scenery is dropped.
  const beachShells = null;

  const caption = isBeach
    ? count === 0
      ? 'Keep your first memory and find your first shell'
      : count === 1
        ? '1 shell on your shore'
        : `${count} shells on your shore`
    : isDayMode
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

  // Clouds over a beach scene read as haze on the water; keep them faint.
  const beachCloudDim = isBeach ? 0.2 : 1;

  const cloudLayers: CloudLayerSpec[] = ambient || handoverProgress
    ? [
        { testID: 'memory-sky-cloud-b', source: cloudBBank, width: cloudWidth, height: cloudHeight, top: cloudBTop, opacity: MEMORY_SKY_AMBIENT_CLOUD_B_OPACITY * beachCloudDim, amplitudePx: MEMORY_SKY_CLOUD_B.amplitudePx, durationMs: MEMORY_SKY_CLOUD_B.durationMs, reverse: true },
        { testID: 'memory-sky-cloud-a', source: cloudABank, width: cloudWidth, height: cloudHeight, top: bankTop(MEMORY_SKY_AMBIENT_CLOUD_A_TOP, cloudHeight), opacity: MEMORY_SKY_AMBIENT_CLOUD_A_OPACITY * beachCloudDim, amplitudePx: MEMORY_SKY_CLOUD_A.amplitudePx, durationMs: MEMORY_SKY_CLOUD_A.durationMs, reverse: false },
        { testID: 'memory-sky-cloud-c', source: cloudBBank, width: wispWidth, height: wispHeight, top: bankTop(MEMORY_SKY_AMBIENT_CLOUD_C_TOP, wispHeight), opacity: MEMORY_SKY_AMBIENT_CLOUD_C_OPACITY * beachCloudDim, amplitudePx: MEMORY_SKY_CLOUD_B.amplitudePx, durationMs: MEMORY_SKY_CLOUD_B.durationMs, reverse: true },
      ]
    : [
        { testID: 'memory-sky-cloud-b', source: cloudBBank, width: cloudWidth, height: cloudHeight, top: cloudBTop, opacity: (compactLayout ? MEMORY_SKY_COMPACT_CLOUD_B_OPACITY : 0.45) * beachCloudDim, amplitudePx: MEMORY_SKY_CLOUD_B.amplitudePx, durationMs: MEMORY_SKY_CLOUD_B.durationMs, reverse: true },
        { testID: 'memory-sky-cloud-a', source: cloudABank, width: cloudWidth, height: cloudHeight, top: cloudATop, opacity: (compactLayout ? MEMORY_SKY_COMPACT_CLOUD_A_OPACITY : 0.55) * beachCloudDim, amplitudePx: MEMORY_SKY_CLOUD_A.amplitudePx, durationMs: MEMORY_SKY_CLOUD_A.durationMs, reverse: false },
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
          compactLayout || photoStars
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
                    {isBeach && beachEffect ? (
                      <BeachSurface
                        effect={beachEffect}
                        base={beachUniforms}
                        camera={photoCamera}
                        planeViewport={{ width: skyCanvasW, height: skyHeight }}
                        rectWidth={skyCanvasW}
                        rectHeight={canvasHeight}
                        animated={motionAllowed}
                      />
                    ) : compactLayout && duskEffect ? (
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
                    {photoStars && !isBeach ? <PhotoSkyAtmosphere camera={photoCamera} viewport={{ width: skyCanvasW, height: skyHeight }}
                      isDark={isDark} still={reduceMotion || systemReduce} /> : null}
                    {beachSand}
                    {handoverProgress ? (
                      <SettlingStars progress={handoverProgress} distance={windowHeight - skyHeight} source={renderBucket(sourceStars)}>
                        {starBuckets}
                        {beachShells}
                      </SettlingStars>
                    ) : <>{starBuckets}{beachShells}</>}
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
          {motionAllowed && twinkleStar && !isBeach ? (
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
                photoCamera={photoStars ? photoCamera : undefined}
                radius={twinkleStar.r}
                depth={twinkleStar.size === 2 ? 1.1 : twinkleStar.size === 3 ? 0.45 : 0}
                viewport={{ width: skyCanvasW, height: skyHeight }}
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
        {!photoStars && !isDayMode && visible.length === 0 && !ambient ? (
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

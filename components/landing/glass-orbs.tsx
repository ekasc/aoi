import {
  Blur,
  Canvas,
  Circle,
  LinearGradient,
  Oval,
  RadialGradient,
  SweepGradient,
  vec,
} from '@shopify/react-native-skia';
import { useEffect, useMemo } from 'react';
import {
  StyleSheet,
  View,
  useColorScheme,
  useWindowDimensions,
} from 'react-native';
import {
  Easing,
  useDerivedValue,
  useReducedMotion,
  useSharedValue,
  withRepeat,
  withTiming,
  type SharedValue,
} from 'react-native-reanimated';

import { SkiaReady } from '@/components/landing/skia-ready';

/**
 * Procedural welcome artwork: two translucent glass discs — rear disc
 * upper-right, foreground disc lower-left — drawn with Skia at runtime
 * (no image asset), plus one restrained secondary device: a very thin
 * tilted orbit line passing behind the discs.
 *
 * Per-disc layer stack (back to front):
 *   1. tight cast shadow beneath the orb, over a shared diffuse plane;
 *   2. translucent glass body — radial shading the background shows
 *      through, denser taupe toward the edge so the disc reads on ivory;
 *   3. directional shade — subtle darkening opposite the light source
 *      (lower-right), via a linear overlay;
 *   4. offset internal illumination — champagne light from the upper-left,
 *      deliberately off-center, never a centered hotspot;
 *   5. small soft specular reflection, rigid with the disc and placed
 *      asymmetrically per disc (never an independent liquid shimmer);
 *   6. thin refractive rim highlights over part of the circumference only
 *      — a crisp arc plus a faint inner echo.
 *
 * A separate warm interaction glow sits where the discs overlap, its
 * bright core drawn above the foreground disc — the brightest optical
 * area, champagne rather than orange, reading as light passing through
 * overlapping glass.
 *
 * Light mode is warm frosted glass with gray/taupe density; dark mode is
 * smoky translucent glass with a restrained amber glow. The palettes are
 * designed independently — dark is not an inversion of light.
 *
 * Motion is slow ambient drift/breathing only (7–10s eased loops, fully
 * static under reduced motion).
 *
 * All visual tuning lives in OrbTuning below — geometry, opacities,
 * widths, animation, and both palettes. The render tree reads from it;
 * no magic numbers are scattered through the scene.
 *
 * Implementation note: this Skia version only subscribes to shared
 * values passed as top-level scalar/vector props (never inside
 * `transform` arrays), so drift/scale are expressed through animated
 * `cx`/`cy`/`r`/`c` props and the rims are sweep-shaded stroke rings
 * rather than static paths.
 */

type RimStops = {
  colors: string[];
  positions: number[];
};

type DiscPalette = {
  /** Translucent body: bg-visible core → denser taupe edge. */
  body: string[];
  bodyPositions: number[];
  /** Directional shade opposite the light (lower-right). */
  shade: string[];
  /** Offset champagne illumination (upper-left). */
  illumination: string[];
  illuminationPositions: number[];
  /** Small specular reflection. */
  specular: string[];
  rimCrisp: RimStops;
  rimEcho: RimStops;
  rimSoft: RimStops;
  shadowOpacity: number;
};

type OrbPalette = {
  front: DiscPalette;
  rear: DiscPalette;
  /** Wide halo around the overlap. */
  glowHalo: string[];
  glowHaloRange: [number, number];
  /** Tight bright core — the brightest area of the composition. */
  glowCore: string[];
  glowCoreRange: [number, number];
  /** Thin orbit line color. */
  orbit: string;
};

const TRANSPARENT_WHITE = 'rgba(255,255,255,0)';
const TRANSPARENT_CHAMPAGNE = 'rgba(255,232,196,0)';
const TRANSPARENT_AMBER = 'rgba(255,200,130,0)';
const TRANSPARENT_SMOKE = 'rgba(20,18,16,0)';

const LIGHT_RIM_CRISP: RimStops = {
  colors: [
    TRANSPARENT_WHITE,
    TRANSPARENT_WHITE,
    'rgba(255,255,255,0.5)',
    'rgba(255,255,255,0.92)',
    'rgba(255,255,255,0.45)',
    TRANSPARENT_WHITE,
  ],
  positions: [0, 0.56, 0.68, 0.82, 0.93, 1],
};
const LIGHT_RIM_ECHO: RimStops = {
  colors: [
    TRANSPARENT_WHITE,
    TRANSPARENT_WHITE,
    TRANSPARENT_WHITE,
    'rgba(255,255,255,0.5)',
    'rgba(255,255,255,0.28)',
    TRANSPARENT_WHITE,
  ],
  positions: [0, 0.6, 0.7, 0.82, 0.92, 1],
};
const LIGHT_RIM_SOFT: RimStops = {
  colors: [
    TRANSPARENT_WHITE,
    TRANSPARENT_WHITE,
    'rgba(255,251,242,0.26)',
    'rgba(255,251,242,0.34)',
    'rgba(255,251,242,0.2)',
    TRANSPARENT_WHITE,
  ],
  positions: [0, 0.5, 0.66, 0.82, 0.94, 1],
};
const LIGHT_SHADE = [
  'rgba(122,102,80,0)',
  'rgba(122,102,80,0)',
  'rgba(122,102,80,0.1)',
  'rgba(112,93,72,0.17)',
];
const LIGHT_ILLUMINATION = [
  'rgba(255,253,246,0.36)',
  'rgba(255,250,238,0.2)',
  'rgba(255,248,232,0)',
];
const LIGHT_SPECULAR = ['rgba(255,255,255,0.45)', 'rgba(255,255,255,0)'];

const LIGHT_FRONT: DiscPalette = {
  body: [
    'rgba(255,255,255,0.42)',
    'rgba(250,244,231,0.4)',
    'rgba(238,227,204,0.48)',
    'rgba(216,200,176,0.58)',
    'rgba(198,181,156,0.64)',
    'rgba(188,171,146,0.7)',
  ],
  bodyPositions: [0, 0.3, 0.55, 0.75, 0.9, 1],
  shade: LIGHT_SHADE,
  illumination: LIGHT_ILLUMINATION,
  illuminationPositions: [0, 0.55, 1],
  specular: LIGHT_SPECULAR,
  rimCrisp: LIGHT_RIM_CRISP,
  rimEcho: LIGHT_RIM_ECHO,
  rimSoft: LIGHT_RIM_SOFT,
  shadowOpacity: 0.12,
};

const LIGHT_REAR: DiscPalette = {
  body: [
    'rgba(255,252,244,0.44)',
    'rgba(250,240,222,0.42)',
    'rgba(238,224,198,0.5)',
    'rgba(214,196,170,0.6)',
    'rgba(196,178,152,0.66)',
    'rgba(186,168,142,0.7)',
  ],
  bodyPositions: [0, 0.3, 0.55, 0.75, 0.9, 1],
  shade: LIGHT_SHADE,
  illumination: LIGHT_ILLUMINATION,
  illuminationPositions: [0, 0.55, 1],
  specular: LIGHT_SPECULAR,
  rimCrisp: LIGHT_RIM_CRISP,
  rimEcho: LIGHT_RIM_ECHO,
  rimSoft: LIGHT_RIM_SOFT,
  shadowOpacity: 0.11,
};

const DARK_RIM_CRISP: RimStops = {
  colors: [
    TRANSPARENT_AMBER,
    TRANSPARENT_AMBER,
    'rgba(255,216,152,0.45)',
    'rgba(255,216,152,0.85)',
    'rgba(255,216,152,0.4)',
    TRANSPARENT_AMBER,
  ],
  positions: [0, 0.56, 0.68, 0.82, 0.93, 1],
};
const DARK_RIM_ECHO: RimStops = {
  colors: [
    TRANSPARENT_AMBER,
    TRANSPARENT_AMBER,
    TRANSPARENT_AMBER,
    'rgba(255,216,152,0.45)',
    'rgba(255,216,152,0.24)',
    TRANSPARENT_AMBER,
  ],
  positions: [0, 0.6, 0.7, 0.82, 0.92, 1],
};
const DARK_RIM_SOFT: RimStops = {
  colors: [
    TRANSPARENT_AMBER,
    TRANSPARENT_AMBER,
    'rgba(255,200,130,0.18)',
    'rgba(255,200,130,0.26)',
    'rgba(255,200,130,0.16)',
    TRANSPARENT_AMBER,
  ],
  positions: [0, 0.5, 0.66, 0.82, 0.94, 1],
};
const DARK_SHADE = [
  'rgba(0,0,0,0)',
  'rgba(0,0,0,0)',
  'rgba(0,0,0,0.14)',
  'rgba(0,0,0,0.24)',
];
const DARK_ILLUMINATION = [
  'rgba(255,222,172,0.24)',
  'rgba(255,214,160,0.13)',
  'rgba(255,210,155,0)',
];
const DARK_SPECULAR = ['rgba(255,230,190,0.4)', 'rgba(255,230,190,0)'];

const DARK_FRONT: DiscPalette = {
  body: [
    'rgba(96,87,76,0.46)',
    'rgba(80,72,63,0.5)',
    'rgba(64,58,51,0.56)',
    'rgba(50,45,40,0.63)',
    'rgba(40,36,32,0.69)',
    'rgba(34,30,27,0.73)',
  ],
  bodyPositions: [0, 0.3, 0.55, 0.75, 0.9, 1],
  shade: DARK_SHADE,
  illumination: DARK_ILLUMINATION,
  illuminationPositions: [0, 0.55, 1],
  specular: DARK_SPECULAR,
  rimCrisp: DARK_RIM_CRISP,
  rimEcho: DARK_RIM_ECHO,
  rimSoft: DARK_RIM_SOFT,
  shadowOpacity: 0.6,
};

const DARK_REAR: DiscPalette = {
  body: [
    'rgba(104,94,80,0.48)',
    'rgba(86,77,66,0.52)',
    'rgba(68,61,53,0.58)',
    'rgba(53,47,42,0.65)',
    'rgba(42,37,33,0.71)',
    'rgba(35,31,28,0.75)',
  ],
  bodyPositions: [0, 0.3, 0.55, 0.75, 0.9, 1],
  shade: DARK_SHADE,
  illumination: DARK_ILLUMINATION,
  illuminationPositions: [0, 0.55, 1],
  specular: DARK_SPECULAR,
  rimCrisp: DARK_RIM_CRISP,
  rimEcho: DARK_RIM_ECHO,
  rimSoft: DARK_RIM_SOFT,
  shadowOpacity: 0.55,
};

/** Warm frosted glass. Exported for unit tests (palette intentionality). */
export const LIGHT_ORBS: OrbPalette = {
  front: LIGHT_FRONT,
  rear: LIGHT_REAR,
  glowHalo: ['rgba(255,232,196,0.68)', TRANSPARENT_CHAMPAGNE],
  glowHaloRange: [0.55, 0.78],
  glowCore: [
    'rgba(255,250,238,0.95)',
    'rgba(255,240,214,0.45)',
    TRANSPARENT_CHAMPAGNE,
  ],
  glowCoreRange: [0.7, 0.92],
  orbit: 'rgba(150,130,105,0.3)',
};

/** Smoky glass + amber. Exported for unit tests (palette intentionality). */
export const DARK_ORBS: OrbPalette = {
  front: DARK_FRONT,
  rear: DARK_REAR,
  glowHalo: ['rgba(255,190,120,0.5)', TRANSPARENT_SMOKE],
  glowHaloRange: [0.5, 0.72],
  glowCore: [
    'rgba(255,232,190,0.85)',
    'rgba(255,214,150,0.35)',
    TRANSPARENT_SMOKE,
  ],
  glowCoreRange: [0.65, 0.88],
  orbit: 'rgba(255,210,150,0.2)',
};

// Sweep arcs (degrees, 0 = east, clockwise) — upper/right edge only.
export const RIM_START = 245;
export const RIM_END = 360;
export const RIM_ECHO_START = 255;
export const RIM_ECHO_END = 350;

export function paletteForColorScheme(
  colorScheme: string | null | undefined
): OrbPalette {
  return colorScheme === 'dark' ? DARK_ORBS : LIGHT_ORBS;
}

/**
 * Single tuning surface for the welcome orb scene. Fractions are of the
 * canvas width unless noted. The render tree and layout helpers read
 * from here — nothing visual is hardcoded at the call site.
 */
export const OrbTuning = {
  maxSize: 480,
  /** Canvas height as a fraction of canvas width. */
  aspect: 0.72,
  front: {
    /** Disc diameter ≈40% of the width. */
    radiusFraction: 0.2,
    cxFraction: 0.4,
    cyFraction: 0.35,
    /** Asymmetric specular: upper-left wash. */
    specular: { dx: -0.36, dy: -0.48, rx: 0.13, ry: 0.085 },
  },
  /** Rear center = front center + overlap (explicit lens depth). */
  overlap: { dxFraction: 0.28, dyFraction: -0.14 },
  rear: {
    /** Disc diameter ≈38% of the width. */
    radiusFraction: 0.19,
    /** Asymmetric specular: smaller, dimmer, top-centered. */
    specular: { dx: -0.18, dy: -0.5, rx: 0.1, ry: 0.07 },
  },
  glow: {
    cxFraction: 0.54,
    cyFraction: 0.28,
    haloRadiusFraction: 0.58,
    haloSize: { rx: 0.52, ry: 0.58 },
    coreRadiusFraction: 0.34,
    coreSize: { rx: 0.3, ry: 0.34 },
  },
  illumination: { dx: -0.42, dy: -0.46, radiusFraction: 0.68 },
  shadeDiagonal: 0.7,
  rim: {
    crispWidth: 1.25,
    echoWidth: 0.75,
    softWidthFraction: 0.04,
  },
  shadow: {
    /** Tight per-orb contact shadow. */
    xOffsetRadiusFraction: 0.12,
    yGapSizeFraction: 0.045,
    rxRadiusFraction: 1.05,
    rySizeFraction: 0.028,
    blur: 18,
    /** Shared diffuse plane beneath the whole group. */
    planeCxFraction: 0.55,
    planeCyFraction: 0.62,
    planeRxFraction: 0.42,
    planeRyFraction: 0.035,
    planeBlur: 22,
  },
  orbit: {
    cxFraction: 0.54,
    cyFraction: 0.3,
    rxFraction: 0.4,
    ryFraction: 0.28,
    tiltRadians: -0.21,
    width: 1.25,
  },
  motion: {
    rear: {
      xAmplitude: 4,
      xDuration: 8000,
      yAmplitude: 3,
      yDuration: 9200,
      scaleFrom: 0.997,
      scaleTo: 1.005,
      scaleDuration: 7000,
    },
    front: {
      xAmplitude: 3,
      xDuration: 9500,
      yAmplitude: 4,
      yDuration: 7600,
      scaleFrom: 1.004,
      scaleTo: 0.998,
      scaleDuration: 8400,
    },
    haloDuration: 7200,
    coreDuration: 8600,
  },
};

export const MAX_ORB_SIZE = OrbTuning.maxSize;
export const ORB_ASPECT = OrbTuning.aspect;

export type OrbLayout = {
  size: number;
  height: number;
  front: { x: number; y: number; r: number };
  rear: { x: number; y: number; r: number };
  glow: { x: number; y: number };
  shadowFront: { x: number; y: number; rx: number; ry: number };
  shadowRear: { x: number; y: number; rx: number; ry: number };
};

/** Disc geometry derived from the available width — no hardcoded phone size. */
export function orbLayout(windowWidth: number): OrbLayout {
  return orbLayoutForSize(Math.min(windowWidth - 48, OrbTuning.maxSize));
}

/**
 * Disc geometry derived from an explicit canvas width. Front ≈40% and
 * rear ≈38% of the width; the group sits high with room for cast
 * shadows beneath.
 */
export function orbLayoutForSize(width: number): OrbLayout {
  const size = Math.min(width, OrbTuning.maxSize);
  const height = size * OrbTuning.aspect;
  const front = {
    x: size * OrbTuning.front.cxFraction,
    y: size * OrbTuning.front.cyFraction,
    r: size * OrbTuning.front.radiusFraction,
  };
  const rear = {
    x: front.x + size * OrbTuning.overlap.dxFraction,
    y: front.y + size * OrbTuning.overlap.dyFraction,
    r: size * OrbTuning.rear.radiusFraction,
  };
  const shadow = OrbTuning.shadow;
  const shadowFor = (disc: { x: number; y: number; r: number }) => ({
    x: disc.x + disc.r * shadow.xOffsetRadiusFraction,
    y: disc.y + disc.r + size * shadow.yGapSizeFraction,
    rx: disc.r * shadow.rxRadiusFraction,
    ry: size * shadow.rySizeFraction,
  });
  return {
    size,
    height,
    front,
    rear,
    glow: {
      x: size * OrbTuning.glow.cxFraction,
      y: size * OrbTuning.glow.cyFraction,
    },
    shadowFront: shadowFor(front),
    shadowRear: shadowFor(rear),
  };
}

const SINE = Easing.inOut(Easing.sin);

type DiscMotion = {
  dx: SharedValue<number>;
  dy: SharedValue<number>;
  scale: SharedValue<number>;
};

function useAmbientLoops(
  disabled: boolean,
  haloRange: [number, number],
  coreRange: [number, number]
) {
  const tune = OrbTuning.motion;
  const rearX = useSharedValue(-tune.rear.xAmplitude);
  const rearY = useSharedValue(tune.rear.yAmplitude);
  const rearScale = useSharedValue(tune.rear.scaleFrom);
  const frontX = useSharedValue(tune.front.xAmplitude);
  const frontY = useSharedValue(-tune.front.yAmplitude);
  const frontScale = useSharedValue(tune.front.scaleFrom);
  const halo = useSharedValue(haloRange[0]);
  const core = useSharedValue(coreRange[0]);

  useEffect(() => {
    if (disabled) {
      return;
    }
    rearX.value = withRepeat(
      withTiming(tune.rear.xAmplitude, { duration: tune.rear.xDuration, easing: SINE }),
      -1,
      true
    );
    rearY.value = withRepeat(
      withTiming(-tune.rear.yAmplitude, { duration: tune.rear.yDuration, easing: SINE }),
      -1,
      true
    );
    rearScale.value = withRepeat(
      withTiming(tune.rear.scaleTo, { duration: tune.rear.scaleDuration, easing: SINE }),
      -1,
      true
    );
    frontX.value = withRepeat(
      withTiming(-tune.front.xAmplitude, { duration: tune.front.xDuration, easing: SINE }),
      -1,
      true
    );
    frontY.value = withRepeat(
      withTiming(tune.front.yAmplitude, { duration: tune.front.yDuration, easing: SINE }),
      -1,
      true
    );
    frontScale.value = withRepeat(
      withTiming(tune.front.scaleTo, { duration: tune.front.scaleDuration, easing: SINE }),
      -1,
      true
    );
    halo.value = withRepeat(
      withTiming(haloRange[1], { duration: tune.haloDuration, easing: SINE }),
      -1,
      true
    );
    core.value = withRepeat(
      withTiming(coreRange[1], { duration: tune.coreDuration, easing: SINE }),
      -1,
      true
    );
  }, [disabled, haloRange, coreRange, rearX, rearY, rearScale, frontX, frontY, frontScale, halo, core, tune]);

  const rear: DiscMotion = { dx: rearX, dy: rearY, scale: rearScale };
  const front: DiscMotion = { dx: frontX, dy: frontY, scale: frontScale };
  return { rear, front, halo, core };
}

type DiscProps = {
  baseX: number;
  baseY: number;
  baseR: number;
  motion: DiscMotion;
  palette: DiscPalette;
  specular: { dx: number; dy: number; rx: number; ry: number };
};

function GlassDisc({
  baseX,
  baseY,
  baseR,
  motion,
  palette,
  specular,
}: DiscProps) {
  const tune = OrbTuning;
  const cx = useDerivedValue(() => baseX + motion.dx.value);
  const cy = useDerivedValue(() => baseY + motion.dy.value);
  const r = useDerivedValue(() => baseR * motion.scale.value);
  const discCenter = useDerivedValue(() => ({
    x: baseX + motion.dx.value,
    y: baseY + motion.dy.value,
  }));
  // Off-center body shading: light veil upper-left, taupe density at edge.
  const bodyCenter = useDerivedValue(() => ({
    x: baseX + motion.dx.value - baseR * 0.18 * motion.scale.value,
    y: baseY + motion.dy.value - baseR * 0.24 * motion.scale.value,
  }));
  // Champagne illumination from the upper-left — never centered.
  const illumCenter = useDerivedValue(() => ({
    x: baseX + motion.dx.value + baseR * tune.illumination.dx * motion.scale.value,
    y: baseY + motion.dy.value + baseR * tune.illumination.dy * motion.scale.value,
  }));
  const illumR = useDerivedValue(
    () => baseR * tune.illumination.radiusFraction * motion.scale.value
  );
  // Small specular, rigid with the disc — no independent motion.
  const specCenter = useDerivedValue(() => ({
    x: baseX + motion.dx.value + baseR * specular.dx * motion.scale.value,
    y: baseY + motion.dy.value + baseR * specular.dy * motion.scale.value,
  }));
  const specRx = useDerivedValue(() => baseR * specular.rx * motion.scale.value);
  const specRy = useDerivedValue(() => baseR * specular.ry * motion.scale.value);
  const specX = useDerivedValue(() => specCenter.value.x - specRx.value);
  const specY = useDerivedValue(() => specCenter.value.y - specRy.value);
  const specW = useDerivedValue(() => specRx.value * 2);
  const specH = useDerivedValue(() => specRy.value * 2);
  // Directional shade: transparent upper-left → dark lower-right.
  const shadeStart = useDerivedValue(() => ({
    x: baseX + motion.dx.value - baseR * tune.shadeDiagonal * motion.scale.value,
    y: baseY + motion.dy.value - baseR * tune.shadeDiagonal * motion.scale.value,
  }));
  const shadeEnd = useDerivedValue(() => ({
    x: baseX + motion.dx.value + baseR * tune.shadeDiagonal * motion.scale.value,
    y: baseY + motion.dy.value + baseR * tune.shadeDiagonal * motion.scale.value,
  }));
  const rimR = useDerivedValue(() => baseR * motion.scale.value - 1);

  return (
    <>
      <Circle cx={cx} cy={cy} r={r}>
        <RadialGradient
          c={bodyCenter}
          r={r}
          colors={palette.body}
          positions={palette.bodyPositions}
        />
      </Circle>
      {/* Internal darkening opposite the light source. */}
      <Circle cx={cx} cy={cy} r={r}>
        <LinearGradient
          start={shadeStart}
          end={shadeEnd}
          colors={palette.shade}
          positions={[0, 0.5, 0.78, 1]}
        />
      </Circle>
      {/* Offset champagne illumination. */}
      <Circle cx={cx} cy={cy} r={illumR}>
        <RadialGradient
          c={illumCenter}
          r={illumR}
          colors={palette.illumination}
          positions={palette.illuminationPositions}
        />
      </Circle>
      {/* Small soft specular reflection. */}
      <Oval x={specX} y={specY} width={specW} height={specH}>
        <RadialGradient
          c={specCenter}
          r={specRx}
          colors={palette.specular}
        />
      </Oval>
      {/* Diffuse outer rim light. */}
      <Circle cx={cx} cy={cy} r={rimR} style="stroke" strokeWidth={baseR * tune.rim.softWidthFraction}>
        <SweepGradient
          c={discCenter}
          start={RIM_START}
          end={RIM_END}
          colors={palette.rimSoft.colors}
          positions={palette.rimSoft.positions}
        />
      </Circle>
      {/* Faint inner refractive echo. */}
      <Circle cx={cx} cy={cy} r={rimR} style="stroke" strokeWidth={tune.rim.echoWidth}>
        <SweepGradient
          c={discCenter}
          start={RIM_ECHO_START}
          end={RIM_ECHO_END}
          colors={palette.rimEcho.colors}
          positions={palette.rimEcho.positions}
        />
      </Circle>
      {/* Crisp inner rim light. */}
      <Circle cx={cx} cy={cy} r={rimR} style="stroke" strokeWidth={tune.rim.crispWidth}>
        <SweepGradient
          c={discCenter}
          start={RIM_START}
          end={RIM_END}
          colors={palette.rimCrisp.colors}
          positions={palette.rimCrisp.positions}
        />
      </Circle>
    </>
  );
}

export type GlassOrbsProps = {
  /**
   * Explicit canvas width. When omitted, the width derives from the
   * window. Pass a measured width to let the artwork flex into leftover
   * space on fixed (non-scrolling) screens.
   */
  width?: number;
};

export function GlassOrbs({ width: widthProp }: GlassOrbsProps = {}) {
  const colorScheme = useColorScheme();
  const { width: windowWidth } = useWindowDimensions();
  const reduceMotion = useReducedMotion();
  const palette = paletteForColorScheme(colorScheme);
  const tune = OrbTuning;
  const layout = useMemo(
    () =>
      widthProp !== undefined
        ? orbLayoutForSize(Math.min(widthProp, tune.maxSize))
        : orbLayout(windowWidth),
    [widthProp, windowWidth, tune.maxSize]
  );
  const { size, height, front, rear, glow, shadowFront, shadowRear } = layout;

  const motion = useAmbientLoops(
    reduceMotion ?? false,
    palette.glowHaloRange,
    palette.glowCoreRange
  );
  const haloOpacity = reduceMotion ? palette.glowHaloRange[0] : motion.halo;
  const coreOpacity = reduceMotion ? palette.glowCoreRange[0] : motion.core;

  const shadowPlane = {
    x: size * tune.shadow.planeCxFraction,
    y: size * tune.shadow.planeCyFraction,
    rx: size * tune.shadow.planeRxFraction,
    ry: size * tune.shadow.planeRyFraction,
  };
  const orbit = {
    x: size * tune.orbit.cxFraction,
    y: size * tune.orbit.cyFraction,
    rx: size * tune.orbit.rxFraction,
    ry: size * tune.orbit.ryFraction,
  };

  return (
    <View
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
      style={styles.root}
    >
      <SkiaReady>
        {(ready) =>
          ready ? (
      <Canvas style={{ width: size, height }}>
        {/* Shared diffuse shadow plane beneath the group. */}
        <Oval
          x={shadowPlane.x - shadowPlane.rx}
          y={shadowPlane.y - shadowPlane.ry}
          width={shadowPlane.rx * 2}
          height={shadowPlane.ry * 2}
          color="#000000"
          opacity={palette.front.shadowOpacity * 0.8}
        >
          <Blur blur={tune.shadow.planeBlur} />
        </Oval>

        {/* Thin orbit line passing behind the discs. */}
        <Oval
          x={orbit.x - orbit.rx}
          y={orbit.y - orbit.ry}
          width={orbit.rx * 2}
          height={orbit.ry * 2}
          style="stroke"
          strokeWidth={tune.orbit.width}
          color={palette.orbit}
          origin={vec(orbit.x, orbit.y)}
          transform={[{ rotate: tune.orbit.tiltRadians }]}
        />

        {/* Tight cast shadow beneath the rear orb. */}
        <Oval
          x={shadowRear.x - shadowRear.rx}
          y={shadowRear.y - shadowRear.ry}
          width={shadowRear.rx * 2}
          height={shadowRear.ry * 2}
          color="#000000"
          opacity={palette.rear.shadowOpacity}
        >
          <Blur blur={tune.shadow.blur} />
        </Oval>

        {/* Rear disc, upper-right. */}
        <GlassDisc
          baseR={rear.r}
          baseX={rear.x}
          baseY={rear.y}
          palette={palette.rear}
          motion={motion.rear}
          specular={tune.rear.specular}
        />

        {/* Wide halo bleeding around the overlap. */}
        <Oval
          x={glow.x - rear.r * tune.glow.haloSize.rx}
          y={glow.y - rear.r * tune.glow.haloSize.ry}
          width={rear.r * tune.glow.haloSize.rx * 2}
          height={rear.r * tune.glow.haloSize.ry * 2}
          opacity={haloOpacity}
        >
          <RadialGradient
            c={vec(glow.x, glow.y)}
            r={rear.r * tune.glow.haloRadiusFraction}
            colors={palette.glowHalo}
          />
        </Oval>

        {/* Tight cast shadow beneath the foreground orb. */}
        <Oval
          x={shadowFront.x - shadowFront.rx}
          y={shadowFront.y - shadowFront.ry}
          width={shadowFront.rx * 2}
          height={shadowFront.ry * 2}
          color="#000000"
          opacity={palette.front.shadowOpacity}
        >
          <Blur blur={tune.shadow.blur} />
        </Oval>

        {/* Foreground disc, lower-left. */}
        <GlassDisc
          baseR={front.r}
          baseX={front.x}
          baseY={front.y}
          palette={palette.front}
          motion={motion.front}
          specular={tune.front.specular}
        />

        {/* Bright core on top: light passing through overlapping glass. */}
        <Oval
          x={glow.x - rear.r * tune.glow.coreSize.rx}
          y={glow.y - rear.r * tune.glow.coreSize.ry}
          width={rear.r * tune.glow.coreSize.rx * 2}
          height={rear.r * tune.glow.coreSize.ry * 2}
          opacity={coreOpacity}
        >
          <RadialGradient
            c={vec(glow.x, glow.y)}
            r={rear.r * tune.glow.coreRadiusFraction}
            colors={palette.glowCore}
            positions={[0, 0.55, 1]}
          />
        </Oval>
      </Canvas>
          ) : (
            <View style={{ width: size, height }} />
          )
        }
      </SkiaReady>
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    width: '100%',
    alignItems: 'center',
    justifyContent: 'center',
  },
});

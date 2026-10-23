import { LinearGradient, Rect, Shader, Skia, type SkRuntimeEffect, vec } from '@shopify/react-native-skia';
import { useDerivedValue, type SharedValue } from 'react-native-reanimated';

import type { SplashMotif } from '@/components/splash/animated-intro';
import type { BeachThemeColors } from '@/constants/theme-presets';

// The compact sky's material vocabulary, with a finite opening instead of a perpetual clock.
export const SPLASH_MATERIAL_SKSL = `
uniform float2 uSize;
uniform float4 uBase;
uniform float4 uSurface;
uniform float4 uInk;
uniform float4 uAccent;
uniform float4 uPartner;
uniform float uKind;
uniform float uLayer;
uniform float uProgress;

float hash(float2 p) {
  p = fract(p * float2(123.34, 456.21));
  p += dot(p, p + 45.32);
  return fract(p.x * p.y);
}
float noise(float2 p) {
  float2 i = floor(p), f = fract(p);
  float2 u = f * f * (3.0 - 2.0 * f);
  return mix(mix(hash(i), hash(i + float2(1, 0)), u.x),
    mix(hash(i + float2(0, 1)), hash(i + float2(1, 1)), u.x), u.y);
}
float grain(float2 p) {
  return noise(p) * 0.57 + noise(p * 2.03) * 0.28 + noise(p * 4.11) * 0.15;
}
half4 main(float2 xy) {
  float2 uv = xy / uSize;
  float p = clamp(uProgress, 0.0, 1.0);
  float settle = 1.0 - pow(1.0 - p, 3.0);
  float3 col = uBase.rgb;
  float alpha = 1.0;
  float dust = hash(xy);

  if (uLayer > 0.5) {
    // A feathered miniature has no rectangular canvas edge.
    float vignette = 1.0 - smoothstep(0.5, 1.0, length((uv - 0.5) * float2(2.15, 2.2)));
    float bed = grain(xy * 0.042);
    col = mix(uBase.rgb, uSurface.rgb, 0.42 + bed * 0.4);
    col = mix(col, uPartner.rgb, dust * 0.035);
    alpha = vignette * 0.8;
    if (uLayer > 1.5) {
      float retreat = smoothstep(0.08, 0.95, p);
      float edge = -0.32 + retreat * 1.65 + sin(uv.x * 8.0 + p * 2.0) * 0.08
        + (grain(float2(xy.x * 0.03, 7.0)) - 0.5) * 0.09;
      float depth = uv.y - edge;
      float water = smoothstep(-0.025, 0.035, depth);
      float2 refr = uv * 16.0 + float2(sin(uv.y * 21.0 + p * 4.0), cos(uv.x * 19.0 - p * 3.0));
      float caustic = pow(1.0 - abs(sin(refr.x + sin(refr.y)) * cos(refr.y + cos(refr.x))), 8.0);
      col = mix(uSurface.rgb, uAccent.rgb, 0.42 + grain(xy * 0.028 + p) * 0.22);
      col = mix(col, uInk.rgb, 0.06);
      col = mix(col, uSurface.rgb, caustic * 0.3);
      float foam = exp(-abs(depth) * 70.0) * (0.55 + noise(xy * 0.19) * 0.45);
      col = mix(col, uSurface.rgb, foam);
      alpha = vignette * max(water * 0.96, foam);
    }
  } else if (uKind < 0.5) {
    float haze = grain(uv * float2(3.0, 4.0) + float2(p * 0.25, 0));
    float light = exp(-length((uv - float2(0.28, 0.36)) * float2(3.0, 2.8)));
    float other = exp(-length((uv - float2(0.76, 0.38)) * float2(3.2, 3.0)));
    col = mix(col, uAccent.rgb, light * (0.035 + haze * 0.09));
    col = mix(col, uPartner.rgb, other * (0.035 + haze * 0.085));
    float2 cell = floor(xy / 28.0);
    float seed = hash(cell);
    float2 star = (cell + float2(hash(cell + 2.0), hash(cell + 8.0))) * 28.0;
    float reveal = smoothstep(seed * 0.55, seed * 0.55 + 0.3, p);
    float spark = exp(-distance(xy, star) * 2.6) * step(0.58, seed) * reveal;
    float quiet = 1.0 - (1.0 - smoothstep(0.14, 0.34, abs(uv.x - 0.5)))
      * (1.0 - smoothstep(0.08, 0.25, abs(uv.y - 0.49)));
    col = mix(col, mix(uInk.rgb, uPartner.rgb, seed), spark * quiet * 0.75);
  } else if (uKind < 3.5) {
    float shore = 0.78 + sin(uv.x * 6.0 + 0.8) * 0.025 + (1.0 - settle) * 0.09;
    float depth = uv.y - shore;
    float water = smoothstep(-0.015, 0.04, depth);
    float bed = grain(xy * 0.022);
    col = mix(col, uSurface.rgb, smoothstep(0.58, 1.0, uv.y) * (0.14 + bed * 0.32));
    float2 refr = uv * float2(17.0, 24.0) + float2(p * 0.8, p * 1.1);
    float caustic = pow(1.0 - abs(sin(refr.x + sin(refr.y)) * cos(refr.y + cos(refr.x))), 9.0);
    float ripple = sin(uv.y * 130.0 + sin(uv.x * 24.0 + p * 3.0) * 3.0 - p * 4.0);
    float3 sea = mix(uSurface.rgb, uAccent.rgb, 0.24 + bed * 0.15);
    sea = mix(sea, uSurface.rgb, caustic * 0.22 + max(0.0, ripple) * 0.06);
    float foam = exp(-abs(depth) * 150.0) * (0.25 + noise(xy * 0.12) * 0.6);
    col = mix(col, sea, water * 0.7);
    col = mix(col, uSurface.rgb, foam * 0.65);
    if (uKind > 1.5 && uKind < 2.5) {
      float reflection = exp(-pow((uv.x - 0.5) * 8.0, 2.0)) * water;
      col = mix(col, uPartner.rgb, reflection * (0.15 + max(0.0, ripple) * 0.13));
    }
  } else {
    col = mix(col, uSurface.rgb, grain(xy * 0.03) * 0.13);
  }
  col += (dust - 0.5) / 255.0;
  return half4(half3(clamp(col, 0.0, 1.0) * alpha), half(alpha));
}
`;

const KINDS = { constellation: 0, shell: 1, sunset: 2, tide: 3, keepsake: 4 } satisfies Record<SplashMotif, number>;
let effect: SkRuntimeEffect | null | undefined;

function materialEffect() {
  if (effect !== undefined) return effect;
  try {
    effect = Skia.RuntimeEffect.Make(SPLASH_MATERIAL_SKSL);
  } catch {
    effect = null;
  }
  return effect;
}

function rgba(hex: string) {
  return [1, 3, 5].map((offset) => parseInt(hex.slice(offset, offset + 2), 16) / 255).concat(1);
}

export function shellTones(colors: BeachThemeColors, partner: boolean) {
  const base = rgba(colors.background);
  const night = base[0] * 0.2126 + base[1] * 0.7152 + base[2] * 0.0722 < 0.4;
  const pearl = rgba(night ? colors.textPrimary : colors.surface);
  const tint = rgba(partner ? colors.partnerAccent : colors.accent);
  const mix = (amount: number) => `#${pearl.slice(0, 3).map((channel, index) =>
    Math.round((channel * (1 - amount) + tint[index] * amount) * 255).toString(16).padStart(2, '0')).join('')}`;
  return { light: mix(night ? 0.1 : 0), body: mix(night ? 0.28 : 0.16), shade: mix(night ? 0.55 : 0.38) };
}

export function splashMaterialUniforms(colors: BeachThemeColors, motif: SplashMotif, width: number, height: number, layer: number) {
  return {
    uSize: [width, height], uBase: rgba(colors.background), uSurface: rgba(colors.surface2),
    uInk: rgba(colors.textPrimary), uAccent: rgba(colors.accent), uPartner: rgba(colors.partnerAccent),
    uKind: KINDS[motif], uLayer: layer,
  };
}

export function SplashMaterial({ colors, motif, width, height, progress, layer = 0 }: {
  colors: BeachThemeColors;
  motif: SplashMotif;
  width: number;
  height: number;
  progress: SharedValue<number>;
  layer?: 0 | 1 | 2;
}) {
  const source = materialEffect();
  const base = splashMaterialUniforms(colors, motif, width, height, layer);
  const uniforms = useDerivedValue(() => ({ ...base, uProgress: progress.value }));

  if (!source && layer !== 0) return null;

  return (
    <Rect x={0} y={0} width={width} height={height}>
      {source ? <Shader source={source} uniforms={uniforms} /> : (
        <LinearGradient start={vec(0, 0)} end={vec(width, height)} colors={[colors.background, colors.surface2, colors.background]} />
      )}
    </Rect>
  );
}

import { describe, expect, it } from 'vitest';

import { LIGHT_SKY_MID, LIGHT_SKY_TOP } from '@/components/home/sky-palette';
import { BeachThemes } from '@/constants/theme-presets';

function rgb(hex: string): [number, number, number] {
  return [
    parseInt(hex.slice(1, 3), 16),
    parseInt(hex.slice(3, 5), 16),
    parseInt(hex.slice(5, 7), 16),
  ];
}

function hue(hex: string): number {
  const [r, g, b] = rgb(hex).map((value) => value / 255);
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  if (max === min) {
    return 0;
  }
  const delta = max - min;
  let h: number;
  if (max === r) {
    h = ((g - b) / delta) % 6;
  } else if (max === g) {
    h = (b - r) / delta + 2;
  } else {
    h = (r - g) / delta + 4;
  }
  return (h * 60 + 360) % 360;
}

function hueDistance(a: number, b: number): number {
  const diff = Math.abs(a - b) % 360;
  return diff > 180 ? 360 - diff : diff;
}

function lightness(hex: string): number {
  const [r, g, b] = rgb(hex).map((value) => value / 255);
  return (Math.max(r, g, b) + Math.min(r, g, b)) / 2;
}

function mix(a: string, b: string, t: number): string {
  const ca = rgb(a);
  const cb = rgb(b);
  const out = ca.map((value, index) => Math.round(value + (cb[index] - value) * t));
  return `#${out.map((value) => value.toString(16).padStart(2, '0')).join('')}`;
}

describe('light sky palette blends into the paper', () => {
  const paper = BeachThemes['after-hours'].light.background;

  it('keeps the mid in the same hue family as the paper (no gray crossing)', () => {
    // The old pink-mauve mid was ~44° off the paper's violet, so the blend
    // went gray. Keep it within 25°.
    expect(hueDistance(hue(LIGHT_SKY_MID), hue(paper))).toBeLessThan(25);
  });

  it('holds hue through the mid → paper blend', () => {
    const midpoint = mix(LIGHT_SKY_MID, paper, 0.5);
    expect(hueDistance(hue(midpoint), hue(paper))).toBeLessThan(25);
  });

  it('darkens monotonically from paper up to the top of the sky', () => {
    expect(lightness(paper)).toBeGreaterThan(lightness(LIGHT_SKY_MID));
    expect(lightness(LIGHT_SKY_MID)).toBeGreaterThan(lightness(LIGHT_SKY_TOP));
  });
});

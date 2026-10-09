import { describe, expect, it } from 'vitest';

import {
  THEME_SKY_RAMPS,
  skyStopsForTheme,
} from '@/components/home/sky-palette';
import { BeachThemeOrder, BeachThemes } from '@/constants/theme-presets';

function rgb(hex: string): [number, number, number] {
  const body = hex.replace('#', '').slice(0, 6);
  return [
    parseInt(body.slice(0, 2), 16),
    parseInt(body.slice(2, 4), 16),
    parseInt(body.slice(4, 6), 16),
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

describe('per-theme sky ramps', () => {
  it('covers every theme in both modes', () => {
    for (const id of BeachThemeOrder) {
      expect(THEME_SKY_RAMPS[id]).toBeDefined();
      expect(THEME_SKY_RAMPS[id].light.top).toMatch(/^#[0-9a-fA-F]{6}$/);
      expect(THEME_SKY_RAMPS[id].light.mid).toMatch(/^#[0-9a-fA-F]{6}$/);
      expect(THEME_SKY_RAMPS[id].dark.top).toMatch(/^#[0-9a-fA-F]{6}$/);
      expect(THEME_SKY_RAMPS[id].dark.mid).toMatch(/^#[0-9a-fA-F]{6}$/);
    }
  });

  it('gives every non-after-hours theme its own dusk', () => {
    const canonical = THEME_SKY_RAMPS['after-hours'];
    for (const id of BeachThemeOrder) {
      if (id === 'after-hours') {
        continue;
      }
      const ramp = THEME_SKY_RAMPS[id];
      expect(
        ramp.light.top !== canonical.light.top ||
          ramp.light.mid !== canonical.light.mid,
      ).toBe(true);
      expect(
        ramp.dark.top !== canonical.dark.top ||
          ramp.dark.mid !== canonical.dark.mid,
      ).toBe(true);
    }
  });

  it('keeps each light mid in the same hue family as its own paper (no gray crossing)', () => {
    for (const id of BeachThemeOrder) {
      const paper = BeachThemes[id].light.background;
      const mid = THEME_SKY_RAMPS[id].light.mid;
      expect(hueDistance(hue(mid), hue(paper))).toBeLessThan(30);
    }
  });

  it('darkens monotonically from paper up through the light sky', () => {
    for (const id of BeachThemeOrder) {
      const paper = BeachThemes[id].light.background;
      const { top, mid } = THEME_SKY_RAMPS[id].light;
      expect(lightness(paper)).toBeGreaterThan(lightness(mid));
      expect(lightness(mid)).toBeGreaterThan(lightness(top));
    }
  });

  it('darkens monotonically from background up through the dark sky', () => {
    for (const id of BeachThemeOrder) {
      const background = BeachThemes[id].dark.background;
      const { top, mid } = THEME_SKY_RAMPS[id].dark;
      expect(lightness(background)).toBeGreaterThanOrEqual(lightness(top));
      expect(lightness(mid)).toBeGreaterThan(lightness(top));
    }
  });

  it('resolves stops per theme and falls back to after-hours for unknown ids', () => {
    expect(skyStopsForTheme('sea-glass', 'light')).toEqual(
      THEME_SKY_RAMPS['sea-glass'].light,
    );
    expect(skyStopsForTheme('deep-ocean', 'dark')).toEqual(
      THEME_SKY_RAMPS['deep-ocean'].dark,
    );
    expect(skyStopsForTheme('nope', 'light')).toEqual(
      THEME_SKY_RAMPS['after-hours'].light,
    );
    expect(skyStopsForTheme('nope', 'dark')).toEqual(
      THEME_SKY_RAMPS['after-hours'].dark,
    );
  });
});

import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { createElement } from 'react';

import {
  DARK_ORBS,
  GlassOrbs,
  LIGHT_ORBS,
  ORB_ASPECT,
  OrbTuning,
  RIM_END,
  RIM_START,
  orbLayout,
  paletteForColorScheme,
} from '@/components/landing/glass-orbs';

function parseColor(color: string): [number, number, number, number] {
  const hex = color.match(/^#([0-9a-f]{6})$/i);
  if (hex) {
    const v = parseInt(hex[1], 16);
    return [(v >> 16) & 255, (v >> 8) & 255, v & 255, 1];
  }
  const rgba = color.match(
    /^rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)(?:\s*,\s*([\d.]+))?/i
  );
  if (rgba) {
    return [Number(rgba[1]), Number(rgba[2]), Number(rgba[3]), Number(rgba[4] ?? 1)];
  }
  throw new Error(`unparseable test color: ${color}`);
}

function lightness([r, g, b]: [number, number, number, number]): number {
  return (Math.max(r, g, b) + Math.min(r, g, b)) / 2 / 255;
}

describe('orbLayout', () => {
  it('sizes relative to the available width', () => {
    // tests/setup.ts mocks a 390pt window: 390 - 48 page margins.
    expect(orbLayout(390).size).toBe(342);
    expect(orbLayout(390).height).toBeCloseTo(342 * 0.72, 6);
  });

  it('caps the size on large screens', () => {
    expect(orbLayout(1024).size).toBe(480);
  });

  it('keeps the front orb near 40% and the rear near 38% of the width', () => {
    const layout = orbLayout(390);
    expect((layout.front.r * 2) / layout.size).toBeCloseTo(0.4, 2);
    expect((layout.rear.r * 2) / layout.size).toBeCloseTo(0.38, 2);
  });

  it('places the rear disc upper-right and the front disc lower-left', () => {
    const layout = orbLayout(390);
    expect(layout.rear.x).toBeGreaterThan(layout.front.x);
    expect(layout.rear.y).toBeLessThan(layout.front.y);
  });

  it('overlaps the two discs so the glow has something to sit in', () => {
    const layout = orbLayout(390);
    const dx = layout.rear.x - layout.front.x;
    const dy = layout.front.y - layout.rear.y;
    const distance = Math.hypot(dx, dy);
    expect(distance).toBeGreaterThan(0);
    expect(distance).toBeLessThan(layout.front.r + layout.rear.r);
  });

  it('centers the glow between the discs', () => {
    const layout = orbLayout(390);
    expect(layout.glow.x).toBeGreaterThan(layout.front.x);
    expect(layout.glow.x).toBeLessThan(layout.rear.x);
    expect(layout.glow.y).toBeGreaterThan(layout.rear.y);
    expect(layout.glow.y).toBeLessThan(layout.front.y);
  });

  it('puts a cast shadow beneath each disc', () => {
    const layout = orbLayout(390);
    expect(layout.shadowFront.y).toBeGreaterThan(layout.front.y + layout.front.r * 0.9);
    expect(layout.shadowRear.y).toBeGreaterThan(layout.rear.y + layout.rear.r * 0.9);
  });
});

describe('OrbTuning', () => {
  it('drives layout geometry instead of scattered constants', () => {
    const layout = orbLayout(390);
    expect(layout.height).toBeCloseTo(layout.size * ORB_ASPECT, 6);
    expect(layout.front.r).toBeCloseTo(layout.size * OrbTuning.front.radiusFraction, 6);
    expect(layout.rear.r).toBeCloseTo(layout.size * OrbTuning.rear.radiusFraction, 6);
    expect(layout.rear.x).toBeCloseTo(
      layout.front.x + layout.size * OrbTuning.overlap.dxFraction,
      6
    );
    expect(layout.rear.y).toBeCloseTo(
      layout.front.y + layout.size * OrbTuning.overlap.dyFraction,
      6
    );
  });

  it('keeps animation loops slow with small amplitudes', () => {
    const { rear, front, haloDuration, coreDuration } = OrbTuning.motion;
    for (const disc of [rear, front]) {
      expect(disc.xAmplitude).toBeLessThanOrEqual(5);
      expect(disc.yAmplitude).toBeLessThanOrEqual(5);
      for (const duration of [disc.xDuration, disc.yDuration, disc.scaleDuration]) {
        expect(duration).toBeGreaterThanOrEqual(7000);
        expect(duration).toBeLessThanOrEqual(10000);
      }
      expect(Math.abs(disc.scaleTo - disc.scaleFrom)).toBeLessThan(0.02);
    }
    expect(haloDuration).toBeGreaterThanOrEqual(7000);
    expect(coreDuration).toBeLessThanOrEqual(10000);
  });
});

describe('paletteForColorScheme', () => {
  it('selects the dark palette only for dark mode', () => {
    expect(paletteForColorScheme('dark')).toBe(DARK_ORBS);
    expect(paletteForColorScheme('light')).toBe(LIGHT_ORBS);
    expect(paletteForColorScheme(null)).toBe(LIGHT_ORBS);
    expect(paletteForColorScheme(undefined)).toBe(LIGHT_ORBS);
  });

  it('keeps light glass translucent with taupe edge density', () => {
    for (const disc of [LIGHT_ORBS.front, LIGHT_ORBS.rear]) {
      // Core lets the ivory background breathe through.
      expect(parseColor(disc.body[0])[3]).toBeLessThan(0.6);
      // Edge carries gray/taupe density so the disc reads on ivory.
      const edge = parseColor(disc.body[disc.body.length - 1]);
      expect(edge[3]).toBeGreaterThan(0.6);
      expect(lightness(edge)).toBeLessThan(0.85);
      // Warm cast: red leads, blue trails.
      expect(edge[0]).toBeGreaterThanOrEqual(edge[1]);
      expect(edge[1]).toBeGreaterThanOrEqual(edge[2]);
    }
  });

  it('keeps dark glass smoky rather than inverted ivory', () => {
    for (const disc of [DARK_ORBS.front, DARK_ORBS.rear]) {
      for (const color of disc.body) {
        expect(lightness(parseColor(color))).toBeLessThan(0.45);
      }
    }
  });

  it('keeps the interaction glow champagne, brightest at its core', () => {
    for (const palette of [LIGHT_ORBS, DARK_ORBS]) {
      const halo = parseColor(palette.glowHalo[0]);
      const core = parseColor(palette.glowCore[0]);
      // Champagne, never orange: green stays high, blue stays present.
      expect(halo[0]).toBe(255);
      expect(halo[1]).toBeGreaterThan(180);
      expect(halo[2]).toBeGreaterThan(110);
      // Core is the brightest optical area.
      expect(lightness(core)).toBeGreaterThan(lightness(halo));
      for (const [min, max] of [palette.glowHaloRange, palette.glowCoreRange]) {
        expect(min).toBeGreaterThanOrEqual(0);
        expect(max).toBeLessThanOrEqual(1);
        expect(max).toBeGreaterThan(min);
      }
    }
  });

  it('confines the rim sweep to part of the circumference', () => {
    expect(RIM_START).toBeGreaterThanOrEqual(180);
    expect(RIM_END).toBeLessThanOrEqual(360);
    expect(RIM_END - RIM_START).toBeLessThan(200);
  });
});

describe('GlassOrbs', () => {
  it('renders the full layer stack: bodies, shading, rims, glow, shadows', () => {
    const { container } = render(createElement(GlassOrbs));
    expect(screen.getByTestId('skia-canvas')).toBeTruthy();
    // Per disc: body + directional shade + illumination + 3 rim rings.
    expect(container.querySelectorAll('[data-skia="Circle"]').length).toBe(12);
    // Per disc: specular + cast shadow; shared: plane + orbit + halo + core.
    expect(container.querySelectorAll('[data-skia="Oval"]').length).toBe(8);
  });

  it('sizes the canvas from the window width', () => {
    render(createElement(GlassOrbs));
    const canvas = screen.getByTestId('skia-canvas') as HTMLElement;
    expect(canvas.style.width).toBe('342px');
  });
});

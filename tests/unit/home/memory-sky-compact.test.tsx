import { readFileSync } from 'node:fs';
import { act, render } from '@testing-library/react';
import { createElement } from 'react';
import * as Reanimated from 'react-native-reanimated';
import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  COMPACT_SKY_PEAK,
  MEMORY_SKY_AMBIENT_COUNT,
  MEMORY_SKY_COMPACT_CLOUD_BOTTOM_CLEARANCE,
  MEMORY_SKY_COMPACT_CLOUD_B_TOP,
  MEMORY_SKY_COMPACT_CLOUD_SCALE,
  MEMORY_SKY_COMPACT_GRADIENT_POSITIONS,
  MEMORY_SKY_COMPACT_QUARTER,
  MEMORY_SKY_COMPACT_STAR_FADE_BAND,
  MEMORY_SKY_COMPACT_TWINKLE_MIN_OPACITY,
  MEMORY_SKY_HORIZON_GLOW,
  MEMORY_SKY_TOP_SAFETY,
  MEMORY_SKY_FEATHER_ALPHAS,
  MEMORY_SKY_FEATHER_FRACTION,
  MEMORY_SKY_FEATHER_POSITIONS,
  MEMORY_SKY_QUARTER,
  MemorySky,
  ambientStarForIndex,
  ambientStarOpacity,
  backgroundAtAlpha,
  compactSkyGradientColors,
  compactSkyGradientPositions,
  compactSkyHeightForWindow,
  duskSkyUniforms,
  fadeCompactStarOpacity,
  featherVeilColors,
  isCompactTwinkleEligible,
  skyGlowColors,
  skyGlowGeometry,
  sparklePath,
} from '@/components/home/memory-sky';

vi.mock('@/hooks/use-theme-color', () => ({
  useThemeColor: (_overrides: unknown, name: string) => {
    const map: Record<string, string> = {
      background: 'rgb(246, 242, 247)',
      muted: 'rgb(113, 91, 107)',
      accent: 'rgb(142, 54, 89)',
      partnerAccent: 'rgb(103, 82, 133)',
      onAccent: 'rgb(255, 248, 250)',
    };
    return map[name] ?? 'rgb(0, 0, 0)';
  },
}));

vi.mock('react-native-safe-area-context', () => ({
  useSafeAreaInsets: () => ({ top: 47, bottom: 0, left: 0, right: 0 }),
}));

vi.mock('@/components/themed-text', () => ({
  ThemedText: ({ children, style }: any) => {
    const React = require('react');
    const flat = Array.isArray(style)
      ? Object.assign({}, ...style.filter(Boolean))
      : style;
    return React.createElement('span', { style: flat }, children);
  },
}));

const SOURCE = readFileSync('components/home/memory-sky.tsx', 'utf8');
const INDEX_SOURCE = readFileSync('app/(app)/(tabs)/(memories)/index.tsx', 'utf8');
const MEMORIES_LAYOUT_SOURCE = readFileSync('app/(app)/(tabs)/(memories)/_layout.tsx', 'utf8');
const PLANS_SOURCE = readFileSync('app/(app)/(tabs)/plans.tsx', 'utf8');
const HEADER_SOURCE = readFileSync('components/ui/screen-header.tsx', 'utf8');
const TOGETHER_SOURCE = readFileSync('app/(app)/(tabs)/together.tsx', 'utf8');

function makeMoment(id: string) {
  return {
    id,
    type: 'note' as const,
    title: `Title ${id}`,
    body: 'body',
    occurredAt: '2026-02-08T09:15:00.000Z',
    createdAt: '2026-02-08T09:16:00.000Z',
    authorId: 'user_partner',
    authorRole: 'partner' as const,
    authorName: 'Alex',
  };
}

function skyRoot(container: HTMLElement): HTMLElement | null {
  return container.querySelector(
    '[data-testid="memory-sky"], [testid="memory-sky"]',
  ) as HTMLElement | null;
}

function skyStrip(container: HTMLElement): HTMLElement | null {
  return container.querySelector(
    '[data-testid="memory-sky-strip"], [testid="memory-sky-strip"]',
  ) as HTMLElement | null;
}

function skyCanvas(container: HTMLElement): HTMLElement | null {
  return container.querySelector(
    '[data-testid="skia-canvas"], [testid="skia-canvas"]',
  ) as HTMLElement | null;
}

function feather(container: HTMLElement): HTMLElement | null {
  return container.querySelector(
    '[data-testid="memory-sky-feather"], [testid="memory-sky-feather"]',
  ) as HTMLElement | null;
}

function cloudById(container: HTMLElement, id: string): HTMLElement | null {
  return container.querySelector(
    `[data-testid="${id}"], [testid="${id}"]`,
  ) as HTMLElement | null;
}

function canvases(container: HTMLElement): HTMLElement[] {
  return Array.from(
    container.querySelectorAll('[data-testid="skia-canvas"], [testid="skia-canvas"]'),
  ) as HTMLElement[];
}

function starTotal(canvas: HTMLElement): number {
  const dots = canvas.querySelectorAll('[data-skia="Circle"]').length;
  const groups = canvas.querySelectorAll('[data-skia="Group"]').length;
  // 3 bucket Groups + 1 feather Rect? Feather is a separate canvas, so only buckets here.
  return dots + Math.max(0, groups - 3);
}

function twinkleOverlay(container: HTMLElement): HTMLElement | null {
  return container.querySelector(
    '[data-testid="memory-sky-twinkle"], [testid="memory-sky-twinkle"]',
  ) as HTMLElement | null;
}

/** Channels of a `#rrggbb`, `#rrggbbaa` or `rgba()` colour the sky produces. */
function channelsOf(colour: string): { r: number; g: number; b: number; a: number } {
  const hex = colour.match(/^#([0-9a-fA-F]{6})([0-9a-fA-F]{2})?$/);
  if (hex) {
    return {
      r: parseInt(hex[1].slice(0, 2), 16),
      g: parseInt(hex[1].slice(2, 4), 16),
      b: parseInt(hex[1].slice(4, 6), 16),
      a: hex[2] ? parseInt(hex[2], 16) / 255 : 1,
    };
  }
  const fn = colour.match(
    /rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)\s*(?:,\s*([\d.]+))?\)/,
  );
  if (!fn) throw new Error(`unparseable sky colour: ${colour}`);
  return {
    r: Number(fn[1]),
    g: Number(fn[2]),
    b: Number(fn[3]),
    a: fn[4] === undefined ? 1 : Number(fn[4]),
  };
}

const alphaOf = (colour: string) => channelsOf(colour).a;

/** Relative luminance of the colour itself, alpha ignored. */
function luminanceOf(colour: string): number {
  const { r, g, b } = channelsOf(colour);
  const linear = (value: number) => {
    const s = value / 255;
    return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
  };
  return 0.2126 * linear(r) + 0.7152 * linear(g) + 0.0722 * linear(b);
}

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe('MemorySky compact backdrop (Memories/Plans)', () => {
  it('restores the full Us sky without enlarging compact working-screen skies', () => {
    const immersive = render(createElement(MemorySky, { moments: [], compact: true, immersive: true }));
    const compact = render(createElement(MemorySky, { moments: [], compact: true }));
    const immersiveRoot = skyRoot(immersive.container) as HTMLElement;
    const immersiveStrip = skyStrip(immersive.container) as HTMLElement;
    expect(parseFloat(immersiveStrip.style.height)).toBe(265);
    expect(immersiveRoot.style.position).not.toBe('absolute');
    expect(parseFloat(immersiveRoot.style.height)).toBe(138);
    expect(parseFloat(immersiveStrip.style.top)).toBeLessThan(0);
    expect(parseFloat((skyStrip(compact.container) as HTMLElement).style.height)).toBe(139);
    immersive.unmount();
    compact.unmount();
  });
  it('is half the Us viewport fraction with the same top safety', () => {
    expect(MEMORY_SKY_COMPACT_QUARTER).toBe(MEMORY_SKY_QUARTER / 2);
    expect(MEMORY_SKY_QUARTER).toBe(0.3);
    const full = render(createElement(MemorySky, { moments: [makeMoment('m-1')] }));
    const compact = render(
      createElement(MemorySky, { moments: [makeMoment('m-1')], compact: true }),
    );
    const fullH = parseFloat((skyStrip(full.container) as HTMLElement).style.height);
    const compactH = parseFloat((skyStrip(compact.container) as HTMLElement).style.height);
    // Mocked window 844: full 253+12=265, compact 127+12=139.
    expect(fullH).toBe(265);
    expect(compactH).toBe(139);
    expect(compactH).toBeLessThan(fullH);
    expect(compactH).toBeGreaterThan(fullH / 3);
    full.unmount();
    compact.unmount();
  });

  it('renders the same live model (canvas height only, no truncation)', () => {
    const moments = [makeMoment('a'), makeMoment('b'), makeMoment('c')];
    const full = render(
      createElement(MemorySky, {
        moments,
        daysTogether: 5,
        startDate: '2026-02-08',
        now: new Date(2026, 5, 1),
      }),
    );
    const compact = render(
      createElement(MemorySky, {
        moments,
        daysTogether: 5,
        startDate: '2026-02-08',
        now: new Date(2026, 5, 1),
        compact: true,
      }),
    );
    expect(starTotal(skyCanvas(full.container) as HTMLElement)).toBe(5);
    expect(starTotal(skyCanvas(compact.container) as HTMLElement)).toBe(5);
    full.unmount();
    compact.unmount();
  });

  it('hides every caption in compact (no duplicate day caption, no spacer)', () => {
    const day = render(
      createElement(MemorySky, {
        moments: [],
        daysTogether: 5,
        startDate: '2026-02-08',
        now: new Date(2026, 5, 1),
        compact: true,
      }),
    );
    expect(day.container.textContent).not.toContain('lighting your sky');
    expect(day.container.textContent).not.toContain('Keep your first memory');
    day.unmount();

    const mem = render(
      createElement(MemorySky, { moments: [makeMoment('x')], compact: true }),
    );
    expect(mem.container.textContent).not.toContain('lighting your sky');
    mem.unmount();

    const full = render(
      createElement(MemorySky, {
        moments: [],
        daysTogether: 5,
        startDate: '2026-02-08',
        now: new Date(2026, 5, 1),
      }),
    );
    expect(full.container.textContent).toContain('5 days lighting your sky');
    full.unmount();
  });

  it('anchors compact as absolute root top0 left0 right0 with inner sky top0 left0 right0 (Us keeps nested offsets)', () => {
    const compactView = render(
      createElement(MemorySky, { moments: [makeMoment('m-1')], compact: true }),
    );
    const root = skyRoot(compactView.container) as HTMLElement;
    const strip = skyStrip(compactView.container) as HTMLElement;
    expect(root).not.toBeNull();
    expect(strip).not.toBeNull();
    // Absolute root behind content: full bleed, no layout spacer.
    expect(root.style.position).toBe('absolute');
    expect(parseFloat(root.style.top)).toBe(0);
    expect(parseFloat(root.style.left)).toBe(0);
    expect(parseFloat(root.style.right)).toBe(0);
    expect(parseFloat(root.style.height)).toBe(139);
    // Internal sky has no dependence on toolbar height or insets.
    expect(strip.style.position).toBe('absolute');
    expect(parseFloat(strip.style.top)).toBe(0);
    expect(parseFloat(strip.style.left)).toBe(0);
    expect(parseFloat(strip.style.right)).toBe(0);
    expect(parseFloat(strip.style.height)).toBe(139);
    compactView.unmount();

    const fullView = render(createElement(MemorySky, { moments: [makeMoment('m-1')] }));
    const fullStrip = skyStrip(fullView.container) as HTMLElement;
    // Us retains the nested header-stacking geometry (negative top, -16 bleed).
    expect(parseFloat(fullStrip.style.top)).toBeLessThanOrEqual(-47);
    expect(fullStrip.style.left).toBe('-16px');
    expect(fullStrip.style.right).toBe('-16px');
    fullView.unmount();

    expect(SOURCE).toContain('rootCompact');
    expect(SOURCE).toContain('top: 0');
  });

  it('feathers every sky with the same-background alpha veil (compact included)', () => {
    expect(MEMORY_SKY_FEATHER_FRACTION).toBeGreaterThan(0.2);
    expect(MEMORY_SKY_FEATHER_FRACTION).toBeLessThan(0.5);
    expect([...MEMORY_SKY_FEATHER_ALPHAS]).toEqual([0, 0.05, 0.25, 0.65, 1]);
    expect([...MEMORY_SKY_FEATHER_POSITIONS]).toEqual([0, 0.35, 0.62, 0.85, 1]);
    const full = render(createElement(MemorySky, { moments: [makeMoment('f-1')] }));
    expect(feather(full.container)).not.toBeNull();
    expect(canvases(full.container)).toHaveLength(2);
    full.unmount();
    const { container, unmount } = render(
      createElement(MemorySky, { moments: [makeMoment('f-1')], compact: true }),
    );
    // Compact must NOT veil: the page behind it is a tinted backdrop, so an
    // opaque background veil would paint a mismatched band.
    expect(feather(container)).toBeNull();
    expect(canvases(container)).toHaveLength(1);
    expect(SOURCE).toContain('memory-sky-feather');
    expect(SOURCE).toContain('featherVeilColors');
    expect(SOURCE).toContain('backgroundAtAlpha');
    expect(SOURCE).toContain('MEMORY_SKY_FEATHER_POSITIONS');
    // No abrupt top edge and no literal transparent (black RGB) in the veil.
    expect(SOURCE).not.toContain("colors={['transparent', background]}");
    expect(SOURCE).toContain('overflow');
    expect(SOURCE).toContain('hidden');
    expect(SOURCE).not.toMatch(/<BlurView[\s/>]/);
    expect(SOURCE).not.toContain('expo-blur');
    unmount();
  });

  it('compact keeps its same-hue gradient and eases out through the veil', () => {
    // A monotonic ramp that turns at the band's peak and lands on the page.
    const positions = [...MEMORY_SKY_COMPACT_GRADIENT_POSITIONS];
    expect(positions[0]).toBe(0);
    expect(positions[positions.length - 1]).toBe(1);
    expect(positions[3]).toBeCloseTo(COMPACT_SKY_PEAK);
    for (let i = 1; i < positions.length; i += 1) {
      expect(positions[i]).toBeGreaterThan(positions[i - 1]);
    }
    // The turn is a parameter, because an opened sky has to keep its dark
    // down past the words: the dusk is lightest where it turns.
    const opened = compactSkyGradientPositions(0.78);
    expect(opened[3]).toBeCloseTo(0.78);
    expect(opened[opened.length - 1]).toBe(1);
    expect(opened[4]).toBeGreaterThan(opened[3]);
    // And the opened ramp is dark where the band's would already be fading.
    const band = compactSkyGradientColors('#452C4B', '#8C6E99', 'rgb(246, 242, 247)');
    const open = compactSkyGradientColors('#452C4B', '#8C6E99', 'rgb(246, 242, 247)', 0.78);
    const alphaAt = (colour: string) => (colour.length === 9 ? parseInt(colour.slice(7, 9), 16) / 255 : 1);
    // Mid-ramp the band has begun dissolving; the opened sky is still solid.
    expect(alphaAt(band[4])).toBeLessThan(1);
    expect(alphaAt(open[3])).toBe(1);
    expect(
      MEMORY_SKY_COMPACT_GRADIENT_POSITIONS[MEMORY_SKY_COMPACT_GRADIENT_POSITIONS.length - 1],
    ).toBe(1);
    const gradient = compactSkyGradientColors('#452C4B', '#8C6E99', 'rgb(246, 242, 247)');
    expect(gradient).toHaveLength(MEMORY_SKY_COMPACT_GRADIENT_POSITIONS.length);
    expect(gradient[0]).toBe('#452C4B');
    // The brightest stop, held verbatim.
    expect(gradient[3]).toBe('#8C6E99');
    const last = gradient.length - 1;
    expect(gradient[last]).toBe('rgba(246, 242, 247, 0)');
    expect(gradient[last]).not.toBe('transparent');
    expect(backgroundAtAlpha('rgb(246, 242, 247)', 0)).toBe('rgba(246, 242, 247, 0)');
    expect(compactSkyGradientColors('#F6F2F7', '#A97E95', '#F6F2F7')[last]).toBe('#F6F2F700');

    // Alpha only ever falls, from the peak to nothing.
    const alphas = gradient.map(alphaOf);
    expect(alphas[0]).toBe(1);
    expect(alphas[3]).toBe(1);
    expect(alphas[last]).toBe(0);
    for (let i = 4; i <= last; i += 1) {
      expect(alphas[i]).toBeLessThan(alphas[i - 1]);
    }
    // Every middle stop stays in the hue family (violet: red and blue clear
    // of green), never a grey band where it meets the page.
    for (const colour of gradient.slice(1, last)) {
      const { r, g, b } = channelsOf(colour);
      expect(r).toBeGreaterThan(g);
      expect(b).toBeGreaterThan(g);
    }
    // No corner where the dusk turns around. On a tall band a corner in the
    // colour ramp reads as a line straight across the sky, so the steps either
    // side of the brightest stop must not be the steepest part of the ramp.
    // Checked on the dark dusk, where the ramp really does turn around.
    const dark = compactSkyGradientColors('#0D0912', '#4A2C4E', '#120D13');
    const lums = dark.map(luminanceOf);
    const steps = lums.slice(1).map((value, i) => Math.abs(value - lums[i]));
    const peakIndex = lums.indexOf(Math.max(...lums));
    expect(peakIndex).toBe(3);
    const steepest = Math.max(...steps);
    expect(steepest).toBeGreaterThan(0);
    expect(Math.max(steps[peakIndex - 1], steps[peakIndex])).toBeLessThan(steepest);

    const { container, unmount } = render(
      createElement(MemorySky, { moments: [makeMoment('c-1')], compact: true }),
    );
    expect(feather(container)).toBeNull();
    expect(canvases(container)).toHaveLength(1);
    const full = render(createElement(MemorySky, { moments: [makeMoment('c-1')] }));
    expect(feather(full.container)).not.toBeNull();
    expect(canvases(full.container)).toHaveLength(2);
    full.unmount();
    unmount();
    // Compact branch fades to same-hue transparent, never opaque or literal transparent.
    expect(SOURCE).toContain('MEMORY_SKY_COMPACT_GRADIENT_POSITIONS');
    expect(SOURCE).toContain('compactSkyGradientColors');
    expect(SOURCE).toContain('backgroundAtAlpha(background, 0)');
    // Compact dissolves to clear; it never paints an opaque page colour.
    expect(SOURCE).not.toContain('MEMORY_SKY_COMPACT_FEATHER');
    expect(SOURCE).not.toContain('compactFeatherVeilColors');
    expect(SOURCE).not.toContain("colors={['transparent', background]}");
    expect(SOURCE).not.toMatch(/<BlurView[\s/>]/);
    expect(SOURCE).not.toContain('expo-blur');
  });

  it('compact stars fade to 0 at the strip bottom and twinkle excludes faded stars', () => {
    expect(MEMORY_SKY_COMPACT_STAR_FADE_BAND).toBeGreaterThan(0.15);
    expect(MEMORY_SKY_COMPACT_STAR_FADE_BAND).toBeLessThanOrEqual(0.3);
    expect(MEMORY_SKY_COMPACT_TWINKLE_MIN_OPACITY).toBeGreaterThan(0);
    expect(MEMORY_SKY_COMPACT_TWINKLE_MIN_OPACITY).toBeLessThanOrEqual(0.08);
    // Visible bottom (reference 390pt: 139 / 253 ~= 0.55) fades to exactly 0.
    expect(fadeCompactStarOpacity(0.4, 0.55, 0.55)).toBe(0);
    expect(fadeCompactStarOpacity(0.4, 0.9, 0.55)).toBe(0);
    expect(fadeCompactStarOpacity(0.4, 1, 1)).toBe(0);
    // Untouched above the band, partial inside it.
    expect(fadeCompactStarOpacity(0.4, 0.2, 0.55)).toBe(0.4);
    const mid = fadeCompactStarOpacity(0.4, 0.45, 0.55);
    expect(mid).toBeGreaterThan(0);
    expect(mid).toBeLessThan(0.4);
    // Twinkle pool floor excludes bottom-faded stars.
    expect(isCompactTwinkleEligible(0)).toBe(false);
    expect(isCompactTwinkleEligible(0.04)).toBe(false);
    expect(isCompactTwinkleEligible(MEMORY_SKY_COMPACT_TWINKLE_MIN_OPACITY)).toBe(true);
    expect(isCompactTwinkleEligible(0.5)).toBe(true);
    expect(SOURCE).toContain('fadeCompactStarOpacity');
    expect(SOURCE).toContain('isCompactTwinkleEligible');
    expect(SOURCE).toContain('MEMORY_SKY_COMPACT_TWINKLE_MIN_OPACITY');
    expect(SOURCE).toContain('compactVisibleBottomSy');
  });

  it('compact clouds stay clear of the strip bottom (upper region, PNG feather only)', () => {
    expect(MEMORY_SKY_COMPACT_CLOUD_SCALE).toBeGreaterThan(0.4);
    expect(MEMORY_SKY_COMPACT_CLOUD_SCALE).toBeLessThan(1);
    expect(MEMORY_SKY_COMPACT_CLOUD_BOTTOM_CLEARANCE).toBeGreaterThanOrEqual(12);
    expect(MEMORY_SKY_COMPACT_CLOUD_B_TOP).toBeLessThan(0);
    const { container, unmount } = render(
      createElement(MemorySky, { moments: [makeMoment('cl-1')], compact: true }),
    );
    const stripH = parseFloat((skyStrip(container) as HTMLElement).style.height);
    for (const id of ['memory-sky-cloud-a', 'memory-sky-cloud-b']) {
      const cloud = cloudById(container, id) as HTMLElement;
      expect(cloud).not.toBeNull();
      const top = parseFloat(cloud.style.top);
      const height = parseFloat(cloud.style.height);
      const width = parseFloat(cloud.style.width);
      expect(Number.isFinite(top)).toBe(true);
      expect(Number.isFinite(height)).toBe(true);
      // Upper region, never touching the bottom edge.
      expect(top).toBeLessThan(stripH * 0.5);
      expect(top + height).toBeLessThanOrEqual(
        stripH - MEMORY_SKY_COMPACT_CLOUD_BOTTOM_CLEARANCE + 1,
      );
      expect(top + height).toBeLessThan(stripH);
      expect(width).toBeGreaterThan(0);
    }
    // Full banks still bleed to the bottom edge (Us untouched).
    const full = render(createElement(MemorySky, { moments: [makeMoment('cl-1')] }));
    const fullStripH = parseFloat((skyStrip(full.container) as HTMLElement).style.height);
    const fullA = cloudById(full.container, 'memory-sky-cloud-a') as HTMLElement;
    expect(parseFloat(fullA.style.top) + parseFloat(fullA.style.height)).toBeGreaterThan(
      fullStripH - 1,
    );
    full.unmount();
    unmount();
    expect(SOURCE).toContain('MEMORY_SKY_COMPACT_CLOUD_SCALE');
    expect(SOURCE).toContain('MEMORY_SKY_COMPACT_CLOUD_BOTTOM_CLEARANCE');
    expect(SOURCE).toContain('MEMORY_SKY_CLOUD_A');
    expect(SOURCE).toContain('MEMORY_SKY_CLOUD_B');
    expect(SOURCE).not.toMatch(/<BlurView[\s/>]/);
    expect(SOURCE).not.toContain('expo-blur');
  });

  it('tints the veil in the live background hue (light stays clean, no gray band)', () => {
    // Mocked light background is rgb(): veil must stay in that hue.
    expect(featherVeilColors('rgb(246, 242, 247)')).toEqual([
      'rgba(246, 242, 247, 0)',
      'rgba(246, 242, 247, 0.05)',
      'rgba(246, 242, 247, 0.25)',
      'rgba(246, 242, 247, 0.65)',
      'rgba(246, 242, 247, 1)',
    ]);
    // Full-hex themes get the same RGB at alpha 0 (8-digit hex).
    expect(backgroundAtAlpha('#F6F2F7', 0)).toBe('#F6F2F700');
    expect(backgroundAtAlpha('#F6F2F7', 1)).toBe('#F6F2F7ff');
  });

  it('keeps the twinkle below the feather veil (fades, never pops on top)', () => {
    expect(SOURCE.indexOf('memory-sky-twinkle')).toBeLessThan(
      SOURCE.indexOf('memory-sky-feather'),
    );
  });

  it('gates compact timers on focus (static field still paints when unfocused)', async () => {
    vi.spyOn(Reanimated, 'useReducedMotion').mockReturnValue(false);
    vi.useFakeTimers();
    const view = render(
      createElement(MemorySky, { moments: [makeMoment('u-1')], compact: true, focused: false }),
    );
    expect(vi.getTimerCount()).toBe(0);
    await act(async () => {
      vi.advanceTimersByTime(20000);
    });
    expect(twinkleOverlay(view.container)).toBeNull();
    expect(starTotal(skyCanvas(view.container) as HTMLElement)).toBe(1);
    view.unmount();
    expect(vi.getTimerCount()).toBe(0);
  });

  it('schedules no compact timers under reduced motion', async () => {
    vi.spyOn(Reanimated, 'useReducedMotion').mockReturnValue(true);
    vi.useFakeTimers();
    const view = render(
      createElement(MemorySky, { moments: [makeMoment('r-1')], compact: true }),
    );
    expect(vi.getTimerCount()).toBe(0);
    await act(async () => {
      vi.advanceTimersByTime(20000);
    });
    expect(twinkleOverlay(view.container)).toBeNull();
    view.unmount();
  });

  it('gives an empty sky an ambient field, then clears it the moment a memory lands', () => {
    const emptyMarker = (container: HTMLElement) =>
      container.querySelector(
        '[data-testid="memory-sky-star-empty"], [testid="memory-sky-star-empty"]',
      );

    const empty = render(createElement(MemorySky, { moments: [], compact: true }));
    expect(starTotal(skyCanvas(empty.container) as HTMLElement)).toBe(0);
    // With nothing to show, the lone marker is the honest signal.
    expect(emptyMarker(empty.container)).not.toBeNull();
    empty.unmount();

    const ambient = render(
      createElement(MemorySky, { moments: [], compact: true, ambient: true }),
    );
    expect(starTotal(skyCanvas(ambient.container) as HTMLElement)).toBe(
      MEMORY_SKY_AMBIENT_COUNT,
    );
    // The marker would be a second, wrong signal inside a full field.
    expect(emptyMarker(ambient.container)).toBeNull();
    // Ambient stars stay scenery: no caption, no count.
    expect(ambient.container.textContent ?? '').not.toContain('memory');
    ambient.unmount();

    // Ambient is gated on emptiness: a real memory always wins the sky.
    const withMemory = render(
      createElement(MemorySky, {
        moments: [makeMoment('amb-1')],
        compact: true,
        ambient: true,
      }),
    );
    expect(starTotal(skyCanvas(withMemory.container) as HTMLElement)).toBe(1);
    withMemory.unmount();
  });

  it('scatters ambient stars instead of lining whole runs up on one row', () => {
    const rows = new Set<number>();
    for (let index = 0; index < MEMORY_SKY_AMBIENT_COUNT; index += 1) {
      const star = ambientStarForIndex(index);
      expect(star.xPct).toBeGreaterThanOrEqual(3);
      expect(star.xPct).toBeLessThanOrEqual(97);
      expect(star.yPct).toBeGreaterThanOrEqual(4);
      expect(star.yPct).toBeLessThanOrEqual(90);
      expect(star.size).toBeGreaterThanOrEqual(3);
      expect(star.size).toBeLessThanOrEqual(4);
      rows.add(star.yPct);
      const opacity = ambientStarOpacity(index);
      expect(opacity).toBeGreaterThan(0.1);
      expect(opacity).toBeLessThan(0.6);
    }
    // The rolling hash alone put consecutive seeds on the same row; the
    // finalizer is what makes the scatter a scatter.
    expect(rows.size).toBeGreaterThan(MEMORY_SKY_AMBIENT_COUNT * 0.7);
  });

  it('feeds the dusk shader from the live theme, and keeps its own fallback', () => {
    const u = duskSkyUniforms({
      width: 400,
      height: 300,
      skyTop: '#0D0912',
      skyMid: '#4A2C4E',
      background: '#120D13',
    });
    expect(u.uSize).toEqual([400, 300]);
    expect(u.uPeak).toBeCloseTo(0.42);
    // Colours cross the bridge as unit floats, never as the theme's own strings.
    expect(u.uTop).toEqual([13 / 255, 9 / 255, 18 / 255, 1]);
    expect(u.uMid).toEqual([0x4a / 255, 0x2c / 255, 0x4e / 255, 1]);
    expect(u.uHorizon).toEqual([0x12 / 255, 0x0d / 255, 0x13 / 255, 1]);
    const light = skyGlowGeometry(400, 300);
    expect(u.uLight).toEqual([light.cx, light.cy]);
    expect(u.uLightRadius).toBe(light.radius);
    expect(u.uLightStrength).toBeCloseTo(0.13);
    // A 255th of noise is the whole dither; anything more is visible grain.
    expect(u.uDither).toBeCloseTo(1 / 255);
    // The shader is the painter and the stop-ramp is still the fallback.
    expect(SOURCE).toContain('MEMORY_SKY_DUSK_SKSL');
    expect(SOURCE).toContain('RuntimeEffect');
    expect(SOURCE).toContain('compactSkyGradientColors');
    expect(SOURCE).toContain('uDither');
    expect(SOURCE).toContain('premultiplied');
  });

  it('paints the compact sky with the shader when the platform has runtime effects', () => {
    const { container, unmount } = render(
      createElement(MemorySky, { moments: [], compact: true }),
    );
    const canvas = skyCanvas(container) as HTMLElement;
    expect(canvas.querySelector('[data-skia="Shader"]')).not.toBeNull();
    // Still one paint surface; the shader replaces layers, not surfaces.
    expect(canvases(container)).toHaveLength(1);
    unmount();
  });

  it('opens a scenery sky by bringing the whole dusk in, and only when asked', () => {
    const find = (c: HTMLElement, id: string) =>
      c.querySelector(`[data-testid="${id}"], [testid="${id}"]`);

    const quiet = render(
      createElement(MemorySky, { moments: [], compact: true, ambient: true }),
    );
    expect(find(quiet.container, 'memory-sky-dusk')).not.toBeNull();
    quiet.unmount();

    const opening = render(
      createElement(MemorySky, {
        moments: [],
        compact: true,
        ambient: true,
        opening: true,
      }),
    );
    expect(find(opening.container, 'memory-sky-dusk')).not.toBeNull();
    opening.unmount();
  });

  it('moves each depth a different distance when the camera pushes in', () => {
    // Depth is not decoration: it is the reason a field reads as a place. The
    // three buckets have to travel different distances for the same move.
    expect(SOURCE).toContain('farTravel');
    expect(SOURCE).toContain('midTravel');
    expect(SOURCE).toContain('nearTravel');
    expect(SOURCE).toContain('cloudTravel');
    expect(SOURCE).toContain('camera');

    const { container, unmount } = render(
      createElement(MemorySky, { moments: [], compact: true, camera: 1 }),
    );
    const canvas = skyCanvas(container) as HTMLElement;
    const groups = Array.from(canvas.children).filter(
      (el) => el.getAttribute('data-skia') === 'Group',
    );
    // Three buckets, and each carries its own travel.
    expect(groups).toHaveLength(3);
    unmount();
  });

  it('draws the first light with the field\'s own four-point star path', () => {
    const d = sparklePath(0, 0, 5);
    expect(d.startsWith('M 0 -5')).toBe(true);
    expect(d.endsWith('Z')).toBe(true);
    // Four tapered arms, each a quadratic.
    expect(d.split('Q')).toHaveLength(5);
    // Pure, so the same star is drawn every render.
    expect(sparklePath(0, 0, 5)).toBe(d);
  });

  it('lights the dusk off-axis, and fades every light out before the clip line', () => {
    const light = skyGlowGeometry(400, 300);
    expect(light.cx).toBeGreaterThan(300);
    expect(light.cy).toBeLessThan(0);
    const horizon = skyGlowGeometry(400, 300, MEMORY_SKY_HORIZON_GLOW);
    expect(horizon.cx).toBeLessThan(200);
    expect(horizon.cy).toBeGreaterThan(0);
    expect(horizon.cy).toBeLessThan(300);
    // A light still burning where the canvas clips leaves a hard seam across
    // the whole band, so both have to reach nothing before the bottom edge.
    for (const geometry of [light, horizon]) {
      expect(geometry.cy + geometry.radius).toBeLessThan(300);
    }
    const [centre, edge] = skyGlowColors('#8C6E99');
    expect(centre).not.toBe(edge);
    expect(edge).toMatch(/00$/);
    expect(SOURCE).toContain('RadialGradient');
    expect(SOURCE).toContain('MEMORY_SKY_HORIZON_GLOW');
  });
});

describe('Compact wiring (Memories + Plans tabs)', () => {
  it('Memories renders the same sky compact behind its native header (existing providers, no new fetch)', () => {
    expect(INDEX_SOURCE).toContain('MemorySky');
    expect(INDEX_SOURCE).toContain('compact');
    // The Us-tab capture intent still forwards through focus-gated params,
    // and the sky pauses off-focus with it.
    expect(INDEX_SOURCE).toContain('useIsFocused');
    expect(INDEX_SOURCE).toContain('getDaysTogether');
    expect(INDEX_SOURCE).toContain('focused={isFocused && !entry}');
    expect(INDEX_SOURCE).toContain('daysTogether');
    expect(INDEX_SOURCE).toContain("startDate={space?.relationshipStartDate ?? null}");
    expect(INDEX_SOURCE).toContain('useMoments');
    expect(INDEX_SOURCE).toContain('useSpace');
    expect(INDEX_SOURCE).not.toContain('fetchMoments');
    // The only blur on the screen is the condensed title-bar frost, so the
    // pinned sky stays crisp behind it; the sky itself never renders through
    // a BlurView.
    expect(INDEX_SOURCE.match(/<BlurView[\s/>]/g)?.length).toBe(1);
    // Absolute root anchored behind content: immediate root child after
    // FrostedBackdrop, straight into the scroll list (never nested after
    // a custom header — the native large-title header owns the title).
    expect(INDEX_SOURCE.indexOf('<FrostedBackdrop')).toBeLessThan(
      INDEX_SOURCE.indexOf('<MemorySky compact'),
    );
    expect(INDEX_SOURCE).not.toContain('<ScreenHeader');
    expect(INDEX_SOURCE.indexOf('<MemorySky compact')).toBeLessThan(
      INDEX_SOURCE.indexOf('<FlatList\n'),
    );
  });

  it('Plans renders the same sky compact behind its header (existing providers, no new fetch)', () => {
    expect(PLANS_SOURCE).toContain('MemorySky');
    expect(PLANS_SOURCE).toContain('<MemorySky compact');
    expect(PLANS_SOURCE).toContain('useIsFocused');
    expect(PLANS_SOURCE).toContain('getDaysTogether');
    expect(PLANS_SOURCE).toContain('focused={isFocused}');
    expect(PLANS_SOURCE).toContain('moments, loadGoals');
    expect(PLANS_SOURCE).toContain('useSpace');
    expect(PLANS_SOURCE).not.toContain('fetchMoments');
    // The chrome over the sky is a row of glass pills, the way Calendar
    // carries its month and view controls, so there is no full width frost.
    expect(PLANS_SOURCE).toContain('GlassSurface');
    expect(PLANS_SOURCE).toContain('styles.pillRow');
    expect(PLANS_SOURCE).not.toContain('BlurView');
    // Same root anchoring as Memories: after FrostedBackdrop, before the
    // ScrollView/ScreenHeader so scroll offset can never shift the sky.
    expect(PLANS_SOURCE.indexOf('<FrostedBackdrop')).toBeLessThan(
      PLANS_SOURCE.indexOf('<MemorySky compact'),
    );
    // Anchored against the stage, not against the ScrollView text: every
    // scroller on this screen lives inside the mode stage, and the split's
    // extracted layer bodies can sit anywhere in the file. The sky being
    // before the stage is what makes it unshiftable by scroll.
    expect(PLANS_SOURCE.indexOf('<MemorySky compact')).toBeLessThan(
      PLANS_SOURCE.indexOf('styles.modeStage'),
    );
    expect(PLANS_SOURCE.indexOf('<MemorySky compact')).toBeLessThan(
      PLANS_SOURCE.indexOf('styles.pillRow'),
    );
  });

  it('keeps header chrome readable on dark dusk (light foreground, above the sky)', () => {
    // Default tone is the light over-sky chrome; onLight tabs opt out
    // explicitly (Memories has no sky behind its header).
    expect(HEADER_SOURCE).toContain("tone = 'onDark'");
    expect(HEADER_SOURCE).toContain("'#FFF8FA'");
    expect(HEADER_SOURCE).toContain('zIndex: 2');
    expect(SOURCE).toContain('pointerEvents="none"');
  });
});

describe('Fixed header block (pinned sky, zero overlap)', () => {
  it('keeps the sky tall enough to sit behind the header', () => {
    // The header chrome is written for text over the sky. Shorten the band and
    // the title drops off it onto the pale background, which is what made
    // Plans look like it had no header at all.
    expect(compactSkyHeightForWindow(844)).toBe(
      Math.round(844 * MEMORY_SKY_COMPACT_QUARTER) + MEMORY_SKY_TOP_SAFETY,
    );
  });

  it('helper math matches the renderer skyHeight exactly', () => {
    expect(MEMORY_SKY_COMPACT_QUARTER).toBe(MEMORY_SKY_QUARTER / 2);
    expect(MEMORY_SKY_TOP_SAFETY).toBe(12);
    expect(compactSkyHeightForWindow(844)).toBe(
      Math.round(844 * MEMORY_SKY_COMPACT_QUARTER) + MEMORY_SKY_TOP_SAFETY,
    );
    // Mocked window 844: compact 127+12=139, matching the rendered strip.
    expect(compactSkyHeightForWindow(844)).toBe(139);
    expect(SOURCE).toContain('compactSkyHeightForWindow');
    expect(SOURCE).toContain('MEMORY_SKY_COMPACT_QUARTER');
    expect(SOURCE).toContain('MEMORY_SKY_TOP_SAFETY');
  });

  it('Memories pins a fixed overlay header with the scroll; the sky stays pinned', () => {
    // The screen owns a fixed pinned overlay header (title + Feed/Gallery
    // switcher side by side). The list runs full-screen underneath with a
    // top pad below the fixed header, so the header meets the rising feed
    // with no gap and no jump. After entry, the sky stays pinned.
    // Nothing collapses, settles, or hides: the switcher lives in the title
    // row so it is always reachable, and Space lives in the tab bar.
    expect(INDEX_SOURCE).toContain('const headerHeight = insets.top + TITLE_ROW + HEADER_PAD_BOTTOM');
    expect(INDEX_SOURCE).toContain('headerHeight');
    expect(INDEX_SOURCE).not.toContain('headerExpanded');
    expect(INDEX_SOURCE).not.toContain('headerCollapsed');
    expect(INDEX_SOURCE).not.toContain('COLLAPSE_DISTANCE');
    expect(INDEX_SOURCE).not.toContain('collapseLayout');
    expect(INDEX_SOURCE).not.toContain('settleTargetForProgress');
    expect(INDEX_SOURCE).not.toContain('onScrollEndDrag');
    expect(INDEX_SOURCE).not.toContain('onMomentumScrollEnd');
    expect(INDEX_SOURCE).not.toContain('onMomentumScrollBegin');
    expect(INDEX_SOURCE).toContain('headerBackgroundStyle');
    expect(INDEX_SOURCE).not.toContain('collapseFadeStyle');
    expect(INDEX_SOURCE).not.toContain('HEADER_CONTENT_MIN_HEIGHT');
    expect(INDEX_SOURCE).not.toContain('SKY_REVEAL_HEIGHT');
    expect(INDEX_SOURCE).not.toContain('headerBlockStyle');
    expect(INDEX_SOURCE).not.toContain('headerBlockHeight');
    expect(INDEX_SOURCE).not.toContain('headerBlock: {');
    expect(INDEX_SOURCE).not.toContain('<ScreenHeader');
    expect(INDEX_SOURCE).not.toContain('title="Memories"');
    expect(INDEX_SOURCE).not.toContain('<SpaceAvatarButton');
    expect(INDEX_SOURCE).not.toContain('Search memories');
    expect(INDEX_SOURCE).not.toContain('styles.tabsRow');
    expect(INDEX_SOURCE).not.toContain('styles.searchWrap');
    expect(INDEX_SOURCE).toContain('styles.viewSwitch');
    expect(INDEX_SOURCE).toContain('contentInsetAdjustmentBehavior="never"');
    // The docked system bar is cleared explicitly now that insets are local,
    // and the end clears the floating FAB with room to spare.
    expect(INDEX_SOURCE).toContain(
      'fabBottomOffset(insets.bottom, process.env.EXPO_OS === "ios") + FAB_SIZE + Spacing[24]',
    );
    expect(INDEX_SOURCE).not.toContain('tabBarRowTopOffset');
    // Full-bleed sky: the root carries no horizontal padding (it would
    // inset the sky); the list pads its rows, same as Plans.
    const rootBlock = INDEX_SOURCE.match(/root: \{[^}]*\}/)?.[0] ?? '';
    expect(rootBlock).not.toContain('paddingHorizontal');
    // Older history prepends above, so the fetch caption and the paging
    // edge both live at the top: the caption is the list's header, and no
    // bottom-edge trigger exists on either presentation.
    expect(INDEX_SOURCE).toContain('ListHeaderComponent={listHeader}');
    expect(INDEX_SOURCE).toContain('ListFooterComponent={firstPageFooter}');
    expect(INDEX_SOURCE).not.toContain('onEndReached=');
    expect(INDEX_SOURCE).not.toContain('onEndReached');
    // No overlap spacers: content never enters the sky zone.
    expect(INDEX_SOURCE).not.toContain('marginTop: -');
    expect(INDEX_SOURCE).not.toContain('marginTop:-');
    expect(INDEX_SOURCE).not.toContain('paddingTop: -');
    // The add action lives on the FAB (dedicated editor route), not on the
    // feed. No persistent footer, no kind menu, no per-tab overrides.
    expect(INDEX_SOURCE).toContain('Add memory');
    expect(INDEX_SOURCE).toContain('/(app)/moment/new');
    // Memories still reaches the dedicated editor: the empty-state CTA
    // pushes the same route through handleOpenEditor.
    expect(INDEX_SOURCE).toContain('handleOpenEditor');
    expect(INDEX_SOURCE).toContain('/(app)/moment/new');
    expect(INDEX_SOURCE).not.toContain('Capture a moment');
    // No persistent composer footer on the feed (dedicated editor owns
    // capture now; pinned guarantees above unchanged).
    expect(INDEX_SOURCE).not.toContain('InlineMemoryComposer');
    expect(INDEX_SOURCE).not.toContain('composerFooter');
    expect(INDEX_SOURCE).not.toContain('toolbarTitle');
    expect(INDEX_SOURCE).not.toContain('toolbarCluster');
    expect(INDEX_SOURCE).not.toContain('styles.toolbar');
  });

  it('Plans pins the sky above its pill header, which sits above the list', () => {
    // The block sizes to the rows it holds. An explicit height here left a
    // dead band under the header, twice, so there is none.
    expect(PLANS_SOURCE).toContain('styles.headerBlock');
    expect(PLANS_SOURCE).not.toContain('height: headerBlockHeight');
    expect(PLANS_SOURCE).toContain('<MemorySky compact');
    expect(PLANS_SOURCE.indexOf('<MemorySky compact')).toBeLessThan(
      PLANS_SOURCE.indexOf('styles.pillRow'),
    );
    // The weekday row is chrome, not list content. The week strip is gone:
    // the day lives in the sheet now, so the header is the pill plus grid.
    expect(PLANS_SOURCE).not.toContain('<WeekStrip');
  });


  it('gives Us the same working-screen sky band as Plans, not a hero banner', () => {
    // Us used to opt into `immersive`, the decorative full-bleed layout that
    // exists so a banner can take half the viewport. It is a tab now and it
    // takes the same band every other working screen takes.
    //
    // `immersive` is the prop that makes the band full-bleed and feathers
    // it into the page, and it drops the standalone "N memories lighting
    // your sky" caption as well. It is not the old 50vh hero: the height is
    // ours, and it is a band.
    //
    // `compact` was tried here and is wrong for a tab: it draws a bounded
    // canvas, so inside the padded content the clouds clip into a visible
    // rectangle with hard edges.
    // This used to be the opposite instruction. The sky was decoration
    // pinned above a screen about something else, and it was trimmed to a
    // band so it stopped looking like a page. Now it IS the screen, so it is
    // full-bleed, it owns the press handler, and its height is most of the
    // viewport rather than a strip of it.
    const sky = TOGETHER_SOURCE.match(/<MemorySky[\s\S]{0,320}?\/>/)?.[0] ?? '';
    expect(sky).toMatch(/\bimmersive\b/);
    expect(sky).toMatch(/\bonPress=/);
    expect(sky).not.toMatch(/\bcompact\b/);
    expect(TOGETHER_SOURCE).not.toMatch(/<MemorySky[\s\S]{0,320}?\bheader\b/);
    expect(TOGETHER_SOURCE).toMatch(/presentationHeight=\{skyHeight\}/);
    // Most of the screen, not a strip: the field has to be worth reaching
    // into, and that means the stars have room to be apart.
    expect(TOGETHER_SOURCE).toMatch(/Math\.max\(320, height -/);
  });
});

describe('Tab header normalization (one shared anatomy)', () => {
  it('keeps Us titled over its own sky while Plans heads its days with Calendar pills', () => {
    // This rule existed so the three tabs could not drift into three headers.
    // Us is now the one stated exception, and it is the only one that could
    // be: it is the only tab whose surface is a full-bleed image, so the
    // title has to be light chrome drawn over that image rather than a
    // header built for a page of content sitting on a background.
    expect(TOGETHER_SOURCE).not.toContain('<ScreenHeader');
    // The title is a ThemedText over the sky, not a ScreenHeader prop.
    expect(TOGETHER_SOURCE).toMatch(/<ThemedText[^>]*>\s*Us\s*<\/ThemedText>/);
    expect(TOGETHER_SOURCE).not.toContain('title="Us"');
    // Not an oversight: Calendar has no title row. The month pill names the
    // month; a grid cell lifts the day into the sheet, so there is no view
    // pill and no week strip.
    expect(PLANS_SOURCE).not.toContain('<ScreenHeader');
    expect(PLANS_SOURCE).not.toContain('<WeekStrip');
    expect(INDEX_SOURCE).not.toContain('<ScreenHeader');
    // The native stack header is off; the screen renders the title itself.
    expect(MEMORIES_LAYOUT_SOURCE).toContain('headerShown: false');
    expect(MEMORIES_LAYOUT_SOURCE).not.toContain("title: 'Memories'");
    expect(INDEX_SOURCE).toContain('type="title"');
    expect(INDEX_SOURCE).toContain('>Memories</');
    // Us is the exception, and it is the point: it is the only screen whose
    // surface is a full-bleed image, so it sets the title over that image
    // rather than borrowing a header meant for a page of content.
    expect(TOGETHER_SOURCE).not.toContain('<ScreenHeader');
    expect(TOGETHER_SOURCE).toMatch(/<ThemedText[^>]*>\s*Us\s*<\/ThemedText>/);
  });

  it('keeps one title scale and one action-cluster rhythm in the shared header', () => {
    // One title scale means the header does not carry a size of its own: the
    // display token is the only thing that decides how big this title is.
    // It used to pin `fontSize: 28` here, which is the same contract written
    // as a literal, and the reason four screens each invented a page-title
    // size of their own.
    expect(HEADER_SOURCE).toContain('type="display"');
    expect(HEADER_SOURCE).not.toMatch(/fontSize:\s*\d+/);
    expect(HEADER_SOURCE).not.toMatch(/lineHeight:\s*\d+/);
    expect(HEADER_SOURCE).toContain("'#FFF8FA'");
    expect(HEADER_SOURCE).toContain('gap: Spacing[12]');
    expect(HEADER_SOURCE).toContain('showAvatar');
  });

  it('deletes per-tab toolbar duplicates so tabs cannot drift', () => {
    expect(TOGETHER_SOURCE).not.toContain('styles.toolbar');
    expect(TOGETHER_SOURCE).not.toContain('toolbarTitle');
    expect(INDEX_SOURCE).not.toContain('styles.toolbar');
    expect(INDEX_SOURCE).not.toContain('toolbarTitle');
    expect(INDEX_SOURCE).not.toContain('toolbarCluster');
    expect(PLANS_SOURCE).not.toContain('styles.toolbar');
    expect(PLANS_SOURCE).not.toContain('toolbarTitle');
  });

  it('keeps each tab distinct actions with identical behaviors', () => {
    // Memories opens the dedicated editor from its FAB (no header action,
    // no kind menu); Plans keeps its add-event primary action. Shared
    // anatomy unchanged.
    expect(INDEX_SOURCE).toContain('Add memory');
    expect(INDEX_SOURCE).toContain('styles.fab');
    expect(INDEX_SOURCE).toContain('handleOpenEditor');
    expect(INDEX_SOURCE).not.toContain('primaryAction');
    // Liquid glass FAB (clear material, accent wash) instead of a solid
    // button, sized from the shared 56pt constant.
    expect(INDEX_SOURCE).toContain('GlassSurface');
    expect(INDEX_SOURCE).toContain('effect="clear"');
    expect(INDEX_SOURCE).toContain('FAB_SIZE');
    expect(INDEX_SOURCE).not.toContain('Capture a moment');
    expect(INDEX_SOURCE).not.toContain('handleOpenCompose');
    // The screen owns the Memories title now (no per-tab tone override on
    // the in-screen header); the native stack header stays off.
    expect(INDEX_SOURCE).not.toContain('title="Memories"');
    expect(INDEX_SOURCE).not.toContain('tone=');
    expect(MEMORIES_LAYOUT_SOURCE).toContain('headerShown: false');
    expect(TOGETHER_SOURCE).not.toContain('tone=');
    // The full width frost and its tone pick are gone. The pills carry their
    // own glass, so the chrome reads over the sky without a band.
    expect(PLANS_SOURCE).not.toContain('backgroundIsLight');
    expect(PLANS_SOURCE).toContain('<GlassSurface');
    // Creation lives in the header row, like Calendar. A native glass button
    // cannot be shaped from RN, so there is no floating glass action.
    // Creation is the floating control, not a control in the header, and the
    // header's month pill opens the year instead.
    expect(PLANS_SOURCE).not.toContain('Add an event for the selected day');
    expect(PLANS_SOURCE).toContain('accessibilityLabel="Add an event"');
    expect(PLANS_SOURCE).toContain('Open the year view');
    expect(PLANS_SOURCE).toContain('handleAddEvent');
  });
});

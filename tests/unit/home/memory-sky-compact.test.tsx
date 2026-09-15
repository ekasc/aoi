import { readFileSync } from 'node:fs';
import { act, render } from '@testing-library/react';
import { createElement } from 'react';
import * as Reanimated from 'react-native-reanimated';
import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  MEMORY_SKY_COMPACT_CLOUD_BOTTOM_CLEARANCE,
  MEMORY_SKY_COMPACT_CLOUD_B_TOP,
  MEMORY_SKY_COMPACT_CLOUD_SCALE,
  MEMORY_SKY_COMPACT_GRADIENT_POSITIONS,
  MEMORY_SKY_COMPACT_QUARTER,
  MEMORY_SKY_COMPACT_STAR_FADE_BAND,
  MEMORY_SKY_COMPACT_TWINKLE_MIN_OPACITY,
  MEMORY_SKY_TOP_SAFETY,
  MEMORY_SKY_FEATHER_ALPHAS,
  MEMORY_SKY_FEATHER_FRACTION,
  MEMORY_SKY_FEATHER_POSITIONS,
  MEMORY_SKY_QUARTER,
  MemorySky,
  backgroundAtAlpha,
  compactSkyGradientColors,
  compactSkyHeightForWindow,
  fadeCompactStarOpacity,
  featherVeilColors,
  isCompactTwinkleEligible,
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

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe('MemorySky compact backdrop (Memories/Plans)', () => {
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
    expect([...MEMORY_SKY_COMPACT_GRADIENT_POSITIONS]).toEqual([0, 0.36, 0.6, 0.82, 1]);
    expect(
      MEMORY_SKY_COMPACT_GRADIENT_POSITIONS[MEMORY_SKY_COMPACT_GRADIENT_POSITIONS.length - 1],
    ).toBe(1);
    const gradient = compactSkyGradientColors('#452C4B', '#8C6E99', 'rgb(246, 242, 247)');
    expect(gradient).toHaveLength(5);
    expect(gradient[0]).toBe('#452C4B');
    expect(gradient[1]).toBe('#8C6E99');
    expect(gradient[4]).toBe('rgba(246, 242, 247, 0)');
    expect(gradient[4]).not.toBe('transparent');
    // Middle stops stay in the hue family, only the alpha falls.
    expect(gradient[2]).toBe('#bca9c399');
    expect(gradient[3]).toBe('#e3dae642');
    expect(backgroundAtAlpha('rgb(246, 242, 247)', 0)).toBe('rgba(246, 242, 247, 0)');
    expect(compactSkyGradientColors('#F6F2F7', '#A97E95', '#F6F2F7')[4]).toBe('#F6F2F700');
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
});

describe('Compact wiring (Memories + Plans tabs)', () => {
  it('Memories renders the same sky compact behind its native header (existing providers, no new fetch)', () => {
    expect(INDEX_SOURCE).toContain('MemorySky');
    expect(INDEX_SOURCE).toContain('compact');
    // The Us-tab capture intent still forwards through focus-gated params,
    // and the sky pauses off-focus with it.
    expect(INDEX_SOURCE).toContain('useIsFocused');
    expect(INDEX_SOURCE).toContain('getDaysTogether');
    expect(INDEX_SOURCE).toContain('focused={isFocused}');
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
    expect(PLANS_SOURCE).toContain('compact');
    expect(PLANS_SOURCE).toContain('useIsFocused');
    expect(PLANS_SOURCE).toContain('getDaysTogether');
    expect(PLANS_SOURCE).toContain('focused={isFocused}');
    expect(PLANS_SOURCE).toContain('moments, loadGoals');
    expect(PLANS_SOURCE).toContain('useSpace');
    expect(PLANS_SOURCE).not.toContain('fetchMoments');
    expect(PLANS_SOURCE).not.toContain('BlurView');
    // Same root anchoring as Memories: after FrostedBackdrop, before the
    // ScrollView/ScreenHeader so scroll offset can never shift the sky.
    expect(PLANS_SOURCE.indexOf('<FrostedBackdrop')).toBeLessThan(
      PLANS_SOURCE.indexOf('<MemorySky compact'),
    );
    expect(PLANS_SOURCE.indexOf('<MemorySky compact')).toBeLessThan(
      PLANS_SOURCE.indexOf('<ScrollView\n'),
    );
    expect(PLANS_SOURCE.indexOf('<MemorySky compact')).toBeLessThan(
      PLANS_SOURCE.indexOf('<ScreenHeader'),
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

  it('Memories condenses its overlay header with the scroll; the sky stays pinned', () => {
    // The screen owns the pinned overlay header (title + Feed/Gallery
    // switcher). The list runs full-screen underneath with a top pad that
    // scrolls 1:1 against the header shed, so the header meets the rising
    // feed with no gap and no jump — and the sky is never faded or removed.
    expect(INDEX_SOURCE).not.toContain('compactSkyHeightForWindow');
    expect(INDEX_SOURCE).toContain('headerExpanded');
    expect(INDEX_SOURCE).toContain('headerCollapsed');
    expect(INDEX_SOURCE).toContain('COLLAPSE_DISTANCE');
    expect(INDEX_SOURCE).toContain('headerLayoutStyle');
    expect(INDEX_SOURCE).toContain('headerBackgroundStyle');
    expect(INDEX_SOURCE).toContain('collapseLayout');
    // A short list or slow drag can park the header half-shed: it settles
    // to the nearer endpoint on scroll rest (pure rule, unit-tested).
    expect(INDEX_SOURCE).toContain('settleTargetForProgress');
    expect(INDEX_SOURCE).toContain('onScrollEndDrag');
    expect(INDEX_SOURCE).toContain('onMomentumScrollEnd');
    expect(INDEX_SOURCE).not.toContain('collapseFadeStyle');
    expect(INDEX_SOURCE).not.toContain('HEADER_CONTENT_MIN_HEIGHT');
    expect(INDEX_SOURCE).not.toContain('SKY_REVEAL_HEIGHT');
    expect(INDEX_SOURCE).not.toContain('headerBlockStyle');
    expect(INDEX_SOURCE).not.toContain('headerBlockHeight');
    expect(INDEX_SOURCE).not.toContain('headerBlock: {');
    expect(INDEX_SOURCE).not.toContain('<ScreenHeader');
    expect(INDEX_SOURCE).not.toContain('title="Memories"');
    expect(INDEX_SOURCE).toContain('contentInsetAdjustmentBehavior="never"');
    // The docked system bar is cleared explicitly now that insets are local.
    expect(INDEX_SOURCE).toContain(
      'fabBottomOffset(insets.bottom, process.env.EXPO_OS === "ios") + Spacing[8]',
    );
    expect(INDEX_SOURCE).not.toContain('tabBarRowTopOffset');
    // Full-bleed sky: the root carries no horizontal padding (it would
    // inset the sky); the list pads its rows, same as Plans.
    const rootBlock = INDEX_SOURCE.match(/root: \{[^}]*\}/)?.[0] ?? '';
    expect(rootBlock).not.toContain('paddingHorizontal');
    expect(INDEX_SOURCE).toContain('ListFooterComponent={listFooter}');
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

  it('Plans pins ScreenHeader+sky in a fixed block; ScrollView starts below', () => {
    expect(PLANS_SOURCE).toContain('compactSkyHeightForWindow');
    expect(PLANS_SOURCE).toContain('headerBlockStyle');
    expect(PLANS_SOURCE).toContain('height: headerBlockHeight');
    expect(PLANS_SOURCE).toContain('paddingTop: insets.top + Spacing[8]');
    // Sky FIRST inside the block, ScreenHeader above it with existing chrome.
    expect(PLANS_SOURCE.indexOf('<View style={headerBlockStyle}>')).toBeLessThan(
      PLANS_SOURCE.indexOf('<MemorySky compact'),
    );
    expect(PLANS_SOURCE.indexOf('<MemorySky compact')).toBeLessThan(
      PLANS_SOURCE.indexOf('<ScreenHeader'),
    );
    // ScreenHeader is OUTSIDE (before) the outer ScrollView so it can never
    // scroll away; scroll content starts below the block.
    expect(PLANS_SOURCE.indexOf('<ScreenHeader')).toBeLessThan(
      PLANS_SOURCE.indexOf('<ScrollView\n'),
    );
    expect(PLANS_SOURCE).not.toContain('marginTop: -');
    expect(PLANS_SOURCE).not.toContain('marginTop:-');
    expect(PLANS_SOURCE).not.toContain('paddingTop: -');
    expect(PLANS_SOURCE).toContain('position: "relative"');
    expect(PLANS_SOURCE).toContain('overflow: "hidden"');
    // Sections order and behavior preserved below the block.
    expect(PLANS_SOURCE).toContain('title="Plans"');
    expect(PLANS_SOURCE).toContain('PAGER_WINDOW_SIZE');
    expect(PLANS_SOURCE).toContain('Proposals');
    expect(PLANS_SOURCE).toContain('Someday');
    expect(PLANS_SOURCE).toContain('Future goals');
  });

  it('leaves the Us tab totally untouched', () => {
    expect(TOGETHER_SOURCE).not.toContain('compactSkyHeightForWindow');
    expect(TOGETHER_SOURCE).not.toContain('headerBlock');
    expect(TOGETHER_SOURCE).not.toContain('<MemorySky compact');
    expect(TOGETHER_SOURCE).toContain('<MemorySky moments');
  });
});

describe('Tab header normalization (one shared anatomy)', () => {
  it('renders Us and Plans titles through the shared ScreenHeader; Memories owns its in-screen header', () => {
    expect(TOGETHER_SOURCE).toContain('<ScreenHeader');
    expect(TOGETHER_SOURCE).toContain('title="Us"');
    expect(PLANS_SOURCE).toContain('<ScreenHeader');
    expect(PLANS_SOURCE).toContain('title="Plans"');
    expect(INDEX_SOURCE).not.toContain('<ScreenHeader');
    // The native stack header is off; the screen renders the title itself.
    expect(MEMORIES_LAYOUT_SOURCE).toContain('headerShown: false');
    expect(MEMORIES_LAYOUT_SOURCE).not.toContain("title: 'Memories'");
    expect(INDEX_SOURCE).toContain('type="display"');
  });

  it('keeps one title scale and one action-cluster rhythm in the shared header', () => {
    expect(HEADER_SOURCE).toContain('fontSize: 28');
    expect(HEADER_SOURCE).toContain('lineHeight: 34');
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
    expect(PLANS_SOURCE).not.toContain('tone=');
    expect(PLANS_SOURCE).toContain('Add an event for the selected day');
    expect(PLANS_SOURCE).toContain('handleAddEvent');
  });
});

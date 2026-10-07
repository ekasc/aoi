import { createElement } from 'react';
import { act, render } from '@testing-library/react';
import * as Reanimated from 'react-native-reanimated';
import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  THEME_SKY_RAMPS,
  isBeachTheme,
  SEA_SHELL_PALETTE,
  skyStopsForTheme,
} from '@/components/home/sky-palette';
import { BeachThemeOrder, BeachThemes } from '@/constants/theme-presets';
import { buildPhotoSkyField } from '@/features/home/photo-sky';
import {
  BEACH_HEADER_CREATURE_MAX,
  BEACH_BAND_CREATURE_MAX,
  BEACH_SHORE_FRACTION,
  MemorySky,
  beachDayStride,
  beachMomentKeep,
  beachShellY,
  beachSkyUniforms,
  foamEdgePath,
  shellKindFor,
  MEMORY_SKY_BEACH_SKSL,
} from '@/components/home/memory-sky';

afterEach(() => {
  vi.useRealTimers();
});

function makeMoment(id: string, authorRole: 'you' | 'partner' = 'you') {
  return {
    id,
    authorRole,
    occurredAt: '2026-09-01T12:00:00.000Z',
    caption: id,
  };
}

const dashesFor = (ids: string[]) => ids.filter((id) => seaGlintDashFor(id)).length;

describe('Lagoon beach shader', () => {
  it('paints the surface procedurally and animates it', () => {
    // fbm + value noise are what make sand and water read as material.
    expect(MEMORY_SKY_BEACH_SKSL).toContain('fbm');
    expect(MEMORY_SKY_BEACH_SKSL).toContain('vnoise');
    expect(MEMORY_SKY_BEACH_SKSL).toContain('uShore');
    expect(MEMORY_SKY_BEACH_SKSL).toContain('uSandLight');
    expect(MEMORY_SKY_BEACH_SKSL).toContain('uSeaDeep');
    // The shore is alive: a time uniform laps the waterline and rolls waves.
    expect(MEMORY_SKY_BEACH_SKSL).toContain('uTime');
    expect(MEMORY_SKY_BEACH_SKSL).toContain('shoreLine');
    // Top-down water: the seabed shows through refracting water, lit by
    // caustics. That is the read a horizon view can never produce.
    expect(MEMORY_SKY_BEACH_SKSL).toContain('caustics');
    expect(MEMORY_SKY_BEACH_SKSL).toContain('refr');
    // Never a gradient band.
    expect(MEMORY_SKY_BEACH_SKSL).not.toContain('LinearGradient');
  });

  it('layers the uniforms so sand sits above the sea', () => {
    const u = beachSkyUniforms({
      width: 400,
      height: 300,
      sandLight: '#ffffff',
      sandDeep: '#dddddd',
      wet: '#cccccc',
      seaShallow: '#00ffff',
      seaDeep: '#003366',
    });
    expect(u.uSize).toEqual([400, 300]);
    expect(u.uShore).toBe(BEACH_SHORE_FRACTION);
    expect(u.uSun).toEqual([400 * 0.7, 300 * BEACH_SHORE_FRACTION]);
    for (const key of ['uSandLight', 'uSandDeep', 'uWet', 'uSeaShallow', 'uSeaDeep', 'uFoam']) {
      expect(Array.isArray(u[key]), key).toBe(true);
    }
    // The shader draws sand where v < uShore (the top), sea below it.
    expect(BEACH_SHORE_FRACTION).toBeGreaterThan(0);
    expect(BEACH_SHORE_FRACTION).toBeLessThan(1);
    // A full scene is opaque; a band strip dissolves below its fade point.
    expect(u.uFadeFrom).toBe(1);
    const band = beachSkyUniforms({
      width: 400,
      height: 120,
      shore: 0,
      fadeFrom: 0.3,
      sandLight: '#ffffff',
      sandDeep: '#dddddd',
      wet: '#cccccc',
      seaShallow: '#00ffff',
      seaDeep: '#003366',
    });
    expect(band.uShore).toBe(0);
    expect(band.uFadeFrom).toBe(0.3);
  });

  it('rests shells on the sand band (top of the strip), stable per input', () => {
    expect(beachShellY(0)).toBeCloseTo(0.05, 5);
    expect(beachShellY(1)).toBeCloseTo(0.52, 5);
    expect(beachShellY(0.5)).toBeGreaterThan(0.2);
    expect(beachShellY(0.5)).toBeLessThan(0.35);
    expect(beachShellY(0.2)).toBeLessThan(beachShellY(0.8));
    expect(beachShellY(-4)).toBeCloseTo(0.05, 5);
    expect(beachShellY(4)).toBeCloseTo(0.52, 5);
  });

  it('deals shells across four kinds so a beach is not one repeated glyph', () => {
    const kinds = new Set(
      Array.from({ length: 60 }, (_, i) => shellKindFor(`shell-${i}`)),
    );
    expect(kinds).toEqual(new Set([0, 1, 2, 3]));
    // Stable per key.
    expect(shellKindFor('shell-3')).toBe(shellKindFor('shell-3'));
  });

  it('offers a range of shell tints', () => {
    expect(SEA_SHELL_PALETTE.length).toBeGreaterThanOrEqual(4);
    const bodies = new Set(SEA_SHELL_PALETTE.map((entry) => entry.body));
    expect(bodies.size).toBe(SEA_SHELL_PALETTE.length);
    for (const entry of SEA_SHELL_PALETTE) {
      expect(entry.body).toMatch(/^#[0-9a-fA-F]{6}$/);
      expect(entry.rib).toMatch(/^#[0-9a-fA-F]{6}$/);
      expect(entry.body).not.toBe(entry.rib);
    }
  });

  it('collapses the photo field to one depth for the flat-plane beach', () => {
    const photos = [
      { id: 'p-1', occurredAt: '2026-09-01T00:00:00.000Z', authorRole: 'you' as const },
      { id: 'p-2', occurredAt: '2026-09-02T00:00:00.000Z', authorRole: 'you' as const },
      { id: 'p-3', occurredAt: '2026-09-03T00:00:00.000Z', authorRole: 'you' as const },
    ];
    const deep = buildPhotoSkyField(photos);
    const flat = buildPhotoSkyField(photos, true);
    // The flat field keeps its scatter but shares one depth: no parallax.
    expect(new Set(flat.map((star) => star.depth))).toEqual(new Set(['near']));
    expect(flat.map((star) => star.x)).toEqual(deep.map((star) => star.x));
    expect(flat.map((star) => star.id)).toEqual(deep.map((star) => star.id));
  });

  it('carries the camera plane into the surface uniforms', () => {
    const base = {
      width: 400,
      height: 300,
      sandLight: '#ffffff',
      sandDeep: '#dddddd',
      wet: '#cccccc',
      seaShallow: '#00ffff',
      seaDeep: '#003366',
    };
    const moved = beachSkyUniforms({ ...base, pan: [12, -8], scale: 2.5 });
    expect(moved.uPan).toEqual([12, -8]);
    expect(moved.uScale).toBe(2.5);
    // Defaults: an untransformed scene.
    const rest = beachSkyUniforms(base);
    expect(rest.uPan).toEqual([0, 0]);
    expect(rest.uScale).toBe(1);
  });
});

describe('Lagoon beach theme', () => {  it('registers lagoon after the existing presets without moving the default', () => {
    expect(BeachThemeOrder[0]).toBe('after-hours');
    expect(BeachThemeOrder).toContain('lagoon');
    expect(BeachThemes['lagoon'].name).toBe('Lagoon');
    expect(BeachThemes['lagoon'].description).toContain('cyan');
  });

  it('is the only beach theme; after-hours keeps its stars', () => {
    expect(isBeachTheme('lagoon')).toBe(true);
    expect(isBeachTheme('after-hours')).toBe(false);
    expect(isBeachTheme('sea-glass')).toBe(false);
    expect(isBeachTheme('nope')).toBe(false);
  });

  it('gives lagoon its own bright water ramp, not the wine dusk', () => {
    const light = skyStopsForTheme('lagoon', 'light');
    expect(light).toEqual(THEME_SKY_RAMPS['lagoon'].light);
    expect(light.top).not.toBe(THEME_SKY_RAMPS['after-hours'].light.top);
    expect(light.mid).not.toBe(THEME_SKY_RAMPS['after-hours'].light.mid);
  });

  it('paints a lagoon water ramp distinct from the wine dusk', () => {
    const light = skyStopsForTheme('lagoon', 'light');
    expect(light).toEqual(THEME_SKY_RAMPS['lagoon'].light);
    expect(light.top).not.toBe(THEME_SKY_RAMPS['after-hours'].light.top);
    expect(light.mid).not.toBe(THEME_SKY_RAMPS['after-hours'].light.mid);
  });
});

describe('MemorySky shell shore', () => {
  const skyCanvas = (container: HTMLElement) =>
    container.querySelector('[data-testid="skia-canvas"]');

  it('laps the foam edge from M/L/Q/Z verbs only', () => {
    const path = foamEdgePath(400, 100);
    expect(path.startsWith('M ')).toBe(true);
    expect(path).toContain('Q ');
    expect(path.endsWith(' Z')).toBe(true);
    expect(path).not.toContain('A ');
    expect(path).not.toContain('T ');
    expect(foamEdgePath(400, 100)).toBe(path);
  });

  it('sets one shell per memory in the header over the beach shader', () => {
    const moments = [makeMoment('h-1'), makeMoment('h-2'), makeMoment('h-3')];
    const view = render(
      createElement(MemorySky, { moments, themeId: 'lagoon', header: true }),
    );
    const canvas = skyCanvas(view.container) as HTMLElement;
    // Each shell is a handful of shapes over one contact-shadow oval; the
    // whole surface is one shader's rect. No gradient rects, no stars.
    expect(canvas.querySelectorAll('[data-skia="Path"]').length).toBeGreaterThanOrEqual(3);
    expect(canvas.querySelectorAll('[data-skia="Oval"]').length).toBeGreaterThanOrEqual(3);
    expect(canvas.querySelectorAll('[data-skia="Rect"]').length).toBe(1);
    expect(canvas.querySelectorAll('[data-skia="Shader"]').length).toBe(1);
    expect(canvas.querySelectorAll('[data-skia="Circle"]').length).toBe(0);
    expect(view.container.textContent).toContain('shells on your shore');
    view.unmount();
  });

  it('mounts the same shader and shells in the compact strips behind app headers', () => {
    const moments = [makeMoment('h-1'), makeMoment('h-2'), makeMoment('h-3')];
    const view = render(
      createElement(MemorySky, { moments, themeId: 'lagoon', compact: true }),
    );
    const canvas = skyCanvas(view.container) as HTMLElement;
    expect(canvas.querySelectorAll('[data-skia="Path"]').length).toBeGreaterThanOrEqual(3);
    expect(canvas.querySelectorAll('[data-skia="Oval"]').length).toBeGreaterThanOrEqual(3);
    expect(canvas.querySelectorAll('[data-skia="Rect"]').length).toBe(1);
    expect(canvas.querySelectorAll('[data-skia="Shader"]').length).toBe(1);
    expect(canvas.querySelectorAll('[data-skia="Circle"]').length).toBe(0);
    view.unmount();
  });

  it('leaves the shore still: no twinkle dots on the sand', async () => {
    vi.spyOn(Reanimated, 'useReducedMotion').mockReturnValue(false);
    vi.useFakeTimers();
    const view = render(
      createElement(MemorySky, {
        moments: [makeMoment('h-1'), makeMoment('h-2')],
        themeId: 'lagoon',
        header: true,
      }),
    );
    await act(async () => {
      vi.advanceTimersByTime(30000);
    });
    expect(
      view.container.querySelectorAll(
        '[data-testid="memory-sky-twinkle"], [testid="memory-sky-twinkle"]',
      ).length,
    ).toBe(0);
    view.unmount();
  });

  it('keeps the starry header free of sea life under after-hours', () => {
    const moments = [makeMoment('h-1'), makeMoment('h-2')];
    const view = render(
      createElement(MemorySky, { moments, header: true }),
    );
    const canvas = skyCanvas(view.container) as HTMLElement;
    expect(canvas.querySelectorAll('[data-skia="Oval"]').length).toBe(0);
    expect(view.container.textContent).toContain('lighting your sky');
    view.unmount();
  });

  it('samples day counts down to a calm school stride', () => {
    expect(beachDayStride(0)).toBe(1);
    expect(beachDayStride(5)).toBe(1);
    expect(beachDayStride(12)).toBe(1);
    expect(beachDayStride(13)).toBe(2);
    expect(beachDayStride(200)).toBe(17);
  });

  it('rank-keeps at most the band cap of memories, stably', () => {
    const ids = Array.from({ length: 30 }, (_, i) => `crowd-${i}`);
    const keep = beachMomentKeep(ids);
    expect(keep.size).toBe(BEACH_BAND_CREATURE_MAX);
    expect(beachMomentKeep(ids)).toEqual(keep);
    expect(beachMomentKeep(ids.slice(0, 3)).size).toBe(3);
  });

  it('gives the shorter header band fewer shells than the compact strip', () => {
    const ids = Array.from({ length: 30 }, (_, i) => `crowd-${i}`);
    expect(BEACH_HEADER_CREATURE_MAX).toBeLessThan(BEACH_BAND_CREATURE_MAX);
    expect(beachMomentKeep(ids, BEACH_HEADER_CREATURE_MAX).size).toBe(BEACH_HEADER_CREATURE_MAX);
    // The header samples day counts harder than the compact strip.
    expect(beachDayStride(40, BEACH_HEADER_CREATURE_MAX))
      .toBeGreaterThan(beachDayStride(40, BEACH_BAND_CREATURE_MAX));
  });

  it('thins a crowded band to the cap but counts them all', () => {
    const moments = Array.from({ length: 30 }, (_, i) => makeMoment(`crowd-${i}`));
    const keep = beachMomentKeep(moments.map((moment) => moment.id));
    const view = render(
      createElement(MemorySky, { moments, themeId: 'lagoon', compact: true }),
    );
    const canvas = skyCanvas(view.container) as HTMLElement;
    expect(keep.size).toBe(BEACH_BAND_CREATURE_MAX);
    // At least one shape per shell over one contact-shadow oval each.
    expect(canvas.querySelectorAll('[data-skia="Path"]').length).toBeGreaterThanOrEqual(keep.size);
    expect(canvas.querySelectorAll('[data-skia="Oval"]').length).toBeGreaterThanOrEqual(keep.size);
    view.unmount();
  });

  it('caps the header band to its own, smaller shell limit', () => {
    const moments = Array.from({ length: 30 }, (_, i) => makeMoment(`crowd-${i}`));
    const keep = beachMomentKeep(moments.map((moment) => moment.id), BEACH_HEADER_CREATURE_MAX);
    expect(keep.size).toBe(BEACH_HEADER_CREATURE_MAX);
    expect(keep.size).toBeLessThan(BEACH_BAND_CREATURE_MAX);

    const shapes = (node: HTMLElement) => node.querySelectorAll('[data-skia]').length;
    const header = render(
      createElement(MemorySky, { moments, themeId: 'lagoon', header: true }),
    );
    const compact = render(
      createElement(MemorySky, { moments, themeId: 'lagoon', compact: true }),
    );
    const headerShapes = shapes(skyCanvas(header.container) as HTMLElement);
    const compactShapes = shapes(skyCanvas(compact.container) as HTMLElement);
    // The header band draws strictly fewer shells than the compact strip.
    expect(headerShapes).toBeGreaterThan(0);
    expect(headerShapes).toBeLessThan(compactShapes);
    header.unmount();
    compact.unmount();
  });

  it('thins two hundred days together to a short shore, not static', () => {
    const view = render(
      createElement(MemorySky, {
        moments: [],
        themeId: 'lagoon',
        compact: true,
        daysTogether: 200,
        startDate: '2025-01-01',
      }),
    );
    const canvas = skyCanvas(view.container) as HTMLElement;
    // Uncapped, 200 day-glyphs at ~6 nodes each would paint 1000+ shapes.
    expect(canvas.querySelectorAll('[data-skia]').length).toBeLessThan(200);
    view.unmount();
  });
});
describe('MemorySky beach mode', () => {
  it('walks shoreline captions under the lagoon theme', () => {
    const view = render(
      createElement(MemorySky, {
        moments: [makeMoment('b-1'), makeMoment('b-2')],
        themeId: 'lagoon',
      }),
    );
    expect(view.container.textContent).toContain('2 shells on your shore');
    view.unmount();
  });

  it('keeps the starry captions under after-hours', () => {
    const view = render(
      createElement(MemorySky, { moments: [makeMoment('s-1'), makeMoment('s-2')] }),
    );
    expect(view.container.textContent).toContain('2 memories lighting your sky');
    view.unmount();
  });

  it('sets shells across the full sky too, with the shore dressing around it', () => {
    const moments = [makeMoment('k-1'), makeMoment('k-2'), makeMoment('k-3')];
    const skyCanvas = (container: HTMLElement) =>
      container.querySelector('[data-testid="skia-canvas"]');
    const beach = render(createElement(MemorySky, { moments, themeId: 'lagoon' }));
    const stars = render(createElement(MemorySky, { moments }));
    const canvas = skyCanvas(beach.container) as HTMLElement;
    // Shells over one beach-shader rect; no stars (no circles).
    expect(canvas.querySelectorAll('[data-skia="Path"]').length).toBeGreaterThanOrEqual(3);
    expect(canvas.querySelectorAll('[data-skia="Oval"]').length).toBeGreaterThanOrEqual(3);
    expect(canvas.querySelectorAll('[data-skia="Rect"]').length).toBe(1);
    expect(canvas.querySelectorAll('[data-skia="Circle"]').length).toBe(0);
    expect(skyCanvas(stars.container)).not.toBeNull();
    beach.unmount();
    stars.unmount();
  });

  it('replaces the zoomable photo stars with shells on the Us field', () => {
    const moments = [makeMoment('p-1'), makeMoment('p-2'), makeMoment('p-3')];
    const skyCanvas = (container: HTMLElement) =>
      container.querySelector('[data-testid="skia-canvas"]');
    const view = render(
      createElement(MemorySky, {
        moments,
        themeId: 'lagoon',
        immersive: true,
        photoStars: true,
        starLimit: null,
        focused: false,
      }),
    );
    const canvas = skyCanvas(view.container) as HTMLElement;
    // No star-core circles: every photo is a shell (paths). Halos may remain
    // for the nearest shells, but the glyph itself is a shell.
    expect(canvas.querySelectorAll('[data-skia="Circle"]').length).toBe(0);
    expect(canvas.querySelectorAll('[data-skia="Path"]').length).toBeGreaterThanOrEqual(
      3 * moments.length,
    );
    view.unmount();
  });
});

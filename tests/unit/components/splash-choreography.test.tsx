import { renderHook } from '@testing-library/react';
import * as Reanimated from 'react-native-reanimated';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { SPLASH_MOTIFS } from '@/components/splash/animated-intro';
import { cometPoint, cometTrim, splashPhase } from '@/components/splash/choreography';
import { SPLASH_SCENE_MS, SPLASH_SETTLE_MS } from '@/components/splash/timing';
import { splashMaterialUniforms } from '@/components/splash/splash-material';
import { useSplashProgress } from '@/components/splash/use-splash-progress';
import { useSplashTwinkle } from '@/components/splash/use-splash-twinkle';
import { BeachThemeOrder, BeachThemes } from '@/constants/theme-presets';

afterEach(() => vi.restoreAllMocks());

describe('bounded material animation', () => {
  it('twinkles the stars only after the artwork settles, and leaves a steady frame under reduced motion', () => {
    const repeat = vi.spyOn(Reanimated, 'withRepeat');
    renderHook(() => useSplashTwinkle(false));
    expect(repeat).not.toHaveBeenCalled();
    renderHook(() => useSplashTwinkle(true));
    expect(repeat).toHaveBeenCalled();
    repeat.mockClear();
    vi.spyOn(Reanimated, 'useReducedMotion').mockReturnValue(true);
    const { result } = renderHook(() => useSplashTwinkle(true));
    expect(result.current.value).toBe(1);
    expect(repeat).not.toHaveBeenCalled();
  });

  it('runs the twinkle window after the artwork settles, before the scene ends', () => {
    expect(SPLASH_SETTLE_MS).toBeLessThan(SPLASH_SCENE_MS);
  });
  it('runs one UI-thread opening, finishes inside the scene budget, and cancels on unmount', () => {
    const animate = vi.spyOn(Reanimated, 'withTiming');
    const cancel = vi.spyOn(Reanimated, 'cancelAnimation');
    const { result, unmount } = renderHook(useSplashProgress);
    expect(animate).toHaveBeenCalledTimes(1);
    expect(animate).toHaveBeenCalledWith(1, expect.objectContaining({ duration: 550 }));
    unmount();
    expect(cancel).toHaveBeenCalledWith(result.current);
  });

  it('starts at the completed scene and never schedules motion when reduced motion is on', () => {
    vi.spyOn(Reanimated, 'useReducedMotion').mockReturnValue(true);
    const animate = vi.spyOn(Reanimated, 'withTiming');
    const { result } = renderHook(useSplashProgress);
    expect(result.current.value).toBe(1);
    expect(animate).not.toHaveBeenCalled();
  });

  it('clamps drawing phases so path trimming never goes outside its valid range', () => {
    expect(splashPhase(-1, 0.3, 0.9)).toBe(0);
    expect(splashPhase(2, 0.3, 0.9)).toBe(1);
    let previous = 0;
    for (let i = 0; i <= 100; i++) {
      const value = splashPhase(i / 100, 0.3, 0.9);
      expect(value).toBeGreaterThanOrEqual(previous);
      expect(value).toBeLessThanOrEqual(1);
      previous = value;
    }
  });

  it('lands both travelling lights on their stars and stops moving at completion', () => {
    expect(cometPoint(0, false)).toEqual({ x: 34, y: 48 });
    expect(cometPoint(0, true)).toEqual({ x: 228, y: 34 });
    expect(cometPoint(1, false)).toEqual({ x: 105, y: 101 });
    expect(cometPoint(1, true)).toEqual({ x: 168, y: 64 });
    for (const partner of [false, true]) {
      expect(cometPoint(2, partner)).toEqual(cometPoint(1, partner));
      for (let i = 0; i <= 100; i++) {
        const point = cometPoint(i / 100, partner);
        expect(point.x >= 0 && point.x <= 260 && point.y >= 0 && point.y <= 164).toBe(true);
      }
    }
  });

  it('keeps the trimmed trail attached to its light rather than treating path length as Bezier time', () => {
    for (const partner of [false, true]) {
      const points = Array.from({ length: 1001 }, (_, i) => cometPoint(i / 1000, partner));
      const lengths = [0];
      for (let i = 1; i < points.length; i++) {
        lengths.push(lengths[i - 1] + Math.hypot(points[i].x - points[i - 1].x, points[i].y - points[i - 1].y));
      }
      for (let i = 0; i < points.length; i += 25) {
        expect(Math.abs(cometTrim(i / 1000, partner) - lengths[i] / lengths[1000])).toBeLessThan(0.002);
      }
    }
  });

  it('lets the preview hold a real scene frame without starting an automatic clock', () => {
    const animate = vi.spyOn(Reanimated, 'withTiming');
    const { result } = renderHook(() => {
      const controlled = Reanimated.useSharedValue(0.4);
      return { controlled, progress: useSplashProgress(controlled) };
    });
    expect(result.current.progress).toBe(result.current.controlled);
    expect(animate).not.toHaveBeenCalled();
  });

  it('feeds every saved light/dark palette into finite normalized shader uniforms', () => {
    for (const id of BeachThemeOrder) {
      for (const mode of ['light', 'dark'] as const) {
        const colors = BeachThemes[id][mode];
        const uniforms = splashMaterialUniforms(colors, SPLASH_MOTIFS[id], 390, 844, 0);
        for (const rgba of [uniforms.uBase, uniforms.uSurface, uniforms.uInk, uniforms.uAccent, uniforms.uPartner]) {
          expect(rgba).toHaveLength(4);
          for (const value of rgba) expect(Number.isFinite(value) && value >= 0 && value <= 1).toBe(true);
        }
        expect(uniforms.uBase).toEqual(splashMaterialUniforms(colors, SPLASH_MOTIFS[id], 390, 844, 0).uBase);
      }
    }
  });
});

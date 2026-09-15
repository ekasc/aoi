import { readFileSync } from 'node:fs';

import { act, render } from '@testing-library/react';
import { createElement } from 'react';
import { AccessibilityInfo, AppState } from 'react-native';
import * as Reanimated from 'react-native-reanimated';
import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  RAIN_FADE_DURATION,
  WINDOW_RAIN_TRAILS,
  WindowRain,
  rainTimings,
} from '@/components/landing/window-rain';

const SOURCE = readFileSync('components/landing/window-rain.tsx', 'utf8');

afterEach(() => {
  vi.restoreAllMocks();
});

function rainRoot(container: HTMLElement): Element | null {
  return container.querySelector('[testid="window-rain"]');
}

describe('WindowRain tuning', () => {
  it('renders a few faint trails, not a particle shower', () => {
    expect(WINDOW_RAIN_TRAILS.length).toBeGreaterThanOrEqual(3);
    expect(WINDOW_RAIN_TRAILS.length).toBeLessThanOrEqual(4);
  });

  it('keeps every trail subtle: short thin streak, tiny droplet, low peak', () => {
    for (const trail of WINDOW_RAIN_TRAILS) {
      expect(trail.length).toBeGreaterThanOrEqual(24);
      expect(trail.length).toBeLessThanOrEqual(48);
      expect(trail.droplet).toBeGreaterThanOrEqual(2);
      expect(trail.droplet).toBeLessThanOrEqual(3);
      expect(trail.peak).toBeLessThanOrEqual(0.12);
    }
  });

  it('moves for seconds, then rests long and staggered', () => {
    for (const trail of WINDOW_RAIN_TRAILS) {
      expect(trail.slide).toBeGreaterThanOrEqual(3000);
      expect(trail.rest).toBeGreaterThan(trail.slide);
    }
    const delays = WINDOW_RAIN_TRAILS.map((trail) => trail.delay);
    expect(new Set(delays).size).toBe(delays.length);
  });
});

describe('WindowRain rendering', () => {
  it('confines motion to the top half and stays decorative', () => {
    const { container } = render(createElement(WindowRain));
    const root = rainRoot(container);
    expect(root).not.toBeNull();
    const style = (root as HTMLElement).style;
    expect(style.height).toBe('50%');
    expect(style.overflow).toBe('hidden');
    expect(root?.outerHTML).toContain('none');
    expect(root?.getAttribute('aria-hidden')).toBe('true');
    expect(
      container.querySelectorAll('[data-testid^="rain-trail-"]').length,
    ).toBe(WINDOW_RAIN_TRAILS.length);
  });

  it('removes trails under reduced motion', () => {
    vi.spyOn(Reanimated, 'useReducedMotion').mockReturnValue(true);
    const { container } = render(createElement(WindowRain));
    expect(rainRoot(container)).toBeNull();
  });

  it('removes trails when the system setting flips dynamically', () => {
    let reduceHandler: ((value: boolean) => void) | undefined;
    vi.spyOn(AccessibilityInfo, 'addEventListener').mockImplementation(
      (_event, handler) => {
        reduceHandler = handler as (value: boolean) => void;
        return { remove: () => {} };
      },
    );
    const { container } = render(createElement(WindowRain));
    expect(rainRoot(container)).not.toBeNull();
    act(() => reduceHandler?.(true));
    expect(rainRoot(container)).toBeNull();
  });

  it('removes trails when the route unfocuses', () => {
    const { container } = render(createElement(WindowRain, { focused: false }));
    expect(rainRoot(container)).toBeNull();
  });

  it('removes trails when the app backgrounds, restores on return', () => {
    let listener: ((state: string) => void) | undefined;
    vi.spyOn(AppState, 'addEventListener').mockImplementation(
      (_type, handler) => {
        listener = handler as (state: string) => void;
        return { remove: () => {} };
      },
    );
    const { container } = render(createElement(WindowRain));
    expect(rainRoot(container)).not.toBeNull();
    act(() => listener?.('background'));
    expect(rainRoot(container)).toBeNull();
    act(() => listener?.('active'));
    expect(rainRoot(container)).not.toBeNull();
  });

  it('cleans up listeners and cancels animations on unmount', () => {
    const remove = vi.fn();
    vi.spyOn(AppState, 'addEventListener').mockImplementation(() => ({ remove }));
    const cancelSpy = vi.spyOn(Reanimated, 'cancelAnimation');
    const { unmount } = render(createElement(WindowRain));
    unmount();
    expect(remove).toHaveBeenCalledTimes(1);
    expect(cancelSpy.mock.calls.length).toBeGreaterThanOrEqual(
      WINDOW_RAIN_TRAILS.length,
    );
  });
});

describe('WindowRain cycle behavior', () => {
  it('keeps y at full slide distance until the fade completes, then resets in the dark', () => {
    for (const trail of WINDOW_RAIN_TRAILS) {
      const timings = rainTimings(trail);
      expect(timings.yHold).toBe(trail.hold + RAIN_FADE_DURATION);
      expect(timings.yRest).toBe(trail.rest - RAIN_FADE_DURATION);
      expect(timings.yRest).toBeGreaterThan(0);
    }
  });

  it('matches y and opacity loop totals so cycles never drift apart', () => {
    for (const trail of WINDOW_RAIN_TRAILS) {
      const timings = rainTimings(trail);
      const total = trail.slide + trail.hold + trail.rest;
      const yTotal = trail.slide + timings.yHold + timings.yRest;
      const opacityTotal =
        RAIN_FADE_DURATION + timings.visibleHold + RAIN_FADE_DURATION + timings.darkRest;
      expect(yTotal).toBe(total);
      expect(opacityTotal).toBe(total);
    }
  });

  it('drives both loops from the shared timings', () => {
    expect(SOURCE).toContain('rainTimings(spec)');
    expect(SOURCE).toContain('timings.yHold');
    expect(SOURCE).toContain('timings.yRest');
    expect(SOURCE).toContain('timings.visibleHold');
    expect(SOURCE).toContain('timings.darkRest');
  });
});

describe('WindowRain source guards', () => {
  it('subscribes to the dynamic system setting, AppState, and web visibility', () => {
    expect(SOURCE).toContain('useReducedMotion');
    expect(SOURCE).toContain('isReduceMotionEnabled');
    expect(SOURCE).toContain('reduceMotionChanged');
    expect(SOURCE).toContain('AppState');
    expect(SOURCE).toContain('visibilitychange');
    expect(SOURCE).toContain('cancelAnimation');
  });

  it('uses no SVG and never touches headline or button layers', () => {
    expect(SOURCE).not.toContain('<Svg');
    expect(SOURCE).not.toContain('<svg');
    expect(SOURCE).not.toContain('react-native-svg');
    expect(SOURCE).not.toMatch(/headline|button|cta/i);
  });
});

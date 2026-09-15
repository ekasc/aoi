import { readFileSync } from 'node:fs';
import { act, render } from '@testing-library/react';
import { createElement } from 'react';
import { AccessibilityInfo, AppState } from 'react-native';
import * as Reanimated from 'react-native-reanimated';
import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  DAY_SKY_STAR_PARTNER,
  DAY_SKY_STAR_YOU,
  LIGHT_SKY_MID,
  LIGHT_SKY_TOP,
  isDarkBackground,
  MEMORY_SKY_CLOUD_A,
  MEMORY_SKY_CLOUD_B,
  MEMORY_SKY_MAX_STARS,
  MEMORY_SKY_QUARTER,
  MEMORY_SKY_TWINKLE_GAP_MAX,
  MEMORY_SKY_TWINKLE_GAP_MIN,
  MEMORY_SKY_TWINKLE_ON_MS,
  MemorySky,
  hashMomentId,
  isBrightDayStar,
  sparkleRotationDeg,
  starForMoment,
  starRestOpacity,
  starToneColor,
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

function makeMoment(id: string, authorRole: 'you' | 'partner' = 'partner') {
  return {
    id,
    type: 'note' as const,
    title: `Title ${id}`,
    body: 'body',
    occurredAt: '2026-02-08T09:15:00.000Z',
    createdAt: '2026-02-08T09:16:00.000Z',
    authorId: authorRole === 'partner' ? 'user_partner' : 'user_you',
    authorRole,
    authorName: authorRole === 'partner' ? 'Alex' : 'You',
  };
}

function skyRoot(container: HTMLElement): Element | null {
  return container.querySelector('[data-testid="memory-sky"], [testid="memory-sky"]');
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

/** Batched field: dots are Circles, bright sparkles are Groups (3 bucket Groups). */
function starCounts(canvas: HTMLElement): { dots: number; brights: number; total: number } {
  const dots = canvas.querySelectorAll('[data-skia="Circle"]').length;
  const groups = canvas.querySelectorAll('[data-skia="Group"]').length;
  const brights = groups - 3;
  return { dots, brights, total: dots + brights };
}

function twinkleOverlay(container: HTMLElement): HTMLElement | null {
  return container.querySelector(
    '[data-testid="memory-sky-twinkle"], [testid="memory-sky-twinkle"]',
  ) as HTMLElement | null;
}

function emptyStar(container: HTMLElement): Element | null {
  return container.querySelector(
    '[data-testid="memory-sky-star-empty"], [testid="memory-sky-star-empty"]',
  );
}

function cloudByName(container: HTMLElement, name: 'a' | 'b'): HTMLElement | null {
  return container.querySelector(
    `[data-testid="memory-sky-cloud-${name}"], [testid="memory-sky-cloud-${name}"]`,
  ) as HTMLElement | null;
}

function captionEl(container: HTMLElement): HTMLElement | null {
  const spans = Array.from(container.querySelectorAll('span')) as HTMLElement[];
  return spans.find((el) => /lighting your sky|Keep your first memory/.test(el.textContent ?? '')) ?? null;
}

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe('MemorySky star count capping (memory fallback)', () => {
  it('caps at 40 stars but captions the real count', () => {
    const moments = Array.from({ length: 50 }, (_, i) =>
      makeMoment(`m-${i}`, i % 2 === 0 ? 'partner' : 'you'),
    );
    const { container, unmount } = render(createElement(MemorySky, { moments }));
    expect(MEMORY_SKY_MAX_STARS).toBe(40);
    const canvas = skyCanvas(container);
    expect(canvas).not.toBeNull();
    expect(starCounts(canvas as HTMLElement).total).toBe(40);
    expect(container.textContent).toContain('50 memories lighting your sky');
    unmount();
  });

  it('uses singular copy for one memory and plural otherwise', () => {
    const one = render(createElement(MemorySky, { moments: [makeMoment('solo')] }));
    expect(one.container.textContent).toContain('1 memory lighting your sky');
    expect(one.container.textContent).not.toContain('memories');
    one.unmount();

    const two = render(
      createElement(MemorySky, { moments: [makeMoment('a'), makeMoment('b')] }),
    );
    expect(two.container.textContent).toContain('2 memories lighting your sky');
    two.unmount();
  });

  it('is cardless: no panel background/border, gradient fades to themed bg', () => {
    const { container, unmount } = render(
      createElement(MemorySky, { moments: [makeMoment('m-1')] }),
    );
    const strip = skyStrip(container);
    expect(strip).not.toBeNull();
    expect((strip as HTMLElement).style.backgroundColor).toBe('transparent');
    expect((strip as HTMLElement).style.borderWidth).toBeFalsy();
    expect(SOURCE).not.toContain('surfaceSubtle');
    expect(SOURCE).not.toContain('borderWidth');
    expect(SOURCE).not.toContain('borderColor');
    expect(SOURCE).toContain('transparent');
    expect(SOURCE).toContain('LinearGradient');
    expect(SOURCE).toContain('LIGHT_SKY_TOP');
    expect(SOURCE).toContain('DARK_SKY_TOP');
    unmount();
  });
});

describe('MemorySky absolute quarter sky', () => {
  it('covers the top quarter (25% of window) including the notch', () => {
    expect(MEMORY_SKY_QUARTER).toBe(0.3);
    const { container, unmount } = render(
      createElement(MemorySky, { moments: [makeMoment('m-1')] }),
    );
    const strip = skyStrip(container);
    expect(strip).not.toBeNull();
    const style = (strip as HTMLElement).style;
    expect(style.position).toBe('absolute');
    // 844pt mocked window height * 0.30 = 253pt (+12 safety = 265pt).
    expect(style.height).toBe('265px');
    // Starts above the safe area (notch top 47 mocked): extends upward.
    expect(parseFloat(style.top)).toBeLessThanOrEqual(-47);
    // Full-bleed over the content padding.
    expect(style.left).toBe('-16px');
    expect(style.right).toBe('-16px');
    expect(SOURCE).toContain('useWindowDimensions');
    expect(SOURCE).toContain('useSafeAreaInsets');
    unmount();
  });

  it('keeps the caption small and quiet below the strip in normal flow', () => {
    const { container, unmount } = render(
      createElement(MemorySky, { moments: [makeMoment('m-1')] }),
    );
    const strip = skyStrip(container);
    const caption = captionEl(container);
    expect(strip).not.toBeNull();
    expect(caption).not.toBeNull();
    expect((caption as HTMLElement).style.position).not.toBe('absolute');
    expect(parseFloat((caption as HTMLElement).style.marginTop)).toBeGreaterThan(0);
    expect((caption as HTMLElement).style.textAlign).toBe('center');
    expect(strip?.compareDocumentPosition(caption as Node) ?? 0).toBeGreaterThan(0);
    expect(SOURCE).toContain('type="caption"');
    unmount();
  });
});

describe('MemorySky batched star field (main canvas + feather veil, no per-star views)', () => {
  it('renders the field with dots plus a few tapered bright sparkles', () => {
    const moments = Array.from({ length: 12 }, (_, i) => makeMoment(`s-${i}`));
    const { container, unmount } = render(createElement(MemorySky, { moments }));
    const canvases = container.querySelectorAll(
      '[data-testid="skia-canvas"], [testid="skia-canvas"]',
    );
    // Main field + bottom feather veil (transparent -> background, no BlurView).
    expect(canvases).toHaveLength(2);
    const counts = starCounts(canvases[0] as HTMLElement);
    expect(counts.total).toBe(12);
    // Mostly tiny points: bright sparkles are the minority.
    expect(counts.brights).toBeLessThan(counts.total);
    expect(SOURCE).toContain('buildDaySkyField');
    expect(SOURCE).toContain('bucketStarsByDepth');
    expect(SOURCE).toContain('projectWorldToScreen');
    unmount();
  });

  it('paints the background gradient first, then far/mid/near buckets', () => {
    const { container, unmount } = render(
      createElement(MemorySky, { moments: [makeMoment('g-1'), makeMoment('g-2')] }),
    );
    const canvas = skyCanvas(container);
    expect(canvas).not.toBeNull();
    const first = (canvas as HTMLElement).children[0];
    expect(first?.getAttribute('data-skia')).toBe('Rect');
    const groups = Array.from((canvas as HTMLElement).children).filter(
      (el) => el.getAttribute('data-skia') === 'Group',
    );
    expect(groups).toHaveLength(3);
    unmount();
  });

  it('uses no glow-sprite images, emoji, or svg for stars', () => {
    const { container, unmount } = render(
      createElement(MemorySky, { moments: [makeMoment('glyph-1')] }),
    );
    expect(container.querySelector('svg')).toBeNull();
    expect(SOURCE).not.toContain('star-glow');
    expect(SOURCE).not.toContain('<Svg');
    expect(SOURCE).not.toContain('<svg');
    expect(SOURCE).not.toContain('react-native-svg');
    expect(SOURCE).not.toContain('particles');
    for (const glyph of ['★', '✦', '✨', '⭐', '🌟', '✧']) {
      expect(SOURCE).not.toContain(glyph);
    }
    unmount();
  });

  it('has no oscillating drift layers and no shooting streak', async () => {
    vi.spyOn(Reanimated, 'useReducedMotion').mockReturnValue(false);
    vi.useFakeTimers();
    const view = render(
      createElement(MemorySky, { moments: [makeMoment('n-1'), makeMoment('n-2')] }),
    );
    expect(SOURCE).not.toContain('MEMORY_SKY_DRIFT');
    expect(SOURCE).not.toContain('MEMORY_SKY_SHOOTING');
    expect(SOURCE).not.toContain('DriftLayer');
    expect(SOURCE).not.toContain('ShootingStar');
    expect(SOURCE).not.toContain('withDelay');
    await act(async () => {
      vi.advanceTimersByTime(45000);
    });
    expect(
      view.container.querySelector(
        '[data-testid="memory-sky-shooting-star"], [data-testid^="memory-sky-layer-"]',
      ),
    ).toBeNull();
    view.unmount();
  });
});

describe('MemorySky deterministic layout + starlight tones', () => {
  it('hashes ids stably and derives 2-4px cores with percentage positions', () => {
    expect(hashMomentId('abc')).toBe(hashMomentId('abc'));
    expect(starForMoment('abc')).toEqual(starForMoment('abc'));
    for (const id of ['m-1', 'm-2', 'hello', 'x'.repeat(40)]) {
      const layout = starForMoment(id);
      expect(layout.leftPct).toBeGreaterThanOrEqual(2);
      expect(layout.leftPct).toBeLessThanOrEqual(95);
      // Lower two-thirds: top third stays clear behind the toolbar title.
      expect(layout.topPct).toBeGreaterThanOrEqual(34);
      expect(layout.topPct).toBeLessThanOrEqual(91);
      expect(layout.size).toBeGreaterThanOrEqual(2);
      expect(layout.size).toBeLessThanOrEqual(4);
    }
  });

  it('lays out identically across rerenders', () => {
    const moments = [makeMoment('keep-1'), makeMoment('keep-2'), makeMoment('keep-3')];
    const first = render(createElement(MemorySky, { moments }));
    const firstCounts = starCounts(skyCanvas(first.container) as HTMLElement);
    first.unmount();
    const second = render(createElement(MemorySky, { moments }));
    expect(starCounts(skyCanvas(second.container) as HTMLElement)).toEqual(firstCounts);
    second.unmount();
  });

  it('maps tones to distinct warm starlight (partner gold, yours rose)', () => {
    expect(starToneColor('partner')).toBe(DAY_SKY_STAR_PARTNER);
    expect(starToneColor('you')).toBe(DAY_SKY_STAR_YOU);
    expect(DAY_SKY_STAR_PARTNER).not.toBe(DAY_SKY_STAR_YOU);
    expect(SOURCE).toContain("authorRole === 'partner'");
  });

  it('keeps rest opacity in range and rotations varied but bounded', () => {
    for (const id of ['m-1', 'rot-a', 'rot-b', 'hello']) {
      expect(starRestOpacity(id)).toEqual(starRestOpacity(id));
      expect(starRestOpacity(id)).toBeGreaterThanOrEqual(0.15);
      expect(starRestOpacity(id)).toBeLessThanOrEqual(0.5);
      expect(sparkleRotationDeg(id)).toEqual(sparkleRotationDeg(id));
      expect(sparkleRotationDeg(id)).toBeGreaterThanOrEqual(-12);
      expect(sparkleRotationDeg(id)).toBeLessThanOrEqual(12);
    }
    const degs = new Set(['a', 'b', 'c', 'd', 'e', 'f', 'g'].map(sparkleRotationDeg));
    expect(degs.size).toBeGreaterThan(1);
  });

  it('earns bright sparkles rarely and deterministically', () => {
    expect(isBrightDayStar(3)).toBe(isBrightDayStar(3));
    let bright = 0;
    const total = 1600;
    for (let dayIndex = 0; dayIndex < total; dayIndex += 1) {
      if (isBrightDayStar(dayIndex)) {
        bright += 1;
      }
    }
    expect(bright).toBeGreaterThan(0);
    expect(bright / total).toBeLessThan(0.15);
  });
});

describe('MemorySky textured cloud banks', () => {
  it('drifts two generated banks in front of the stars', () => {
    expect(MEMORY_SKY_CLOUD_A.durationMs).toBeGreaterThan(30000);
    expect(MEMORY_SKY_CLOUD_B.durationMs).toBeGreaterThan(30000);
    const { container, unmount } = render(
      createElement(MemorySky, { moments: [makeMoment('c-1')] }),
    );
    expect(cloudByName(container, 'a')).not.toBeNull();
    expect(cloudByName(container, 'b')).not.toBeNull();
    expect(SOURCE).toContain('memory-sky-cloud-a');
    expect(SOURCE).toContain('memory-sky-cloud-b');
    expect(SOURCE).toContain('MEMORY_SKY_CLOUD_ASPECT');
    expect(SOURCE).toContain('contentFit="cover"');
    expect(SOURCE).toContain('translateX');
    expect(SOURCE).toContain('Easing.inOut(Easing.sin)');
    unmount();
  });

  it('keeps clouds static but visible under reduced motion', () => {
    vi.spyOn(Reanimated, 'useReducedMotion').mockReturnValue(true);
    const repeatSpy = vi.spyOn(Reanimated, 'withRepeat');
    vi.useFakeTimers();
    const { container, unmount } = render(
      createElement(MemorySky, { moments: [makeMoment('c-1')] }),
    );
    expect(cloudByName(container, 'a')).not.toBeNull();
    expect(cloudByName(container, 'b')).not.toBeNull();
    expect(repeatSpy).not.toHaveBeenCalled();
    expect(vi.getTimerCount()).toBe(0);
    unmount();
  });
});

describe('MemorySky empty state', () => {
  it('shows one dim star and the first-memory caption', () => {
    const { container, unmount } = render(createElement(MemorySky, { moments: [] }));
    expect(emptyStar(container)).not.toBeNull();
    expect(container.textContent).toContain('Keep your first memory and light the sky');
    unmount();
  });
});

describe('MemorySky decorative a11y', () => {
  it('is pointer-events none, non-accessible, and hidden from screen readers', () => {
    const { container, unmount } = render(
      createElement(MemorySky, { moments: [makeMoment('m-1')] }),
    );
    const root = skyRoot(container);
    expect(root).not.toBeNull();
    expect(root?.getAttribute('aria-hidden')).toBe('true');
    expect(root?.outerHTML).toContain('none');
    expect(SOURCE).toContain('pointerEvents="none"');
    expect(SOURCE).toContain('accessible={false}');
    expect(SOURCE).toContain('accessibilityElementsHidden');
    expect(SOURCE).toContain('importantForAccessibility="no-hide-descendants"');
    expect(SOURCE).toContain('aria-hidden');
    unmount();
  });
});

describe('MemorySky single twinkle loop', () => {
  it('owns exactly one timer and twinkles one star at a time, then clears', async () => {
    vi.spyOn(Reanimated, 'useReducedMotion').mockReturnValue(false);
    vi.useFakeTimers();
    const view = render(
      createElement(MemorySky, {
        moments: [makeMoment('t-1'), makeMoment('t-2'), makeMoment('t-3')],
      }),
    );
    // One twinkle gap timer for the whole sky, not one per star.
    expect(vi.getTimerCount()).toBe(1);
    expect(twinkleOverlay(view.container)).toBeNull();
    let sawOne = false;
    for (let t = 0; t < MEMORY_SKY_TWINKLE_GAP_MAX; t += 200) {
      await act(async () => {
        vi.advanceTimersByTime(200);
      });
      expect(
        view.container.querySelectorAll(
          '[data-testid="memory-sky-twinkle"], [testid="memory-sky-twinkle"]',
        ).length,
      ).toBeLessThanOrEqual(1);
      if (twinkleOverlay(view.container) !== null) {
        sawOne = true;
        break;
      }
    }
    expect(sawOne).toBe(true);
    await act(async () => {
      vi.advanceTimersByTime(MEMORY_SKY_TWINKLE_ON_MS);
    });
    expect(twinkleOverlay(view.container)).toBeNull();
    view.unmount();
    expect(vi.getTimerCount()).toBe(0);
  });

  it('bounds gaps 1800-4200ms with a 900ms showcase and no per-star timers', async () => {
    vi.spyOn(Reanimated, 'useReducedMotion').mockReturnValue(false);
    expect(MEMORY_SKY_TWINKLE_GAP_MIN).toBe(1800);
    expect(MEMORY_SKY_TWINKLE_GAP_MAX).toBe(4200);
    expect(MEMORY_SKY_TWINKLE_ON_MS).toBe(900);
    vi.useFakeTimers();
    const timeoutSpy = vi.spyOn(globalThis, 'setTimeout');
    const view = render(
      createElement(MemorySky, { moments: [makeMoment('g-1'), makeMoment('g-2')] }),
    );
    expect(timeoutSpy).toHaveBeenCalledTimes(1);
    const firstGap = timeoutSpy.mock.calls[0][1] as number;
    expect(firstGap).toBeGreaterThanOrEqual(MEMORY_SKY_TWINKLE_GAP_MIN);
    expect(firstGap).toBeLessThanOrEqual(MEMORY_SKY_TWINKLE_GAP_MAX);
    await act(async () => {
      vi.advanceTimersByTime(60000);
    });
    const delays = timeoutSpy.mock.calls.map((c) => c[1] as number);
    expect(delays.length).toBeGreaterThan(6);
    for (const d of delays) {
      const isShowcase = d === MEMORY_SKY_TWINKLE_ON_MS;
      const isGap =
        d >= MEMORY_SKY_TWINKLE_GAP_MIN && d <= MEMORY_SKY_TWINKLE_GAP_MAX;
      expect(isShowcase || isGap).toBe(true);
    }
    expect(SOURCE).toContain('Math.random');
    expect(SOURCE).toContain('setTwinkleKey');
    view.unmount();
  });

  it('schedules no timers at all under reduced motion', async () => {
    vi.spyOn(Reanimated, 'useReducedMotion').mockReturnValue(true);
    const timingSpy = vi.spyOn(Reanimated, 'withTiming');
    const repeatSpy = vi.spyOn(Reanimated, 'withRepeat');
    vi.useFakeTimers();
    const view = render(
      createElement(MemorySky, { moments: [makeMoment('rm-1'), makeMoment('rm-2')] }),
    );
    expect(vi.getTimerCount()).toBe(0);
    await act(async () => {
      vi.advanceTimersByTime(60000);
    });
    expect(twinkleOverlay(view.container)).toBeNull();
    expect(timingSpy).not.toHaveBeenCalled();
    expect(repeatSpy).not.toHaveBeenCalled();
    // The static field still paints every star.
    expect(starCounts(skyCanvas(view.container) as HTMLElement).total).toBe(2);
    view.unmount();
    expect(vi.getTimerCount()).toBe(0);
  });
});

describe('MemorySky arrival celebration', () => {
  it('showcases the newest memory once on growth with a Light haptic', async () => {
    vi.spyOn(Reanimated, 'useReducedMotion').mockReturnValue(false);
    const Haptics = await import('expo-haptics');
    const hapticSpy = vi.spyOn(Haptics, 'impactAsync');
    const view = render(createElement(MemorySky, { moments: [makeMoment('arr-1')] }));
    expect(hapticSpy).not.toHaveBeenCalled();
    act(() => {
      view.rerender(createElement(MemorySky, { moments: [makeMoment('arr-1'), makeMoment('arr-2')] }));
    });
    expect(hapticSpy).toHaveBeenCalledTimes(1);
    expect(hapticSpy).toHaveBeenCalledWith(Haptics.ImpactFeedbackStyle.Light);
    // Newest star showcases immediately (no gap wait).
    const overlay = twinkleOverlay(view.container);
    expect(overlay).not.toBeNull();
    expect(overlay?.getAttribute('data-star-key')).toBe('arr-2');
    expect(SOURCE).toContain('prevCountRef');
    expect(SOURCE).toContain('expo-haptics');
    expect(SOURCE).toContain('ImpactFeedbackStyle.Light');
    expect(SOURCE).not.toContain('withSpring');
    view.unmount();
  });

  it('does not celebrate on shrink or same-count rerender', async () => {
    vi.spyOn(Reanimated, 'useReducedMotion').mockReturnValue(false);
    const Haptics = await import('expo-haptics');
    const hapticSpy = vi.spyOn(Haptics, 'impactAsync');
    const view = render(
      createElement(MemorySky, { moments: [makeMoment('s-1'), makeMoment('s-2')] }),
    );
    expect(hapticSpy).not.toHaveBeenCalled();
    act(() => {
      view.rerender(createElement(MemorySky, { moments: [makeMoment('s-1')] }));
    });
    expect(hapticSpy).not.toHaveBeenCalled();
    view.unmount();
  });

  it('stays static with no haptic when reduced motion', async () => {
    vi.spyOn(Reanimated, 'useReducedMotion').mockReturnValue(true);
    const Haptics = await import('expo-haptics');
    const hapticSpy = vi.spyOn(Haptics, 'impactAsync');
    const view = render(createElement(MemorySky, { moments: [makeMoment('rm-1')] }));
    act(() => {
      view.rerender(
        createElement(MemorySky, { moments: [makeMoment('rm-1'), makeMoment('rm-2')] }),
      );
    });
    expect(hapticSpy).not.toHaveBeenCalled();
    expect(twinkleOverlay(view.container)).toBeNull();
    view.unmount();
  });
});

describe('MemorySky focus/background pause and cleanup', () => {
  it('mirrors the window-rain pause signals in source', () => {
    expect(SOURCE).toContain('useReducedMotion');
    expect(SOURCE).toContain('isReduceMotionEnabled');
    expect(SOURCE).toContain('reduceMotionChanged');
    expect(SOURCE).toContain('AppState');
    expect(SOURCE).toContain('visibilitychange');
    expect(SOURCE).toContain('cancelAnimation');
    expect(SOURCE).toContain('focused');
  });

  it('pauses timers when the app backgrounds and resumes on return', async () => {
    vi.spyOn(Reanimated, 'useReducedMotion').mockReturnValue(false);
    let appHandler: ((state: string) => void) | undefined;
    vi.spyOn(AppState, 'addEventListener').mockImplementation(
      (_type, handler) => {
        appHandler = handler as (state: string) => void;
        return { remove: () => {} };
      },
    );
    vi.useFakeTimers();
    const view = render(
      createElement(MemorySky, { moments: [makeMoment('bg-1'), makeMoment('bg-2')] }),
    );
    expect(vi.getTimerCount()).toBe(1);
    await act(async () => {
      appHandler?.('background');
    });
    expect(vi.getTimerCount()).toBe(0);
    expect(twinkleOverlay(view.container)).toBeNull();
    await act(async () => {
      appHandler?.('active');
    });
    expect(vi.getTimerCount()).toBe(1);
    view.unmount();
    expect(vi.getTimerCount()).toBe(0);
  });

  it('pauses everything when the system setting flips dynamically', async () => {
    vi.spyOn(Reanimated, 'useReducedMotion').mockReturnValue(false);
    let reduceHandler: ((value: boolean) => void) | undefined;
    vi.spyOn(AccessibilityInfo, 'addEventListener').mockImplementation(
      (_event, handler) => {
        reduceHandler = handler as (value: boolean) => void;
        return { remove: () => {} };
      },
    );
    vi.useFakeTimers();
    const view = render(
      createElement(MemorySky, { moments: [makeMoment('sys-1'), makeMoment('sys-2')] }),
    );
    expect(vi.getTimerCount()).toBe(1);
    act(() => {
      reduceHandler?.(true);
    });
    expect(vi.getTimerCount()).toBe(0);
    expect(twinkleOverlay(view.container)).toBeNull();
    view.unmount();
  });

  it('cancels cloud and twinkle animations plus all timers on unmount', async () => {
    vi.spyOn(Reanimated, 'useReducedMotion').mockReturnValue(false);
    vi.useFakeTimers();
    const view = render(
      createElement(MemorySky, { moments: [makeMoment('un-1'), makeMoment('un-2')] }),
    );
    expect(vi.getTimerCount()).toBe(1);
    const cancelSpy = vi.spyOn(Reanimated, 'cancelAnimation');
    view.unmount();
    expect(vi.getTimerCount()).toBe(0);
    expect(cancelSpy.mock.calls.length).toBeGreaterThanOrEqual(2);
    await act(async () => {
      vi.advanceTimersByTime(60000);
    });
    expect(vi.getTimerCount()).toBe(0);
  });

  it('never shows a twinkle when unfocused and schedules no timers', async () => {
    vi.spyOn(Reanimated, 'useReducedMotion').mockReturnValue(false);
    const timingSpy = vi.spyOn(Reanimated, 'withTiming');
    const repeatSpy = vi.spyOn(Reanimated, 'withRepeat');
    vi.useFakeTimers();
    const view = render(
      createElement(MemorySky, { moments: [makeMoment('sh-u-1')], focused: false }),
    );
    expect(vi.getTimerCount()).toBe(0);
    await act(async () => {
      vi.advanceTimersByTime(60000);
    });
    expect(twinkleOverlay(view.container)).toBeNull();
    expect(timingSpy).not.toHaveBeenCalled();
    expect(repeatSpy).not.toHaveBeenCalled();
    // Static field still paints.
    expect(starCounts(skyCanvas(view.container) as HTMLElement).total).toBe(1);
    view.unmount();
  });
});

describe('MemorySky sky palette', () => {
  it('keeps the wine dusk stops and fades into the themed background', () => {
    expect(LIGHT_SKY_TOP).toBeTruthy();
    expect(LIGHT_SKY_MID).toBeTruthy();
    expect(LIGHT_SKY_TOP).not.toBe(LIGHT_SKY_MID);
    expect(SOURCE).toContain('DARK_SKY_TOP');
    expect(SOURCE).toContain('DARK_SKY_MID');
  });

  it('picks dusk stops from the live background, not the system scheme', () => {
    expect(isDarkBackground('#F6F2F7')).toBe(false);
    expect(isDarkBackground('#120D13')).toBe(true);
    expect(isDarkBackground('rgb(246, 242, 247)')).toBe(false);
    expect(isDarkBackground('rgb(18, 13, 19)')).toBe(true);
  });
});

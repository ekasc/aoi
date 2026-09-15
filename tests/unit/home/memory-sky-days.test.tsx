import { readFileSync } from 'node:fs';
import { act, render } from '@testing-library/react';
import { createElement } from 'react';
import * as Reanimated from 'react-native-reanimated';
import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  MEMORY_SKY_FOCAL_BRIGHT_MAX,
  MEMORY_SKY_TWINKLE_GAP_MAX,
  MEMORY_SKY_TWINKLE_ON_MS,
  MemorySky,
  isBrightDayStar,
  starToneColor,
} from '@/components/home/memory-sky';
import {
  DAY_SKY_WORLD_CENTER,
  cameraForRelationship,
  screenPositionForDay,
  sizeForDay,
} from '@/features/home/day-sky-spatial';

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
const DAY_SKY_SOURCE = readFileSync('features/home/day-sky.ts', 'utf8');

function makeMoment(id: string, occurredAt: string, authorRole: 'you' | 'partner' = 'partner') {
  return {
    id,
    type: 'note' as const,
    title: `Title ${id}`,
    body: 'body',
    occurredAt,
    createdAt: occurredAt,
    authorId: authorRole === 'partner' ? 'user_partner' : 'user_you',
    authorRole,
    authorName: authorRole === 'partner' ? 'Alex' : 'You',
  };
}

function localNoonIso(year: number, monthIndex: number, day: number): string {
  return new Date(year, monthIndex, day, 12, 0, 0, 0).toISOString();
}

const FIXED_NOW = new Date(2026, 5, 1);

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

function bucketChildCounts(canvas: HTMLElement): number[] {
  const groups = Array.from(canvas.children).filter(
    (el) => el.getAttribute('data-skia') === 'Group',
  );
  return groups.map((g) => g.childElementCount);
}

function twinkleOverlay(container: HTMLElement): HTMLElement | null {
  return container.querySelector(
    '[data-testid="memory-sky-twinkle"], [testid="memory-sky-twinkle"]',
  ) as HTMLElement | null;
}

function captionText(container: HTMLElement): string {
  return container.textContent ?? '';
}

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe('MemorySky day mode: one star per day', () => {
  it('renders one star per day together (not per memory)', () => {
    const moments = [
      makeMoment('m1', localNoonIso(2026, 1, 8), 'partner'),
      makeMoment('m2', localNoonIso(2026, 1, 8), 'partner'),
      makeMoment('m3', localNoonIso(2026, 1, 9), 'you'),
    ];
    const { container, unmount } = render(
      createElement(MemorySky, { moments, daysTogether: 5, startDate: '2026-02-08', now: FIXED_NOW }),
    );
    expect(starCounts(skyCanvas(container) as HTMLElement).total).toBe(5);
    expect(captionText(container)).toContain('5 days lighting your sky');
    unmount();
  });

  it('maps memory days to warm tones (partner gold, yours rose, dim rest)', () => {
    // Skia colors do not reach the DOM under test, so tones are verified
    // at the mapping boundary plus the renderer wiring in source.
    expect(starToneColor('partner')).not.toBe(starToneColor('you'));
    expect(starToneColor('you')).not.toBe(starToneColor('dim'));
    expect(SOURCE).toContain('starToneColor(star.tone)');
    const { container, unmount } = render(
      createElement(MemorySky, { moments: [], daysTogether: 3, startDate: '2026-02-08', now: FIXED_NOW }),
    );
    expect(starCounts(skyCanvas(container) as HTMLElement).total).toBe(3);
    unmount();
  });

  it('renders every day with no legacy 120 cap', () => {
    expect(DAY_SKY_SOURCE).not.toContain('DAY_SKY_MAX_STARS');
    const view = render(
      createElement(MemorySky, { moments: [], daysTogether: 120, startDate: '2024-01-01', now: FIXED_NOW }),
    );
    expect(starCounts(skyCanvas(view.container) as HTMLElement).total).toBe(120);
    view.unmount();

    const grown = render(
      createElement(MemorySky, { moments: [], daysTogether: 200, startDate: '2024-01-01', now: FIXED_NOW }),
    );
    expect(starCounts(skyCanvas(grown.container) as HTMLElement).total).toBe(200);
    grown.unmount();
  });

  it('renders deterministically across mounts', () => {
    const first = render(
      createElement(MemorySky, { moments: [], daysTogether: 30, startDate: '2026-02-08', now: FIXED_NOW }),
    );
    const counts = starCounts(skyCanvas(first.container) as HTMLElement);
    expect(counts.total).toBe(30);
    first.unmount();

    const second = render(
      createElement(MemorySky, { moments: [], daysTogether: 30, startDate: '2026-02-08', now: FIXED_NOW }),
    );
    expect(starCounts(skyCanvas(second.container) as HTMLElement)).toEqual(counts);
    second.unmount();
  });

  it('captions singular for 1 day and plural otherwise', () => {
    const one = render(
      createElement(MemorySky, { moments: [], daysTogether: 1, startDate: '2026-02-08', now: FIXED_NOW }),
    );
    expect(captionText(one.container)).toContain('1 day lighting your sky');
    expect(captionText(one.container)).not.toContain('days lighting');
    one.unmount();

    const many = render(
      createElement(MemorySky, { moments: [], daysTogether: 5, startDate: '2026-02-08', now: FIXED_NOW }),
    );
    expect(captionText(many.container)).toContain('5 days lighting your sky');
    many.unmount();
  });
});

describe('MemorySky day buckets and anniversary camera', () => {
  it('paints far/mid/near buckets matching the spatial depth split', () => {
    const total = 120;
    const { container, unmount } = render(
      createElement(MemorySky, { moments: [], daysTogether: total, startDate: '2026-02-08', now: FIXED_NOW }),
    );
    const canvas = skyCanvas(container) as HTMLElement;
    const expected = [2, 3, 4].map(
      (size) =>
        Array.from({ length: total }, (_, dayIndex) => dayIndex).filter(
          (dayIndex) => sizeForDay(dayIndex) === size,
        ).length,
    );
    expect(expected.every((n) => n > 0)).toBe(true);
    expect(bucketChildCounts(canvas)).toEqual(expected);
    unmount();
  });

  it('keeps every anniversary star on screen via the pull-back camera', () => {
    // Calendar camera: compact in year one, stepped out per anniversary.
    // Coherent calendar pairs: Jan 1 -> Jun 1 2024 is 153 days together,
    // Jan 1 2024 -> Feb 3 2025 is 400 days together.
    expect(cameraForRelationship('2024-01-01', new Date(2024, 5, 1)).zoom).toBe(1);
    expect(cameraForRelationship('2024-01-01', new Date(2025, 1, 3)).zoom).toBeGreaterThan(1);
    const yearOne = render(
      createElement(MemorySky, { moments: [], daysTogether: 153, startDate: '2024-01-01', now: new Date(2024, 5, 1) }),
    );
    expect(starCounts(skyCanvas(yearOne.container) as HTMLElement).total).toBe(153);
    yearOne.unmount();
    const older = render(
      createElement(MemorySky, { moments: [], daysTogether: 400, startDate: '2024-01-01', now: new Date(2025, 1, 3) }),
    );
    // Full 400-day field at its anniversary camera: nothing lost with age.
    expect(starCounts(skyCanvas(older.container) as HTMLElement).total).toBe(400);
    older.unmount();
  });

  it('pulls the same day toward the center after the anniversary (pure model)', () => {
    const yearOneZoom = cameraForRelationship('2024-01-01', new Date(2024, 5, 1)).zoom;
    const anniversaryZoom = cameraForRelationship('2024-01-01', new Date(2025, 1, 3)).zoom;
    expect(anniversaryZoom).toBeGreaterThan(yearOneZoom);
    const dayIndex = 30;
    const yearOneScreen = screenPositionForDay(dayIndex, yearOneZoom);
    const anniversaryScreen = screenPositionForDay(dayIndex, anniversaryZoom);
    const displacement = (p: { x: number; y: number }) =>
      Math.hypot(p.x - DAY_SKY_WORLD_CENTER.x, p.y - DAY_SKY_WORLD_CENTER.y);
    expect(displacement(yearOneScreen)).toBeGreaterThan(0);
    expect(displacement(anniversaryScreen)).toBeLessThan(displacement(yearOneScreen));
  });

  it('keeps bright sparkles a small minority of the field', () => {
    const { container, unmount } = render(
      createElement(MemorySky, { moments: [], daysTogether: 307, startDate: '2025-08-06', now: FIXED_NOW }),
    );
    const counts = starCounts(skyCanvas(container) as HTMLElement);
    expect(counts.total).toBe(307);
    expect(counts.brights).toBeGreaterThanOrEqual(1);
    expect(counts.brights).toBeLessThan(counts.total / 2);
    // Focal cap: at most ~12-18 large sparkles; the rest are faint dots.
    expect(MEMORY_SKY_FOCAL_BRIGHT_MAX).toBe(16);
    expect(counts.brights).toBeLessThanOrEqual(MEMORY_SKY_FOCAL_BRIGHT_MAX);
    expect(isBrightDayStar(0)).toBe(isBrightDayStar(0));
    unmount();
  });

  it('caps focal sparkles at 1303 days with no truncation of the model', () => {
    const { container, unmount } = render(
      createElement(MemorySky, { moments: [], daysTogether: 1303, startDate: '2022-11-06', now: FIXED_NOW }),
    );
    const counts = starCounts(skyCanvas(container) as HTMLElement);
    // One star per day: every day still plotted, none dropped.
    expect(counts.total).toBe(1303);
    // ...but only a focal few keep large rays (deterministic by day hash).
    expect(counts.brights).toBeLessThanOrEqual(MEMORY_SKY_FOCAL_BRIGHT_MAX);
    expect(counts.brights).toBeGreaterThanOrEqual(1);
    expect(SOURCE).toContain('MEMORY_SKY_FOCAL_BRIGHT_MAX');
    unmount();
  });
});

describe('MemorySky day single twinkle loop', () => {
  it('twinkles exactly one day star at a time then clears after 900ms', async () => {
    vi.spyOn(Reanimated, 'useReducedMotion').mockReturnValue(false);
    vi.useFakeTimers();
    const view = render(
      createElement(MemorySky, { moments: [], daysTogether: 4, startDate: '2026-02-08', now: FIXED_NOW }),
    );
    // One twinkle timer for the whole sky.
    expect(vi.getTimerCount()).toBe(1);
    expect(twinkleOverlay(view.container)).toBeNull();
    let sawOne = false;
    for (let t = 0; t < MEMORY_SKY_TWINKLE_GAP_MAX; t += 200) {
      await act(async () => {
        vi.advanceTimersByTime(200);
      });
      const overlays = view.container.querySelectorAll(
        '[data-testid="memory-sky-twinkle"], [testid="memory-sky-twinkle"]',
      );
      expect(overlays.length).toBeLessThanOrEqual(1);
      if (overlays.length === 1) {
        sawOne = true;
        expect(overlays[0].getAttribute('data-star-key')).toMatch(/^day-/);
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

  it('schedules no day timers under reduced motion and never twinkles', async () => {
    vi.spyOn(Reanimated, 'useReducedMotion').mockReturnValue(true);
    const repeatSpy = vi.spyOn(Reanimated, 'withRepeat');
    vi.useFakeTimers();
    const view = render(
      createElement(MemorySky, { moments: [], daysTogether: 3, startDate: '2026-02-08', now: FIXED_NOW }),
    );
    expect(vi.getTimerCount()).toBe(0);
    await act(async () => {
      vi.advanceTimersByTime(10000);
    });
    expect(twinkleOverlay(view.container)).toBeNull();
    expect(repeatSpy).not.toHaveBeenCalled();
    // Static field still paints every day.
    expect(starCounts(skyCanvas(view.container) as HTMLElement).total).toBe(3);
    expect(SOURCE).toContain('withRepeat');
    expect(SOURCE).toContain('Easing.inOut(Easing.sin)');
    expect(SOURCE).toContain('cancelAnimation');
    expect(SOURCE).not.toContain('withDelay');
    view.unmount();
  });
});

describe('MemorySky fallback without start date', () => {
  it('keeps memory-count behavior exactly when unknown', () => {
    const moments = Array.from({ length: 5 }, (_, i) =>
      makeMoment(`m-${i}`, localNoonIso(2026, 1, 8 + (i % 3))),
    );
    const { container, unmount } = render(createElement(MemorySky, { moments }));
    expect(starCounts(skyCanvas(container) as HTMLElement).total).toBe(5);
    expect(captionText(container)).toContain('5 memories lighting your sky');
    unmount();
  });

  it('falls back when daysTogether is null or startDate missing', () => {
    const moments = [makeMoment('a', localNoonIso(2026, 1, 8)), makeMoment('b', localNoonIso(2026, 1, 9))];
    const noDays = render(createElement(MemorySky, { moments, daysTogether: null, startDate: '2026-02-08' }));
    expect(starCounts(skyCanvas(noDays.container) as HTMLElement).total).toBe(2);
    expect(captionText(noDays.container)).toContain('2 memories lighting your sky');
    noDays.unmount();

    const noStart = render(createElement(MemorySky, { moments, daysTogether: 5, startDate: null }));
    expect(starCounts(skyCanvas(noStart.container) as HTMLElement).total).toBe(2);
    expect(captionText(noStart.container)).toContain('2 memories lighting your sky');
    noStart.unmount();
  });
});

describe('MemorySky day-mode arrival celebration', () => {
  it('showcases only the new day on daysTogether increase with Light haptic', async () => {
    vi.spyOn(Reanimated, 'useReducedMotion').mockReturnValue(false);
    const Haptics = await import('expo-haptics');
    const hapticSpy = vi.spyOn(Haptics, 'impactAsync');
    const view = render(
      createElement(MemorySky, { moments: [], daysTogether: 2, startDate: '2026-02-08', now: FIXED_NOW }),
    );
    expect(starCounts(skyCanvas(view.container) as HTMLElement).total).toBe(2);
    expect(hapticSpy).not.toHaveBeenCalled();

    act(() => {
      view.rerender(
        createElement(MemorySky, { moments: [], daysTogether: 3, startDate: '2026-02-08', now: FIXED_NOW }),
      );
    });
    expect(starCounts(skyCanvas(view.container) as HTMLElement).total).toBe(3);
    expect(hapticSpy).toHaveBeenCalledTimes(1);
    expect(hapticSpy).toHaveBeenCalledWith(Haptics.ImpactFeedbackStyle.Light);
    const overlay = twinkleOverlay(view.container);
    expect(overlay).not.toBeNull();
    expect(overlay?.getAttribute('data-star-key')).toBe('day-2');
    expect(SOURCE).not.toContain('withSpring');

    act(() => {
      view.rerender(
        createElement(MemorySky, { moments: [], daysTogether: 3, startDate: '2026-02-08', now: FIXED_NOW }),
      );
    });
    expect(hapticSpy).toHaveBeenCalledTimes(1);
    view.unmount();
  });

  it('does not celebrate on day shrink', async () => {
    vi.spyOn(Reanimated, 'useReducedMotion').mockReturnValue(false);
    const Haptics = await import('expo-haptics');
    const hapticSpy = vi.spyOn(Haptics, 'impactAsync');
    const view = render(
      createElement(MemorySky, { moments: [], daysTogether: 3, startDate: '2026-02-08', now: FIXED_NOW }),
    );
    act(() => {
      view.rerender(
        createElement(MemorySky, { moments: [], daysTogether: 2, startDate: '2026-02-08', now: FIXED_NOW }),
      );
    });
    expect(starCounts(skyCanvas(view.container) as HTMLElement).total).toBe(2);
    expect(hapticSpy).not.toHaveBeenCalled();
    view.unmount();
  });

  it('stays static with no haptic when reduced motion', async () => {
    vi.spyOn(Reanimated, 'useReducedMotion').mockReturnValue(true);
    const repeatSpy = vi.spyOn(Reanimated, 'withRepeat');
    const Haptics = await import('expo-haptics');
    const hapticSpy = vi.spyOn(Haptics, 'impactAsync');
    const view = render(
      createElement(MemorySky, { moments: [], daysTogether: 2, startDate: '2026-02-08', now: FIXED_NOW }),
    );
    act(() => {
      view.rerender(
        createElement(MemorySky, { moments: [], daysTogether: 3, startDate: '2026-02-08', now: FIXED_NOW }),
      );
    });
    expect(starCounts(skyCanvas(view.container) as HTMLElement).total).toBe(3);
    expect(repeatSpy).not.toHaveBeenCalled();
    expect(hapticSpy).not.toHaveBeenCalled();
    expect(twinkleOverlay(view.container)).toBeNull();
    view.unmount();
  });
});

describe('MemorySky day-mode twinkle pause when unfocused', () => {
  it('schedules no timers and stays static when day mode is unfocused', async () => {
    vi.spyOn(Reanimated, 'useReducedMotion').mockReturnValue(false);
    vi.useFakeTimers();
    const view = render(
      createElement(MemorySky, {
        moments: [],
        daysTogether: 4,
        startDate: '2026-02-08',
        now: FIXED_NOW,
        focused: false,
      }),
    );
    expect(vi.getTimerCount()).toBe(0);
    await act(async () => {
      vi.advanceTimersByTime(MEMORY_SKY_TWINKLE_GAP_MAX + 5000);
    });
    expect(twinkleOverlay(view.container)).toBeNull();
    expect(starCounts(skyCanvas(view.container) as HTMLElement).total).toBe(4);
    view.unmount();
    expect(vi.getTimerCount()).toBe(0);
  });
});

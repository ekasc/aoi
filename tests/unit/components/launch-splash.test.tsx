import { act, render } from '@testing-library/react';
import { createElement } from 'react';
import * as Reanimated from 'react-native-reanimated';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { LaunchSplash } from '@/components/launch-splash';
import { SPLASH_EXIT_MS, SPLASH_SCENE_MS } from '@/components/splash/timing';
import { BeachThemeOrder, BeachThemes } from '@/constants/theme-presets';
import * as Theme from '@/features/theme/theme-context';

const animations = new Set<ReturnType<typeof setTimeout>>();
beforeEach(() => {
  vi.spyOn(Reanimated, 'withTiming').mockImplementation((value, config, callback) => {
    if (callback && value === 1) {
      const timer = setTimeout(() => {
        animations.delete(timer);
        callback(true);
      }, config?.duration ?? 300);
      animations.add(timer);
    }
    return value;
  });
  vi.spyOn(Reanimated, 'cancelAnimation').mockImplementation(() => {
    for (const timer of animations) clearTimeout(timer);
    animations.clear();
  });
  vi.spyOn(Theme, 'useAoiTheme').mockReturnValue({
    selectedThemeId: 'after-hours', selectedTheme: BeachThemes['after-hours'], mode: 'dark',
    colors: BeachThemes['after-hours'].dark, hasStoredSelection: true, isHydrated: true,
    setSelectedThemeId: async () => {},
  });
});

afterEach(() => {
  for (const timer of animations) clearTimeout(timer);
  animations.clear();
  vi.restoreAllMocks();
  vi.useRealTimers();
});

describe('launch handoff', () => {
  it('does not finish while local startup is still loading', () => {
    vi.useFakeTimers();
    const onHidden = vi.fn();
    render(createElement(LaunchSplash, { ready: false, onHidden }));
    act(() => vi.advanceTimersByTime(10_000));
    expect(onHidden).not.toHaveBeenCalled();
    expect(vi.getTimerCount()).toBe(0);
  });

  it('settles the artwork, twinkles, then crossfades out 850 ms after mount', () => {
    vi.useFakeTimers();
    const onHidden = vi.fn();
    const { getByTestId } = render(createElement(LaunchSplash, { ready: true, onHidden }));
    act(() => vi.advanceTimersByTime(849));
    expect(onHidden).not.toHaveBeenCalled();
    expect(getByTestId('launch-splash').getAttribute('aria-hidden')).toBe('false');
    act(() => vi.advanceTimersByTime(1));
    expect(onHidden).not.toHaveBeenCalled();
    expect(getByTestId('launch-splash').getAttribute('aria-hidden')).toBe('true');
    act(() => vi.advanceTimersByTime(SPLASH_EXIT_MS - 1));
    expect(onHidden).not.toHaveBeenCalled();
    act(() => vi.advanceTimersByTime(1));
    expect(onHidden).toHaveBeenCalledTimes(1);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('counts time already spent loading toward the scene time', () => {
    vi.useFakeTimers();
    const onHidden = vi.fn();
    const { rerender } = render(createElement(LaunchSplash, { ready: false, onHidden }));
    act(() => vi.advanceTimersByTime(300));
    rerender(createElement(LaunchSplash, { ready: true, onHidden }));
    act(() => vi.advanceTimersByTime(SPLASH_SCENE_MS - 300));
    expect(onHidden).not.toHaveBeenCalled();
    act(() => vi.advanceTimersByTime(SPLASH_EXIT_MS));
    expect(onHidden).toHaveBeenCalledTimes(1);
  });

  it('starts the exit immediately when readiness arrives after a long load', () => {
    vi.useFakeTimers();
    const onHidden = vi.fn();
    const { rerender } = render(createElement(LaunchSplash, { ready: false, onHidden }));
    act(() => vi.advanceTimersByTime(SPLASH_SCENE_MS + 500));
    rerender(createElement(LaunchSplash, { ready: true, onHidden }));
    act(() => vi.advanceTimersByTime(SPLASH_EXIT_MS - 1));
    expect(onHidden).not.toHaveBeenCalled();
    act(() => vi.advanceTimersByTime(1));
    expect(onHidden).toHaveBeenCalledTimes(1);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('holds the still finished scene under reduced motion, then hands off without any motion', () => {
    vi.useFakeTimers();
    vi.spyOn(Reanimated, 'useReducedMotion').mockReturnValue(true);
    const animate = vi.mocked(Reanimated.withTiming);
    animate.mockClear();
    const onHidden = vi.fn();
    const { getByTestId } = render(createElement(LaunchSplash, { ready: true, onHidden }));
    act(() => vi.advanceTimersByTime(SPLASH_SCENE_MS - 1));
    expect(onHidden).not.toHaveBeenCalled();
    expect(getByTestId('launch-splash').getAttribute('aria-hidden')).toBe('false');
    act(() => vi.advanceTimersByTime(1));
    expect(onHidden).toHaveBeenCalledTimes(1);
    expect(animate).not.toHaveBeenCalled();
    expect(vi.getTimerCount()).toBe(0);
  });

  it('waits for the exit animation to finish rather than a competing JavaScript timer', () => {
    vi.useFakeTimers();
    let complete: Parameters<typeof Reanimated.withTiming>[2];
    vi.mocked(Reanimated.withTiming).mockImplementation((value, _config, callback) => {
      if (callback && value === 1) complete = callback;
      return value;
    });
    const onHidden = vi.fn();
    render(createElement(LaunchSplash, { ready: true, onHidden }));
    act(() => vi.advanceTimersByTime(10_000));
    expect(onHidden).not.toHaveBeenCalled();
    act(() => complete?.(false));
    expect(onHidden).not.toHaveBeenCalled();
    act(() => complete?.(true));
    expect(onHidden).toHaveBeenCalledTimes(1);
  });

  it('fades out once at the end of the scene and cancels the fade on unmount', () => {
    vi.useFakeTimers();
    const animate = vi.mocked(Reanimated.withTiming);
    const cancel = vi.spyOn(Reanimated, 'cancelAnimation');
    const { getByTestId, unmount } = render(createElement(LaunchSplash, { ready: true, onHidden: vi.fn() }));
    act(() => vi.advanceTimersByTime(SPLASH_SCENE_MS));
    const fade = animate.mock.calls.filter(([value, config]) => value === 1 && config?.duration === SPLASH_EXIT_MS);
    expect(fade.length).toBe(1);
    expect(fade[0][0]).toBe(1);
    expect(getByTestId('launch-splash').style.backgroundColor).toBe(BeachThemes['after-hours'].dark.background);
    unmount();
    expect(cancel).toHaveBeenCalled();
    expect(vi.getTimerCount()).toBe(0);
  });

  it('cancels the handoff when unmounted or readiness is withdrawn', () => {
    vi.useFakeTimers();
    const onHidden = vi.fn();
    const { rerender, unmount } = render(createElement(LaunchSplash, { ready: true, onHidden }));
    rerender(createElement(LaunchSplash, { ready: false, onHidden }));
    act(() => vi.advanceTimersByTime(SPLASH_EXIT_MS));
    expect(onHidden).not.toHaveBeenCalled();
    rerender(createElement(LaunchSplash, { ready: true, onHidden }));
    unmount();
    act(() => vi.advanceTimersByTime(SPLASH_EXIT_MS));
    expect(onHidden).not.toHaveBeenCalled();
    expect(vi.getTimerCount()).toBe(0);
  });

  it('cancels an exit already in progress when readiness is withdrawn', () => {
    vi.useFakeTimers();
    const onHidden = vi.fn();
    const { rerender } = render(createElement(LaunchSplash, { ready: true, onHidden }));
    act(() => vi.advanceTimersByTime(SPLASH_SCENE_MS));
    rerender(createElement(LaunchSplash, { ready: false, onHidden }));
    act(() => vi.advanceTimersByTime(1000));
    expect(onHidden).not.toHaveBeenCalled();
    rerender(createElement(LaunchSplash, { ready: true, onHidden }));
    act(() => vi.advanceTimersByTime(SPLASH_EXIT_MS));
    expect(onHidden).toHaveBeenCalledTimes(1);
  });

  it('cleans up when unmounted partway through the scene', () => {
    vi.useFakeTimers();
    const onHidden = vi.fn();
    const { unmount } = render(createElement(LaunchSplash, { ready: true, onHidden }));
    act(() => vi.advanceTimersByTime(300));
    unmount();
    act(() => vi.advanceTimersByTime(1000));
    expect(onHidden).not.toHaveBeenCalled();
    expect(vi.getTimerCount()).toBe(0);
  });
});

describe('saved appearance and accessibility', () => {
  it.each(BeachThemeOrder)('uses %s in both appearance modes, rather than forced night colors', (id) => {
    for (const mode of ['light', 'dark'] as const) {
      vi.spyOn(Theme, 'useAoiTheme').mockReturnValue({
        selectedThemeId: id, selectedTheme: BeachThemes[id], mode, colors: BeachThemes[id][mode],
        hasStoredSelection: true, isHydrated: true, setSelectedThemeId: async () => {},
      });
      const { getByTestId, unmount } = render(createElement(LaunchSplash));
      expect(getByTestId('launch-splash').style.backgroundColor).toBe(
        BeachThemes[id][mode].background,
      );
      unmount();
    }
  });

  it('keeps the scene accessible until the exit begins, then lets taps through', () => {
    vi.useFakeTimers();
    const { getByTestId } = render(createElement(LaunchSplash, { ready: true }));
    const root = getByTestId('launch-splash');
    expect(root.getAttribute('aria-hidden')).toBe('false');
    expect(root.getAttribute('pointer-events')).toBe('auto');
    act(() => vi.advanceTimersByTime(SPLASH_SCENE_MS));
    expect(root.getAttribute('aria-hidden')).toBe('true');
    expect(root.getAttribute('pointer-events')).toBe('none');
  });
});

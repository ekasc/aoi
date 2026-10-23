import { render } from '@testing-library/react';
import { createElement } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { AnimatedIntro, SPLASH_MOTIFS } from '@/components/splash/animated-intro';
import { BeachThemeOrder, BeachThemes } from '@/constants/theme-presets';

vi.mock('moti', async () => {
  const { View } = await import('react-native');
  return { MotiView: ({ from, animate, transition, ...props }: Record<string, unknown>) => createElement(View, props) };
});

afterEach(() => vi.useRealTimers());

describe('theme scenes', () => {
  it('selects a starry scene for After Hours and a shell scene for Beach', () => {
    expect(SPLASH_MOTIFS['after-hours']).toBe('constellation');
    expect(SPLASH_MOTIFS.beach).toBe('shell');
  });

  it('does not schedule JavaScript animation loops during startup', () => {
    vi.useFakeTimers();
    for (const themeId of BeachThemeOrder) {
      const { unmount } = render(createElement(AnimatedIntro, { themeId, colors: BeachThemes[themeId].light }));
      expect(vi.getTimerCount()).toBe(0);
      unmount();
    }
  });

  it('hides illustration nodes from screen readers', () => {
    const { container } = render(createElement(AnimatedIntro, { themeId: 'beach', colors: BeachThemes.beach.light }));
    expect(container.firstElementChild?.getAttribute('aria-hidden')).toBe('true');
  });
});

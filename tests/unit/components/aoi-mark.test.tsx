import { render } from '@testing-library/react';
import { createElement } from 'react';
import * as Reanimated from 'react-native-reanimated';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { AoiMark } from '@/components/splash/aoi-mark';
import { BeachThemes } from '@/constants/theme-presets';

afterEach(() => vi.restoreAllMocks());

describe('splash artwork accessibility', () => {
  it('uses a still, fully visible illustration under reduced motion', () => {
    vi.spyOn(Reanimated, 'useReducedMotion').mockReturnValue(true);
    const animate = vi.spyOn(Reanimated, 'withTiming');
    render(createElement(AoiMark, { motif: 'shell', colors: BeachThemes.beach.light }));
    expect(animate).not.toHaveBeenCalled();
  });

  it('keeps the artwork decorative and noninteractive', () => {
    const { container } = render(createElement(AoiMark, { motif: 'constellation', colors: BeachThemes['after-hours'].dark }));
    expect(container.firstElementChild?.getAttribute('aria-hidden')).toBe('true');
    expect(container.firstElementChild?.getAttribute('pointer-events')).toBe('none');
  });
});

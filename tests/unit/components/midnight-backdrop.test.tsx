import { readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

import { landingThemeForColorScheme } from '@/constants/landing-theme';

const BACKDROP_SOURCE = readFileSync(
  'components/landing/midnight-backdrop.tsx',
  'utf8',
);

describe('MidnightBackdrop small-screen tint', () => {
  it('switches on window height for short windows', () => {
    expect(BACKDROP_SOURCE).toContain('useWindowDimensions');
    expect(BACKDROP_SOURCE).toContain('MIDNIGHT_COMPACT_HEIGHT = 700');
    expect(BACKDROP_SOURCE).toContain('height < MIDNIGHT_COMPACT_HEIGHT');
  });

  it('uses a stronger uniform tint for short windows, standard otherwise', () => {
    expect(BACKDROP_SOURCE).toContain('rgba(18, 13, 19, 0.65)');
    expect(BACKDROP_SOURCE).toContain('rgba(46, 20, 36, 0.22)');
  });

  it('keeps the bottom scrim', () => {
    expect(BACKDROP_SOURCE).toContain('midnight-scrim.png');
    expect(BACKDROP_SOURCE).toContain('styles.scrim');
  });
});

describe('landing theme stationery cleanup', () => {
  it('exposes only live midnight fields', () => {
    const theme = landingThemeForColorScheme('dark') as Record<string, unknown>;
    expect(Object.keys(theme).sort()).toEqual([
      'background',
      'border',
      'ink',
      'subtle',
    ]);
  });
});

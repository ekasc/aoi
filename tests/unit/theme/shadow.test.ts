import { describe, it, expect } from 'vitest';

import { BeachThemes, BeachThemeOrder } from '@/constants/theme-presets';
import { Elevation, shadow } from '@/constants/theme';

/**
 * `shadow()` exists because the app had three different drop shadows that
 * disagreed with each other, and the fix is only real if the two shared
 * levels actually produce different strengths. Both of these assertions are
 * here because getting them wrong is silent: a helper that cannot parse the
 * token passes it through unchanged, both levels come out identical, and
 * nothing looks wrong on screen.
 */
describe('shadow()', () => {
  it('parses the rgba() tokens the themes actually ship', () => {
    // Every preset's shadow token is a functional colour, not hex. This is
    // the exact case a hex-only helper gets wrong: it would hand the token
    // straight back, so the level's alpha would never be applied.
    for (const id of BeachThemeOrder) {
      for (const mode of ['light', 'dark'] as const) {
        const token = BeachThemes[id][mode].shadow;
        const channels = token.match(
          /^rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)/,
        );
        expect(channels, `${id}/${mode} token shape`).toBeTruthy();

        // The hue is preserved and the alpha is the level's, never the
        // token's own. (Not a string comparison against the token: some
        // tokens happen to ship at 0.1, which is also the card level, so
        // the two would coincide and prove nothing.)
        expect(shadow(Elevation.card, token), `${id}/${mode} card`).toBe(
          `0 4px 8px rgba(${channels?.[1]}, ${channels?.[2]}, ${channels?.[3]}, 0.1)`,
        );
        expect(shadow(Elevation.floating, token), `${id}/${mode} floating`).toBe(
          `0 4px 12px rgba(${channels?.[1]}, ${channels?.[2]}, ${channels?.[3]}, 0.22)`,
        );
      }
    }
  });

  it('parses hex, short hex and 8-digit hex too', () => {
    expect(shadow(Elevation.card, '#2C1C2B')).toBe(
      '0 4px 8px rgba(44, 28, 43, 0.1)',
    );
    expect(shadow(Elevation.card, '#abc')).toBe(
      '0 4px 8px rgba(170, 187, 204, 0.1)',
    );
    // The trailing alpha is discarded: the level owns the strength.
    expect(shadow(Elevation.card, '#2C1C2BFF')).toBe(
      '0 4px 8px rgba(44, 28, 43, 0.1)',
    );
  });

  it('makes the two levels genuinely different', () => {
    const hue = 'rgba(44, 28, 43, 0.12)';
    const card = shadow(Elevation.card, hue);
    const floating = shadow(Elevation.floating, hue);
    expect(card).not.toBe(floating);
    // Floating controls sit above the page; cards rest on it.
    expect(card).toContain('0.1)');
    expect(floating).toContain('0.22)');
    expect(floating).toContain('12px');
  });

  it('hands an unparseable colour back rather than emitting a broken value', () => {
    expect(shadow(Elevation.card, 'rebeccapurple')).toBe(
      '0 4px 8px rebeccapurple',
    );
  });

  it('clamps the level opacity', () => {
    expect(shadow({ opacity: 5, radius: 8, offset: 4 }, '#000000')).toContain(
      'rgba(0, 0, 0, 1)',
    );
    expect(shadow({ opacity: -1, radius: 8, offset: 4 }, '#000000')).toContain(
      'rgba(0, 0, 0, 0)',
    );
  });
});

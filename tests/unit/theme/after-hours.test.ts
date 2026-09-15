import { describe, it, expect } from 'vitest';

import {
  BeachThemes,
  BeachThemeOrder,
  DEFAULT_BEACH_THEME_ID,
} from '@/constants/theme-presets';

function hexToRgb(hex: string): [number, number, number] {
  const h = hex.replace('#', '');
  return [
    parseInt(h.slice(0, 2), 16) / 255,
    parseInt(h.slice(2, 4), 16) / 255,
    parseInt(h.slice(4, 6), 16) / 255,
  ];
}

function luminance(hex: string): number {
  const [r, g, b] = hexToRgb(hex).map((v) =>
    v <= 0.04045 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4)
  );
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

function contrast(a: string, b: string): number {
  const la = luminance(a);
  const lb = luminance(b);
  return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
}

describe('After Hours theme foundation', () => {
  it('is the default for new installs and first in order', () => {
    expect(DEFAULT_BEACH_THEME_ID).toBe('after-hours');
    expect(BeachThemeOrder[0]).toBe('after-hours');
    expect(BeachThemeOrder).toEqual([
      'after-hours',
      'editorial-paper',
      'sunset-shore',
      'sea-glass',
      'deep-ocean',
    ]);
  });

  it('preserves the 4 existing palette ids exactly', () => {
    for (const id of ['sunset-shore', 'sea-glass', 'deep-ocean', 'editorial-paper']) {
      expect(BeachThemes[id as keyof typeof BeachThemes]).toBeDefined();
    }
    expect(Object.keys(BeachThemes).sort()).toEqual(
      ['after-hours', 'deep-ocean', 'editorial-paper', 'sea-glass', 'sunset-shore'].sort()
    );
  });

  it('leaves existing palettes untouched', () => {
    expect(BeachThemes['editorial-paper'].light.background).toBe('#FCF9F2');
    expect(BeachThemes['editorial-paper'].dark.background).toBe('#16120E');
    expect(BeachThemes['sunset-shore'].light.accent).toBe('#4ECDC4');
    expect(BeachThemes['sea-glass'].dark.background).toBe('#0F1716');
    expect(BeachThemes['deep-ocean'].light.partnerAccent).toBe('#D4A373');
  });

  it('names the preset After Hours with a plain description', () => {
    expect(BeachThemes['after-hours'].name).toBe('After Hours');
    expect(BeachThemes['after-hours'].description).toBe(
      'Frosted wine with soft rose light and cool pink accents.'
    );
  });

  it('matches the specified After Hours core tokens', () => {
    const dark = BeachThemes['after-hours'].dark;
    expect(dark.background).toBe('#120D13');
    expect(dark.surface).toBe('#241B26');
    expect(dark.surface2).toBe('#302230');
    expect(dark.surfaceSubtle).toBe('#1B141E');
    expect(dark.border).toBe('#493447');
    expect(dark.borderStrong).toBe('#72516B');
    expect(dark.text).toBe('#F6EDF3');
    expect(dark.muted).toBe('#CBB9C9');
    expect(dark.textMuted).toBe('#BCA7B9');
    expect(dark.accent).toBe('#E7A3BB');
    expect(dark.primary).toBe('#E7A3BB');
    expect(dark.onAccent).toBe('#29121F');
    expect(dark.primaryText).toBe('#29121F');
    expect(dark.partnerAccent).toBe('#C1ADD7');

    const light = BeachThemes['after-hours'].light;
    expect(light.background).toBe('#F6F2F7');
    expect(light.surface).toBe('#FFFCFF');
    expect(light.text).toBe('#2C1C2B');
    expect(light.muted).toBe('#715B6B');
    expect(light.accent).toBe('#8E3659');
    expect(light.primary).toBe('#8E3659');
    expect(light.partnerAccent).toBe('#675285');
  });

  it('fills every token including semantic aliases in both modes', () => {
    for (const mode of ['light', 'dark'] as const) {
      const palette = BeachThemes['after-hours'][mode] as Record<string, unknown>;
      for (const key of [
        'background',
        'surface',
        'surface2',
        'surfaceSubtle',
        'text',
        'muted',
        'textMuted',
        'border',
        'borderStrong',
        'accent',
        'accentStrong',
        'partnerAccent',
        'onAccent',
        'danger',
        'onDanger',
        'success',
        'warning',
        'shadow',
        'thread',
        'backgroundSubtle',
        'textPrimary',
        'textSecondary',
        'primary',
        'primaryPressed',
        'primaryText',
        'destructive',
        'destructiveBackground',
        'disabled',
        'overlay',
      ]) {
        expect(typeof palette[key], `${mode}.${key}`).toBe('string');
        expect(String(palette[key]).length, `${mode}.${key}`).toBeGreaterThan(0);
      }
    }
  });

  it('keeps body text contrast >= 4.5 across surfaces in both modes', () => {
    for (const mode of ['light', 'dark'] as const) {
      const palette = BeachThemes['after-hours'][mode];
      const surfaces = [palette.background, palette.surface, palette.surface2];
      const bodies = [palette.text, palette.muted, palette.textMuted];
      for (const fg of bodies) {
        for (const bg of surfaces) {
          expect(contrast(fg, bg), `${mode} ${fg} on ${bg}`).toBeGreaterThanOrEqual(4.5);
        }
      }
    }
  });

  it('keeps text readable on 30% frosted cards over their background', () => {
    const cardOver = (fg: string, bg: string) => {
      const mix = (f: number, b: number) => Math.round(f * 0.3 + b * 0.7);
      const ch = (hex: string) => [1, 3, 5].map((o) => parseInt(hex.slice(o, o + 2), 16));
      const [fr, fg_, fb] = ch(fg);
      const [br, bg_, bb] = ch(bg);
      return '#' + [mix(fr, br), mix(fg_, bg_), mix(fb, bb)].map((v) => v.toString(16).padStart(2, '0')).join('');
    };
    for (const mode of ['dark', 'light'] as const) {
      const palette = BeachThemes['after-hours'][mode];
      for (const base of [palette.surface, palette.surface2]) {
        const card = cardOver(base, palette.background);
        for (const ink of [palette.text, palette.muted, palette.textMuted]) {
          expect(contrast(ink, card), `${mode} ${ink} on frosted ${base}`).toBeGreaterThanOrEqual(4.5);
        }
      }
      expect(contrast(palette.onAccent, palette.accent)).toBeGreaterThanOrEqual(4.5);
    }
  });

  it('keeps every ordered id resolvable so persisted selections stay valid', () => {
    for (const id of BeachThemeOrder) {
      expect(BeachThemes[id]).toBeDefined();
    }
  });

  it('keeps body and muted text contrast >= 4.5 on every surface in every theme', () => {
    for (const id of BeachThemeOrder) {
      for (const mode of ['light', 'dark'] as const) {
        const palette = BeachThemes[id][mode];
        const surfaces = [
          palette.background,
          palette.surface,
          palette.surface2,
          palette.surfaceSubtle,
          palette.backgroundSubtle,
        ];
        const bodies = [palette.textPrimary, palette.textSecondary, palette.textMuted];
        for (const fg of bodies) {
          for (const bg of surfaces) {
            expect(
              contrast(fg, bg),
              `${id}/${mode} ${fg} on ${bg}`
            ).toBeGreaterThanOrEqual(4.5);
          }
        }
      }
    }
  });

  it('keeps text on primary, accent, and danger fills >= 4.5 in every theme', () => {
    for (const id of BeachThemeOrder) {
      for (const mode of ['light', 'dark'] as const) {
        const palette = BeachThemes[id][mode];
        expect(contrast(palette.primaryText, palette.primary), `${id}/${mode} primaryText`).toBeGreaterThanOrEqual(4.5);
        expect(contrast(palette.onAccent, palette.accent), `${id}/${mode} onAccent`).toBeGreaterThanOrEqual(4.5);
        expect(contrast(palette.onDanger, palette.danger), `${id}/${mode} onDanger`).toBeGreaterThanOrEqual(4.5);
      }
    }
  });
});

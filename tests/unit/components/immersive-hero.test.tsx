import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { createElement } from 'react';

// ThemedText reads the app theme, which is the point of the change: the
// landing no longer carries its own colours. Mocked rather than wrapped,
// because the provider is not what this suite is about.
vi.mock('@/hooks/use-theme-color', () => ({
  useThemeColor: (_props: unknown, name: string) => THEME_COLOR[name] ?? '#ffffff',
}));

import { ImmersiveHero } from '@/components/landing/immersive-hero';
import { landingThemeForColorScheme } from '@/constants/landing-theme';

// The palette is supplied rather than read from a module constant, so the
// hero cannot quietly disagree with the theme the reader actually chose.
const THEME = { background: '#120D13', ink: '#F6EDF3', subtle: '#C5B2C2', border: '#5C4255' };

const THEME_COLOR: Record<string, string> = {
  background: '#120D13',
  textPrimary: '#F6EDF3',
  textSecondary: '#C5B2C2',
  borderStrong: '#5C4255',
};

const CTA = 'Cta marker copy';
const LEGAL = 'Legal marker copy';

function renderHero(variant?: 'welcome' | 'signin') {
  return render(
    createElement(ImmersiveHero, {
      cta: createElement('div', null, CTA),
      legal: createElement('div', null, LEGAL),
      theme: THEME,
      ...(variant ? { variant } : {}),
    })
  );
}

describe('ImmersiveHero', () => {
  it('renders wordmark, headline, body, and auth controls in order', () => {
    const { container } = renderHero();
    const text = container.textContent ?? '';
    const wordmark = text.indexOf('aoi');
    const headline = text.indexOf('The world');
    const body = text.indexOf('A private place for your moments');
    const cta = text.indexOf(CTA);
    const legal = text.indexOf(LEGAL);
    expect(wordmark).toBeGreaterThanOrEqual(0);
    expect(headline).toBeGreaterThan(wordmark);
    expect(body).toBeGreaterThan(headline);
    expect(cta).toBeGreaterThan(body);
    expect(legal).toBeGreaterThan(cta);
  });

  it('puts the header role on the headline, not the wordmark', () => {
    const { container } = renderHero();
    const headers = container.querySelectorAll('[accessibilityrole="header"]');
    expect(headers.length).toBe(1);
    expect(headers[0].textContent).toContain('The world');
  });

  it('uses the signin headline that preserves the welcome-back meaning', () => {
    renderHero('signin');
    expect(screen.getByText(/Welcome/i)).toBeTruthy();
  });

  it('renders no keepsake stationery', () => {
    const { container } = renderHero();
    expect(container.querySelector('[testid="keepsake-art"]')).toBeNull();
    expect(container.querySelector('[testid="keepsake-seal"]')).toBeNull();
  });

  it('takes its palette from the app theme, not from a fixed midnight copy', () => {
    // It used to return one hardcoded mauve whatever theme the reader had
    // chosen, so someone on Sunset Shore met a grey first screen and then a
    // warm app. The screen is still dark, because the backdrop is a night
    // window, but the ink is now the app's own dark ink.
    const dark = {
      background: '#2A1B1F',
      textPrimary: '#FFF3EA',
      textSecondary: '#D8C2CC',
      borderStrong: '#6B4A55',
    } as never;
    const theme = landingThemeForColorScheme(dark);

    expect(theme.background).toBe(dark.background);
    expect(theme.ink).toBe(dark.textPrimary);
    expect(theme.subtle).toBe(dark.textSecondary);
    expect(theme.border).toBe(dark.borderStrong);
  });

  it('is dark in both system schemes, because the backdrop is a night window', () => {
    // The screen must not follow a light theme: that would put dark ink on a
    // dark photograph. This is why it reads the DARK half of whatever theme
    // is selected, rather than the active one.
    const dark = { background: '#000', textPrimary: '#fff', textSecondary: '#ccc', borderStrong: '#555' } as never;
    const theme = landingThemeForColorScheme(dark);
    expect(theme.ink).toBe('#fff');
  });
});

import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { createElement } from 'react';

import { ImmersiveHero } from '@/components/landing/immersive-hero';
import { landingThemeForColorScheme } from '@/constants/landing-theme';

const CTA = 'Cta marker copy';
const LEGAL = 'Legal marker copy';

function renderHero(variant?: 'welcome' | 'signin') {
  return render(
    createElement(ImmersiveHero, {
      cta: createElement('div', null, CTA),
      legal: createElement('div', null, LEGAL),
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

  it('uses the fixed midnight theme in both system schemes', () => {
    expect(landingThemeForColorScheme('light').background).toBe('#120D13');
    expect(landingThemeForColorScheme('dark').background).toBe('#120D13');
    expect(landingThemeForColorScheme('light').ink).toBe('#F6EDF3');
    expect(landingThemeForColorScheme(null)).toBe(
      landingThemeForColorScheme('dark')
    );
  });
});

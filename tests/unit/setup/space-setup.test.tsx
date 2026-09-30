import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { createElement } from 'react';

vi.mock('@/components/setup/onboarding-wizard', () => ({
  OnboardingWizard: () => createElement('div', { 'data-testid': 'wizard' }),
}));

describe('space setup route', () => {
  it('renders the wizard and nothing else: the resume rule belongs to the flow', async () => {
    const { default: SpaceSetupScreen } = await import('@/app/(auth)/space-setup');
    render(createElement(SpaceSetupScreen));
    expect(screen.getByTestId('wizard')).toBeTruthy();
    // A Space that already exists is not this route's call to make: the flow
    // is the only thing that knows whether a code is still unread on screen.
    expect(screen.queryByTestId('redirect')).toBeNull();
  });
});

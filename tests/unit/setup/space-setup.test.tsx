import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { createElement } from 'react';

import { takeInvite } from '@/features/space/invite-handoff';

vi.mock('@/components/setup/onboarding-wizard', () => ({
  OnboardingWizard: () => createElement('div', { 'data-testid': 'wizard' }),
}));

let routeParams: Record<string, unknown> = {};
vi.mock('expo-router', () => ({
  useLocalSearchParams: () => routeParams,
  Redirect: () => createElement('div', { 'data-testid': 'redirect' }),
}));

describe('space setup route', () => {
  beforeEach(() => {
    routeParams = {};
  });

  it('renders the wizard and nothing else: the resume rule belongs to the flow', async () => {
    const { default: SpaceSetupScreen } = await import('@/app/(auth)/space-setup');
    render(createElement(SpaceSetupScreen));
    expect(screen.getByTestId('wizard')).toBeTruthy();
    // A Space that already exists is not this route's call to make: the flow
    // is the only thing that knows whether a code is still unread on screen.
    expect(screen.queryByTestId('redirect')).toBeNull();
  });

  it('hands an invited code to the flow, which owns the field', async () => {
    // A link lands here as a route param, but the field lives in the flow, so
    // the route hands it over rather than holding it in the URL.
    routeParams = { code: 'HQABD7' };
    const { default: SpaceSetupScreen } = await import('@/app/(auth)/space-setup');
    render(createElement(SpaceSetupScreen));
    expect(takeInvite()).toBe('HQABD7');
  });

  it('passes nothing on when no link arrived', async () => {
    const { default: SpaceSetupScreen } = await import('@/app/(auth)/space-setup');
    render(createElement(SpaceSetupScreen));
    expect(takeInvite()).toBeNull();
  });
});

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { createElement } from 'react';

const spaceMock = vi.hoisted(() => ({
  status: 'loading' as string,
}));

vi.mock('@/features/space/space-context', () => ({
  useSpace: () => spaceMock,
}));

vi.mock('@/components/setup/onboarding-wizard', () => ({
  OnboardingWizard: () => createElement('div', { 'data-testid': 'wizard' }),
}));

vi.mock('expo-router', () => ({
  Redirect: ({ href }: { href: string }) =>
    createElement('div', { 'data-testid': 'redirect', 'data-href': href }),
}));

beforeEach(() => {
  spaceMock.status = 'loading';
});

describe('space setup entry', () => {
  it('ready Space skips setup entirely into Story (interrupted create resumes)', async () => {
    spaceMock.status = 'ready';
    const { default: SpaceSetupScreen } = await import('@/app/(auth)/space-setup');
    render(createElement(SpaceSetupScreen));
    expect(screen.getByTestId('redirect').getAttribute('data-href')).toBe('/(app)/(tabs)/(memories)');
    expect(screen.queryByTestId('wizard')).toBeNull();
  });

  it('spaceless users get the minimal welcome choice, not a questionnaire', async () => {
    spaceMock.status = 'signed_out';
    const { default: SpaceSetupScreen } = await import('@/app/(auth)/space-setup');
    render(createElement(SpaceSetupScreen));
    expect(screen.getByTestId('wizard')).toBeTruthy();
  });
});

import { vi, describe, it, expect, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';

let mockMoments: any[] = [];
let mockIsLoading = false;

vi.mock('@/features/moments/moments-context', () => ({
  useMoments: () => ({
    moments: mockMoments,
    isLoading: mockIsLoading,
    updateMoment: vi.fn(),
  }),
}));

vi.mock('expo-router', () => ({
  Stack: { Screen: () => null },
  useLocalSearchParams: () => ({ id: 'moment-1' }),
  useRouter: () => ({ back: vi.fn(), push: vi.fn() }),
}));

vi.mock('@/components/moments/moment-form', () => ({
  MomentForm: () => <div data-testid="moment-form" />,
}));

vi.mock('@/components/themed-text', () => ({
  ThemedText: ({ children }: any) => <span>{children}</span>,
}));

vi.mock('@/components/ui/surface', () => ({
  Surface: ({ children }: any) => <div>{children}</div>,
}));

vi.mock('@/components/ui/button', () => ({
  Button: ({ label }: any) => <button>{label}</button>,
}));

vi.mock('@/hooks/use-theme-color', () => ({
  useThemeColor: () => '#000000',
}));

vi.mock('react-native-safe-area-context', () => ({
  useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }),
}));

function makeMoment(overrides: Record<string, any> = {}) {
  return {
    id: 'moment-1',
    type: 'note' as const,
    title: 'Test moment',
    body: 'Test body',
    occurredAt: '2026-03-15T10:00:00.000Z',
    targetAt: null,
    createdAt: '2026-03-15T10:00:00.000Z',
    updatedAt: '2026-03-15T10:00:00.000Z',
    authorId: 'user_you',
    authorRole: 'you' as const,
    authorName: 'You',
    ...overrides,
  };
}

describe('EditMomentScreen ownership gate', () => {
  beforeEach(() => {
    mockMoments = [];
    mockIsLoading = false;
  });

  it('shows the edit form for an own moment (isOwn: true)', async () => {
    mockMoments = [makeMoment({ isOwn: true })];
    const { default: EditMomentScreen } = await import('@/app/(app)/moment/edit/[id]');
    render(<EditMomentScreen />);
    expect(screen.getByTestId('moment-form')).toBeTruthy();
  });

  it('blocks editing a partner moment even when authorRole claims "you"', async () => {
    // Regression: the remote API once hardcoded authorRole "you" for every
    // moment, so the old authorRole gate offered Edit on partner moments.
    mockMoments = [
      makeMoment({
        authorRole: 'you',
        authorName: 'Alex',
        isOwn: false,
      }),
    ];
    const { default: EditMomentScreen } = await import('@/app/(app)/moment/edit/[id]');
    render(<EditMomentScreen />);
    expect(screen.queryByTestId('moment-form')).toBeNull();
    expect(screen.getByText(/can edit this/)).toBeTruthy();
  });

  it('blocks editing when ownership is unknown (missing isOwn)', async () => {
    mockMoments = [makeMoment({ authorRole: 'you' })];
    const { default: EditMomentScreen } = await import('@/app/(app)/moment/edit/[id]');
    render(<EditMomentScreen />);
    expect(screen.queryByTestId('moment-form')).toBeNull();
    expect(screen.getByText(/can edit this/)).toBeTruthy();
  });

  it('shows a loading state while moments are still loading', async () => {
    mockMoments = [];
    mockIsLoading = true;
    const { default: EditMomentScreen } = await import('@/app/(app)/moment/edit/[id]');
    render(<EditMomentScreen />);
    expect(screen.getByText(/Loading moment/)).toBeTruthy();
  });
});

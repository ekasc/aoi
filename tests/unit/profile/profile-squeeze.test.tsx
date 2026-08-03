import { vi, describe, it, expect, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';

const sendSqueezeSpy = vi.fn();

vi.mock('expo-router', () => ({
  useRouter: () => ({ push: vi.fn(), back: vi.fn(), replace: vi.fn() }),
}));

vi.mock('react-native-safe-area-context', () => ({
  useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }),
}));

vi.mock('@/features/session/session-context', () => ({
  useSession: () => ({
    user: { displayName: 'You', email: 'you@example.com' },
    signOut: vi.fn(),
  }),
}));

vi.mock('@/features/space/space-context', () => ({
  useSpace: () => ({
    space: {
      name: 'Test space',
      partnerName: 'Alex',
      relationshipStartDate: '2024-01-01T00:00:00.000Z',
      inviteCode: 'ABC123',
    },
    status: 'ready',
    leaveSpace: vi.fn(),
  }),
}));

vi.mock('@/features/squeeze/squeeze-context', () => ({
  useSqueeze: () => ({ sendSqueeze: sendSqueezeSpy, isSending: false }),
}));

vi.mock('@/features/moments/moments-context', () => ({
  useMoments: () => ({ moments: [] }),
}));

vi.mock('@/components/themed-text', () => ({
  ThemedText: ({ children }: any) => <span>{children}</span>,
}));

vi.mock('@/components/ui/button', () => ({
  Button: ({ label, onPress }: any) => <button onClick={onPress}>{label}</button>,
}));

vi.mock('@/components/ui/surface', () => ({
  Surface: ({ children }: any) => <div>{children}</div>,
}));

vi.mock('@/components/ui/icon-button', () => ({
  IconButton: ({ children, onPress, accessibilityLabel, label, disabled }: any) => (
    <button aria-label={accessibilityLabel ?? label} disabled={disabled} onClick={onPress}>
      {children}
    </button>
  ),
}));

vi.mock('@/hooks/use-theme-color', () => ({
  useThemeColor: () => '#000000',
}));

describe('Profile squeeze entry point (moved from timeline hero)', () => {
  beforeEach(() => {
    sendSqueezeSpy.mockClear();
  });

  it('offers a quiet squeeze affordance on the partner row', async () => {
    const { default: ProfileScreen } = await import('@/app/(app)/(tabs)/profile');
    render(<ProfileScreen />);

    const squeeze = screen.getByLabelText('Send a squeeze to Alex');
    expect(squeeze).toBeTruthy();
    fireEvent.click(squeeze);
    expect(sendSqueezeSpy).toHaveBeenCalledTimes(1);
  });

  it('still exposes every existing profile capability', async () => {
    const { default: ProfileScreen } = await import('@/app/(app)/(tabs)/profile');
    render(<ProfileScreen />);

    expect(screen.getByText('Edit relationship')).toBeTruthy();
    expect(screen.getByText('Import milestones')).toBeTruthy();
    expect(screen.getByText('The little things')).toBeTruthy();
    expect(screen.getByText('Sign out')).toBeTruthy();
  });
});

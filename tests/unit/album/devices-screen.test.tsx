import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { createElement } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const router = vi.hoisted(() => ({ replace: vi.fn(), back: vi.fn() }));

vi.mock('expo-router', () => ({
  Stack: { Screen: () => null },
  useRouter: () => router,
}));

vi.mock('react-native', () => ({
  StyleSheet: { create: (styles: Record<string, unknown>) => styles, hairlineWidth: 1 },
  View: ({ children }: { children?: unknown }) => createElement('div', {}, children),
  ScrollView: ({ children }: { children?: unknown }) => createElement('div', {}, children),
}));

vi.mock('@/components/themed-text', () => ({
  ThemedText: ({ children, accessibilityLabel }: { children?: unknown; accessibilityLabel?: string }) =>
    createElement('span', { 'aria-label': accessibilityLabel }, children),
}));

vi.mock('@/components/ui/button', () => ({
  Button: ({
    label,
    disabled,
    onPress,
    accessibilityLabel,
  }: {
    label: string;
    disabled?: boolean;
    onPress?: () => void;
    accessibilityLabel?: string;
  }) => createElement('button', { onClick: onPress, disabled, 'aria-label': accessibilityLabel }, label),
}));

vi.mock('@/features/space/space-context', () => ({
  useSpace: () => ({ space: { id: 'space-1' } }),
}));

const claimBob = {
  deviceId: 'device-bob',
  signingPublicKey: new Uint8Array(32).fill(5),
  agreementPublicKey: new Uint8Array(32).fill(6),
  createdAt: '2026-01-15T00:00:00.000Z',
};

const archive = vi.hoisted(() => ({
  establish: vi.fn(),
  claims: vi.fn(),
  approve: vi.fn(),
  fingerprint: vi.fn(() => 'CCCCC DDDDD EEEEE'),
}));

vi.mock('@/features/album/protocol-archive', () => ({
  establishProtocolArchive: archive.establish,
  pendingEnrolmentClaims: archive.claims,
  approveEnrolmentClaim: archive.approve,
  enrolmentFingerprint: archive.fingerprint,
}));

const { default: DevicesRoute } = await import('@/app/(app)/album/devices');

const session = { deviceId: 'device-alice' };

beforeEach(() => {
  vi.clearAllMocks();
  archive.fingerprint.mockReturnValue('CCCCC DDDDD EEEEE');
  archive.establish.mockResolvedValue({ status: 'ready', ...session });
});

describe('the devices screen', () => {
  it('lists pending claims', async () => {
    archive.claims.mockResolvedValueOnce([claimBob]);
    render(<DevicesRoute />);

    await waitFor(() => expect(screen.getByText('Waiting to join')).toBeTruthy());
    expect(screen.getByLabelText('Choose device device-bob')).toBeTruthy();
  });

  it('shows no requests when nobody is waiting', async () => {
    archive.claims.mockResolvedValueOnce([]);
    render(<DevicesRoute />);

    await waitFor(() => expect(screen.getByText('No requests')).toBeTruthy());
  });

  it('reveals the code on selection and approves the chosen claim', async () => {
    archive.claims.mockResolvedValue([claimBob]);
    archive.approve.mockResolvedValueOnce({ deviceId: 'device-bob' });
    render(<DevicesRoute />);
    await waitFor(() => expect(screen.getByText('Waiting to join')).toBeTruthy());

    // Approval lives beside the code, not on the list: nothing to approve yet.
    expect(screen.queryByText('Approve this device')).toBeNull();

    fireEvent.click(screen.getByLabelText('Choose device device-bob'));
    await waitFor(() => expect(screen.getByText('Approve this device')).toBeTruthy());
    expect(screen.getByText('CCCCC DDDDD EEEEE')).toBeTruthy();

    fireEvent.click(screen.getByText('Approve this device'));
    await waitFor(() => expect(screen.getByText('Approved')).toBeTruthy());

    expect(archive.approve).toHaveBeenCalledOnce();
    const [passedSession, passedClaim] = archive.approve.mock.calls[0];
    expect(passedSession).toEqual(expect.objectContaining({ deviceId: 'device-alice' }));
    expect(passedClaim).toEqual(claimBob);
  });

  it('reports an approval failure and stays on the code', async () => {
    archive.claims.mockResolvedValue([claimBob]);
    archive.approve.mockRejectedValueOnce(new Error('offline'));
    render(<DevicesRoute />);
    await waitFor(() => expect(screen.getByText('Waiting to join')).toBeTruthy());

    fireEvent.click(screen.getByLabelText('Choose device device-bob'));
    await waitFor(() => expect(screen.getByText('Approve this device')).toBeTruthy());
    fireEvent.click(screen.getByText('Approve this device'));

    await waitFor(() =>
      expect(screen.getByText('Could not approve that device. Try again.')).toBeTruthy()
    );
    // Still on the code, so a retry is one press away.
    expect(screen.getByText('Approve this device')).toBeTruthy();
  });

  it('refreshes the list', async () => {
    archive.claims.mockResolvedValueOnce([]).mockResolvedValueOnce([claimBob]);
    render(<DevicesRoute />);
    await waitFor(() => expect(screen.getByText('No requests')).toBeTruthy());

    fireEvent.click(screen.getByText('Refresh'));
    await waitFor(() => expect(screen.getByText('Waiting to join')).toBeTruthy());
  });

  it('reports an unverifiable archive instead of the list', async () => {
    archive.establish.mockResolvedValueOnce({ status: 'blocked' });
    render(<DevicesRoute />);
    await waitFor(() =>
      expect(screen.getByText('This Space could not be verified on this device.')).toBeTruthy()
    );
  });
});

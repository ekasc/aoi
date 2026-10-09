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

const anchorA = {
  spaceId: 'space-1',
  rootDeviceId: 'device-a',
  rootSigningPublicKey: new Uint8Array(32).fill(1),
  recoverySigningPublicKey: new Uint8Array(32).fill(2),
  createdAt: '2026-01-15T00:00:00.000Z',
  rootSignature: new Uint8Array(64).fill(3),
  recoverySignature: new Uint8Array(64).fill(4),
};
const anchorB = { ...anchorA, rootDeviceId: 'device-impostor' };

const archive = vi.hoisted(() => ({
  establish: vi.fn(),
  accept: vi.fn(),
  pin: vi.fn(),
  fingerprint: vi.fn(() => 'AAAAA BBBBB CCCCC'),
  ensureDevice: vi.fn(),
}));
const localState = vi.hoisted(() => ({
  readPinnedAnchor: vi.fn(async () => ({ state: 'none' as const })),
  anchorsMatch: vi.fn((left: unknown, right: unknown) => left === right),
}));

vi.mock('@/features/album/protocol-archive', () => ({
  establishProtocolArchive: archive.establish,
  acceptEnrolmentOffer: archive.accept,
  pinVerifiedAnchor: archive.pin,
  joiningFingerprint: archive.fingerprint,
}));

vi.mock('@/features/album/local-key-store', () => ({
  createLocalKeyStore: () => ({ ensureDevice: archive.ensureDevice }),
}));

vi.mock('@/features/album/device-id', () => ({
  getOrCreateDeviceId: async () => 'device-bob',
}));

vi.mock('@/features/album/protocol-local-state', () => localState);

const { default: EnrolDeviceRoute } = await import('@/app/(app)/album/enroll');

function device() {
  return { signing: { publicKey: new Uint8Array(32).fill(9) } };
}

beforeEach(() => {
  vi.clearAllMocks();
  archive.fingerprint.mockReturnValue('AAAAA BBBBB CCCCC');
  localState.readPinnedAnchor.mockResolvedValue({ state: 'none' as const });
  localState.anchorsMatch.mockImplementation((left: unknown, right: unknown) => left === right);
  archive.ensureDevice.mockResolvedValue(device());
});

describe('the join screen', () => {
  it('shows the comparison code before pinning anything', async () => {
    archive.establish.mockResolvedValueOnce({ status: 'unverified', anchor: anchorA, records: [] });
    render(<EnrolDeviceRoute />);

    await waitFor(() => expect(screen.getByText('Compare these two codes')).toBeTruthy());
    expect(screen.getByText('AAAAA BBBBB CCCCC')).toBeTruthy();
    // Nothing is pinned from display alone.
    expect(archive.pin).not.toHaveBeenCalled();
  });

  it('pins exactly the anchor it fingerprinted, then waits for approval', async () => {
    archive.establish
      .mockResolvedValueOnce({ status: 'unverified', anchor: anchorA, records: [] })
      .mockResolvedValueOnce({ status: 'unverified', anchor: anchorA, records: [] })
      .mockResolvedValueOnce({ status: 'unverified', anchor: anchorA, records: [] })
      .mockResolvedValueOnce({ status: 'waiting' });
    render(<EnrolDeviceRoute />);
    await waitFor(() => expect(screen.getByText('Compare these two codes')).toBeTruthy());

    fireEvent.click(screen.getByText('The codes match'));
    await waitFor(() => expect(screen.getByText('Waiting for approval')).toBeTruthy());

    expect(archive.pin).toHaveBeenCalledOnce();
    expect(archive.pin).toHaveBeenCalledWith('space-1', anchorA);
  });

  it('refuses to pin when the anchor changed during comparison', async () => {
    archive.establish
      .mockResolvedValueOnce({ status: 'unverified', anchor: anchorA, records: [] })
      .mockResolvedValueOnce({ status: 'unverified', anchor: anchorA, records: [] })
      .mockResolvedValueOnce({ status: 'unverified', anchor: anchorB, records: [] });
    render(<EnrolDeviceRoute />);
    await waitFor(() => expect(screen.getByText('Compare these two codes')).toBeTruthy());

    fireEvent.click(screen.getByText('The codes match'));
    await waitFor(() => expect(screen.getByText('Not joined')).toBeTruthy());

    expect(archive.pin).not.toHaveBeenCalled();
    expect(screen.getByText('This Space changed while you were comparing. Start over.')).toBeTruthy();
  });

  it('cancels without saving when the codes do not match', async () => {
    archive.establish.mockResolvedValueOnce({ status: 'unverified', anchor: anchorA, records: [] });
    render(<EnrolDeviceRoute />);
    await waitFor(() => expect(screen.getByText('Compare these two codes')).toBeTruthy());

    fireEvent.click(screen.getByText('They do not match'));
    await waitFor(() => expect(screen.getByText('Not joined')).toBeTruthy());

    expect(archive.pin).not.toHaveBeenCalled();
    expect(screen.getByText('The codes did not match, so nothing was saved.')).toBeTruthy();
  });

  it('collects an approval and enters the archive', async () => {
    archive.establish.mockResolvedValue({ status: 'waiting' });
    localState.readPinnedAnchor.mockResolvedValue({ state: 'pinned', anchor: anchorA });
    archive.accept.mockResolvedValueOnce({ status: 'ready' });
    render(<EnrolDeviceRoute />);
    await waitFor(() => expect(screen.getByText('Waiting for approval')).toBeTruthy());

    fireEvent.click(screen.getByText('Check again'));
    await waitFor(() => expect(router.replace).toHaveBeenCalledWith('/(app)/(tabs)/(memories)'));
  });

  it('reports a missing approval without leaving', async () => {
    archive.establish.mockResolvedValue({ status: 'waiting' });
    localState.readPinnedAnchor.mockResolvedValue({ state: 'pinned', anchor: anchorA });
    archive.accept.mockResolvedValueOnce({ status: 'waiting' });
    render(<EnrolDeviceRoute />);
    await waitFor(() => expect(screen.getByText('Waiting for approval')).toBeTruthy());

    fireEvent.click(screen.getByText('Check again'));
    await waitFor(() =>
      expect(screen.getByText('The other person has not approved this device yet.')).toBeTruthy()
    );
    expect(router.replace).not.toHaveBeenCalled();
  });

  it('reports an unverifiable approval', async () => {
    archive.establish.mockResolvedValue({ status: 'waiting' });
    localState.readPinnedAnchor.mockResolvedValue({ state: 'pinned', anchor: anchorA });
    archive.accept.mockResolvedValueOnce({ status: 'blocked' });
    render(<EnrolDeviceRoute />);
    await waitFor(() => expect(screen.getByText('Waiting for approval')).toBeTruthy());

    fireEvent.click(screen.getByText('Check again'));
    await waitFor(() =>
      expect(screen.getByText('That approval could not be verified. Ask them to approve again.')).toBeTruthy()
    );
  });

  it('shows a trust failure instead of joining', async () => {
    archive.establish.mockResolvedValue({ status: 'blocked' });
    render(<EnrolDeviceRoute />);
    await waitFor(() => expect(screen.getByText('Not joined')).toBeTruthy());
    expect(screen.getByText('This Space could not be verified on this device.')).toBeTruthy();
  });
});

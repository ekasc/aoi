/**
 * Unit area 7: UI interaction states, including error and retry behavior.
 *
 * Renders the real album screens through @testing-library/react against
 * mocked archive boundaries (protocol-archive, key store, device id). The
 * mocks sit at the archive boundary — React, the screen state machines, and
 * the copy they render are all real. Deterministic and isolated: no network,
 * no timers beyond waitFor, no native modules.
 */
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
  TextInput: (props: Record<string, unknown>) => {
    const { value, onChangeText, accessibilityLabel, ...rest } = props;
    return createElement('input', {
      value: typeof value === 'string' ? value : '',
      'aria-label': accessibilityLabel,
      onChange: (event: { target: { value: string } }) => {
        if (typeof onChangeText === 'function') onChangeText(event.target.value);
      },
      ...rest,
    });
  },
}));

vi.mock('@/components/themed-text', () => ({
  ThemedText: ({ children }: { children?: unknown }) => createElement('span', {}, children),
}));

vi.mock('@/components/ui/button', () => ({
  Button: ({
    label,
    disabled,
    onPress,
  }: {
    label: string;
    disabled?: boolean;
    onPress?: () => void;
  }) =>
    createElement(
      'button',
      {
        onClick: onPress,
        disabled,
        'aria-disabled': disabled ? 'true' : undefined,
      },
      label
    ),
}));

vi.mock('@/features/space/space-context', () => ({
  useSpace: () => ({ space: { id: 'space-1' } }),
}));

vi.mock('@/hooks/use-theme-color', () => ({
  useThemeColor: () => '#000000',
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

const archive = vi.hoisted(() => ({
  establish: vi.fn(),
  accept: vi.fn(),
  pin: vi.fn(),
  recover: vi.fn(),
}));
const localState = vi.hoisted(() => ({
  readPinnedAnchor: vi.fn(async () => ({ state: 'none' as const })),
  anchorsMatch: vi.fn((left: unknown, right: unknown) => left === right),
}));
const keyStore = vi.hoisted(() => ({
  ensureDevice: vi.fn(async () => ({ signing: { publicKey: new Uint8Array(32).fill(9) } })),
}));

vi.mock('@/features/album/protocol-archive', () => ({
  establishProtocolArchive: archive.establish,
  acceptEnrolmentOffer: archive.accept,
  pinVerifiedAnchor: archive.pin,
  joiningFingerprint: () => 'AAAAA BBBBB CCCCC',
  recoverProtocolArchive: archive.recover,
}));

vi.mock('@/features/album/local-key-store', () => ({
  createLocalKeyStore: () => ({ ensureDevice: keyStore.ensureDevice }),
}));

vi.mock('@/features/album/device-id', () => ({
  getOrCreateDeviceId: async () => 'device-bob',
}));

vi.mock('@/features/album/protocol-local-state', () => localState);

const { default: EnrolDeviceRoute } = await import('@/app/(app)/album/enroll');
const { default: RestoreRoute } = await import('@/app/(app)/album/restore');

beforeEach(() => {
  vi.clearAllMocks();
  localState.readPinnedAnchor.mockResolvedValue({ state: 'none' as const });
  localState.anchorsMatch.mockImplementation((left: unknown, right: unknown) => left === right);
  keyStore.ensureDevice.mockResolvedValue({ signing: { publicKey: new Uint8Array(32).fill(9) } });
});

describe('unit: enroll screen error and retry', () => {
  it('shows a transport failure as a failed state with a retry, and retries into the comparison', async () => {
    archive.establish
      .mockRejectedValueOnce(new Error('network down'))
      .mockResolvedValueOnce({ status: 'unverified', anchor: anchorA, records: [] });
    render(<EnrolDeviceRoute />);

    await waitFor(() => expect(screen.getByText('Not joined')).toBeTruthy());
    expect(screen.getByText('Could not reach the shared album.')).toBeTruthy();

    fireEvent.click(screen.getByText('Try again'));
    await waitFor(() => expect(screen.getByText('Compare these two codes')).toBeTruthy());
    expect(archive.establish).toHaveBeenCalledTimes(2);
  });

  it('stays on the failed state when the retry also fails, without navigating away', async () => {
    archive.establish.mockRejectedValue(new Error('still down'));
    render(<EnrolDeviceRoute />);

    await waitFor(() => expect(screen.getByText('Not joined')).toBeTruthy());
    fireEvent.click(screen.getByText('Try again'));
    await waitFor(() => expect(archive.establish).toHaveBeenCalledTimes(2));
    expect(screen.getByText('Could not reach the shared album.')).toBeTruthy();
    expect(router.replace).not.toHaveBeenCalled();
  });

  it('does not offer retry before the first load settles', async () => {
    let release: (value: { status: string }) => void = () => {};
    archive.establish.mockReturnValueOnce(
      new Promise((resolve) => {
        release = resolve;
      })
    );
    render(<EnrolDeviceRoute />);
    // First paint is loading; the retry affordance must not exist yet.
    expect(screen.queryByText('Try again')).toBeNull();
    release({ status: 'blocked' });
    await waitFor(() => expect(screen.getByText('Not joined')).toBeTruthy());
  });
});

describe('unit: restore screen error and retry', () => {
  const PHRASE_24 = Array.from({ length: 24 }, (_, index) => `word${index + 1}`).join(' ');

  function typePhrase(text: string) {
    fireEvent.change(screen.getByLabelText('Recovery phrase'), { target: { value: text } });
  }

  function restoreButton(): HTMLElement {
    return screen.getByText('Restore this album');
  }

  it('keeps restore disabled until all 24 words are present', async () => {
    render(<RestoreRoute />);
    expect(restoreButton().getAttribute('aria-disabled')).toBe('true');
    typePhrase(PHRASE_24);
    await waitFor(() =>
      expect(restoreButton().getAttribute('aria-disabled')).toBeNull()
    );
    expect(archive.recover).not.toHaveBeenCalled();
  });

  it('reports an invalid phrase without navigating, then retries the same words', async () => {
    archive.recover
      .mockResolvedValueOnce({ status: 'failed', reason: 'invalid-phrase' })
      .mockResolvedValueOnce({ status: 'ready', session: {} });
    render(<RestoreRoute />);
    typePhrase(PHRASE_24);
    fireEvent.click(restoreButton());
    await waitFor(() =>
      expect(
        screen.getByText('That is not a valid recovery phrase. Check it and try again.')
      ).toBeTruthy()
    );
    expect(router.replace).not.toHaveBeenCalled();
    // Retry keeps the typed phrase: the user must not retype 24 words.
    expect((screen.getByLabelText('Recovery phrase') as HTMLInputElement).value).toBe(PHRASE_24);
    fireEvent.click(restoreButton());
    await waitFor(() =>
      expect(router.replace).toHaveBeenCalledWith('/(app)/(tabs)/(memories)')
    );
  });

  it('reports a transport failure as retryable and keeps the phrase', async () => {
    archive.recover.mockRejectedValueOnce(new Error('network down'));
    render(<RestoreRoute />);
    typePhrase(PHRASE_24);
    fireEvent.click(restoreButton());
    await waitFor(() =>
      expect(
        screen.getByText('Could not reach the shared album. Check your connection and try again.')
      ).toBeTruthy()
    );
    expect((screen.getByLabelText('Recovery phrase') as HTMLInputElement).value).toBe(PHRASE_24);
    expect(router.replace).not.toHaveBeenCalled();
  });
});

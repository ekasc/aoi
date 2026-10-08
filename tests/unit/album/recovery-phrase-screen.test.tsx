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
  Button: ({ label, onPress }: { label: string; onPress?: () => void }) =>
    createElement('button', { onClick: onPress }, label),
}));

vi.mock('@/features/space/space-context', () => ({
  useSpace: () => ({ space: { id: 'space-1' } }),
}));

const recovery = vi.hoisted(() => ({ readEntropy: vi.fn() }));

vi.mock('@/features/album/protocol-local-state', () => ({
  readRecoveryEntropy: recovery.readEntropy,
}));

const { default: RecoveryPhraseRoute } = await import('@/app/(app)/album/recovery-phrase');

beforeEach(() => {
  vi.clearAllMocks();
});

describe('the recovery phrase screen', () => {
  it('renders all 24 words with their numbers', async () => {
    recovery.readEntropy.mockResolvedValueOnce(new Uint8Array(32).fill(7));
    render(<RecoveryPhraseRoute />);

    await waitFor(() => expect(screen.getByText('Write these 24 words down')).toBeTruthy());
    for (let index = 1; index <= 24; index += 1) {
      expect(screen.getByLabelText(new RegExp(`^Word ${index} of 24: `))).toBeTruthy();
    }
  });

  it('confirms deliberately, not by opening the screen', async () => {
    recovery.readEntropy.mockResolvedValueOnce(new Uint8Array(32).fill(7));
    render(<RecoveryPhraseRoute />);
    await waitFor(() => expect(screen.getByText('Write these 24 words down')).toBeTruthy());

    // Opening the screen is not confirmation.
    expect(screen.queryByText('Saved.')).toBeNull();
    fireEvent.click(screen.getByText('I have written them down'));
    await waitFor(() => expect(screen.getByText('Saved.')).toBeTruthy());
  });

  it('says plainly when this device holds no phrase', async () => {
    recovery.readEntropy.mockResolvedValueOnce(null);
    render(<RecoveryPhraseRoute />);

    await waitFor(() => expect(screen.getByText('No phrase on this device')).toBeTruthy());
    expect(screen.queryByText('Write these 24 words down')).toBeNull();
  });
});

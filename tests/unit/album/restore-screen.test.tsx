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

const archive = vi.hoisted(() => ({ recover: vi.fn() }));

vi.mock('@/features/album/protocol-archive', () => ({
  recoverProtocolArchive: archive.recover,
}));

const { default: RestoreRoute } = await import('@/app/(app)/album/restore');

const PHRASE_24 = Array.from({ length: 24 }, (_, index) => `word${index + 1}`).join(' ');

beforeEach(() => {
  vi.clearAllMocks();
});

describe('the restore screen', () => {
  it('counts words and keeps restore disabled until all 24 are present', async () => {
    render(<RestoreRoute />);
    const input = screen.getByLabelText('Recovery phrase');

    expect(screen.getByText('0 of 24 words')).toBeTruthy();
    expect(screen.getByText('Restore this album').closest('button')).toHaveProperty('disabled', true);

    fireEvent.change(input, { target: { value: 'one two three' } });
    await waitFor(() => expect(screen.getByText('3 of 24 words')).toBeTruthy());
    expect(screen.getByText('Restore this album').closest('button')).toHaveProperty('disabled', true);

    fireEvent.change(input, { target: { value: PHRASE_24 } });
    await waitFor(() => expect(screen.getByText('24 of 24 words')).toBeTruthy());
    expect(screen.getByText('Restore this album').closest('button')).toHaveProperty('disabled', false);
  });

  it('restores with the typed phrase and enters the archive', async () => {
    archive.recover.mockResolvedValueOnce({ status: 'ready', session: {} });
    render(<RestoreRoute />);

    fireEvent.change(screen.getByLabelText('Recovery phrase'), { target: { value: PHRASE_24 } });
    fireEvent.click(screen.getByText('Restore this album'));

    await waitFor(() => expect(archive.recover).toHaveBeenCalledWith({
      spaceId: 'space-1',
      phrase: PHRASE_24,
    }));
    expect(router.replace).toHaveBeenCalledWith('/(app)/(tabs)/(memories)');
  });

  it('reports an invalid phrase without navigating', async () => {
    archive.recover.mockResolvedValueOnce({ status: 'failed', reason: 'invalid-phrase' });
    render(<RestoreRoute />);

    fireEvent.change(screen.getByLabelText('Recovery phrase'), { target: { value: PHRASE_24 } });
    fireEvent.click(screen.getByText('Restore this album'));

    await waitFor(() =>
      expect(screen.getByText('That is not a valid recovery phrase. Check it and try again.')).toBeTruthy()
    );
    expect(router.replace).not.toHaveBeenCalled();
  });

  it('reports a phrase the archive rejects', async () => {
    archive.recover.mockResolvedValueOnce({ status: 'failed', reason: 'anchor-recovery-key-mismatch' });
    render(<RestoreRoute />);

    fireEvent.change(screen.getByLabelText('Recovery phrase'), { target: { value: PHRASE_24 } });
    fireEvent.click(screen.getByText('Restore this album'));

    await waitFor(() =>
      expect(screen.getByText('This album could not be restored with that phrase.')).toBeTruthy()
    );
    expect(router.replace).not.toHaveBeenCalled();
  });
});

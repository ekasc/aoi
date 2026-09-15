import { vi, describe, it, expect, beforeEach } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';

const proposeSpy = vi.fn(async () => ({ id: 'proposal-1' }));
const backSpy = vi.fn();

vi.mock('expo-router', () => ({
  Stack: { Screen: () => null },
  useLocalSearchParams: () => ({}),
  useRouter: () => ({ back: backSpy, push: vi.fn() }),
}));

vi.mock('react-native-safe-area-context', () => ({
  useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }),
}));

vi.mock('@/features/proposals/proposals-context', () => ({
  useProposals: () => ({ propose: proposeSpy }),
}));

vi.mock('@/components/forms/native-date-time-field', () => ({
  NativeDateTimeField: ({ label }: any) => <span>{label}</span>,
}));

vi.mock('@/components/themed-text', () => ({
  ThemedText: ({ children }: any) => <span>{children}</span>,
}));

vi.mock('@/components/ui/surface', () => ({
  Surface: ({ children }: any) => <div>{children}</div>,
}));

vi.mock('@/components/ui/button', () => ({
  Button: ({ label, onPress }: any) => <button onClick={onPress}>{label}</button>,
}));

vi.mock('@/hooks/use-theme-color', () => ({
  useThemeColor: () => '#000000',
}));

beforeEach(() => {
  proposeSpy.mockClear();
  backSpy.mockClear();
});

describe('NewProposalScreen validity', () => {
  it('blocks an empty title and keeps the draft open', async () => {
    const { default: NewProposalScreen } = await import(
      '@/app/(app)/proposal/new'
    );
    render(<NewProposalScreen />);

    fireEvent.click(screen.getByText('Suggest it'));

    await waitFor(() =>
      expect(screen.getByText('Give the idea a few words.')).toBeTruthy()
    );
    expect(proposeSpy).not.toHaveBeenCalled();
    expect(backSpy).not.toHaveBeenCalled();
  });

  it('sends no label when None stays selected', async () => {
    const { default: NewProposalScreen } = await import(
      '@/app/(app)/proposal/new'
    );
    render(<NewProposalScreen />);

    fireEvent.change(screen.getByLabelText('Suggestion title'), {
      target: { value: 'How about Saturday?' },
    });
    fireEvent.click(screen.getByText('Suggest it'));

    await waitFor(() => expect(proposeSpy).toHaveBeenCalledTimes(1));
    expect(proposeSpy.mock.calls[0][0].title).toBe('How about Saturday?');
    expect(proposeSpy.mock.calls[0][0].label).toBeUndefined();
    expect(backSpy).toHaveBeenCalledTimes(1);
  });

  it('sends the preset label and keeps Other custom text', async () => {
    const { default: NewProposalScreen } = await import(
      '@/app/(app)/proposal/new'
    );
    render(<NewProposalScreen />);

    fireEvent.change(screen.getByLabelText('Suggestion title'), {
      target: { value: 'How about Saturday?' },
    });
    fireEvent.click(screen.getByLabelText('Set label Other'));
    fireEvent.change(screen.getByLabelText('Custom label'), {
      target: { value: 'Rooftop picnic' },
    });
    fireEvent.click(screen.getByText('Suggest it'));

    await waitFor(() => expect(proposeSpy).toHaveBeenCalledTimes(1));
    expect(proposeSpy.mock.calls[0][0].label).toEqual({
      preset: 'Other',
      customText: 'Rooftop picnic',
    });
  });

  it('keeps the draft when sending fails', async () => {
    proposeSpy.mockRejectedValueOnce(new Error('No connection'));
    const { default: NewProposalScreen } = await import(
      '@/app/(app)/proposal/new'
    );
    render(<NewProposalScreen />);

    fireEvent.change(screen.getByLabelText('Suggestion title'), {
      target: { value: 'How about Saturday?' },
    });
    fireEvent.click(screen.getByText('Suggest it'));

    await waitFor(() =>
      expect(screen.getByText('No connection')).toBeTruthy()
    );
    expect(backSpy).not.toHaveBeenCalled();
    // Draft is untouched — the title is still there to retry.
    expect(
      (screen.getByLabelText('Suggestion title') as HTMLInputElement).value
    ).toBe('How about Saturday?');
  });
});

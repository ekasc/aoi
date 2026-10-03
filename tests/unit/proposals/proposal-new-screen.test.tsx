import { vi, describe, it, expect, beforeEach } from 'vitest';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';

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
  proposeSpy.mockReset().mockResolvedValue({ id: 'proposal-1' });
  backSpy.mockClear();
});

describe('NewProposalScreen validity', () => {
  it('exposes the chosen label as a checked radio option', async () => {
    const { default: NewProposalScreen } = await import('@/app/(app)/proposal/new');
    render(<NewProposalScreen />);
    expect(screen.getByLabelText('No label').getAttribute('aria-checked')).toBe('true');
    fireEvent.click(screen.getByLabelText('Set label Date'));
    expect(screen.getByLabelText('Set label Date').getAttribute('aria-checked')).toBe('true');
    expect(screen.getByLabelText('No label').getAttribute('aria-checked')).toBe('false');
  });
  it('does not send twice or cancel while the suggestion is being submitted', async () => {
    let finish: (value: { id: string }) => void = () => {};
    proposeSpy.mockReturnValueOnce(new Promise((resolve) => { finish = resolve; }));
    const { default: NewProposalScreen } = await import('@/app/(app)/proposal/new');
    render(<NewProposalScreen />);
    fireEvent.change(screen.getByLabelText('Suggestion title'), { target: { value: 'Dinner' } });
    fireEvent.click(screen.getByText('Suggest it'));
    fireEvent.click(screen.getByText('Cancel'));
    fireEvent.click(screen.getByText('Suggesting…'));
    expect(proposeSpy).toHaveBeenCalledOnce();
    expect(backSpy).not.toHaveBeenCalled();
    await act(async () => finish({ id: 'sent' }));
    expect(backSpy).toHaveBeenCalledOnce();
  });
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

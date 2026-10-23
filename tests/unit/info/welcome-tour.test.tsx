import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';

import { WelcomeSheet } from '@/components/info/welcome-sheet';
import { TOUR_TITLE } from '@/features/info/welcome-tour';

// The sheet reads theme tokens; tests only need stable values for contrast
// and layout, not the real palette (which its own suite pins).
vi.mock('@/hooks/use-theme-color', () => ({
  useThemeColor: (_props: unknown, token: string) =>
    ({
      accent: '#8E3659',
      accentInk: '#5A1F38',
      textSecondary: '#6B5A66',
    })[token] ?? '#000000',
}));

describe('the help guide', () => {
  it('starts the real Memories journey when requested', () => {
    const onStart = vi.fn();
    render(<WelcomeSheet onClose={() => {}} onStart={onStart} visible />);
    fireEvent.click(screen.getByText('Go to Memories'));
    expect(onStart).toHaveBeenCalledOnce();
  });

  it('is a dialog that one press puts away', () => {
    const onClose = vi.fn();
    render(<WelcomeSheet onClose={onClose} visible />);

    const dialog = screen.getByRole('dialog');
    expect(dialog.getAttribute('aria-modal')).toBe('true');
    expect(dialog.getAttribute('aria-label')).toBe(TOUR_TITLE);

    fireEvent.click(screen.getByText('Keep exploring'));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('does not stay in the tree before it is shown', () => {
    render(<WelcomeSheet onClose={() => {}} visible={false} />);
    expect(screen.queryByText(TOUR_TITLE)).toBeNull();
  });
});

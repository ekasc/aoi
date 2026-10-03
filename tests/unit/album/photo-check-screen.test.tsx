import { createElement, type ReactNode } from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { PhotoCheckScreen } from '@/components/album/photo-check-screen';
import type { PhotoCheck } from '@/features/album/photo-check';

vi.mock('@/components/ui/screen', () => ({ Screen: ({ children }: { children: ReactNode }) => children }));
vi.mock('@/components/themed-text', () => ({ ThemedText: ({ children, accessibilityRole }: { children: ReactNode; accessibilityRole?: string }) => createElement('span', { role: accessibilityRole === 'alert' ? 'alert' : undefined }, children) }));
vi.mock('@/components/ui/button', () => ({ Button: ({ label, onPress, disabled }: { label: string; onPress: () => void; disabled?: boolean }) => createElement('button', { onClick: onPress, disabled }, label) }));
vi.mock('expo-image', () => ({ Image: ({ accessibilityLabel, cachePolicy }: { accessibilityLabel: string; cachePolicy: string }) => createElement('img', { alt: accessibilityLabel, 'data-cache': cachePolicy }) }));

function setup(result: PhotoCheck | null = null, checking = false) {
  const props = { result, checking, busy: checking, onChoose: vi.fn(), onCancel: vi.fn() };
  render(<PhotoCheckScreen {...props} />); return props;
}

describe('full-screen photo check', () => {
  it('asks for one photo with no calibration forms or export controls', () => {
    const props = setup();
    expect(screen.getByText('No photo selected yet.')).toBeTruthy();
    expect(screen.queryByRole('textbox')).toBeNull();
    expect(screen.queryByText(/Calibration|Validation|Copy anonymized/)).toBeNull();
    fireEvent.click(screen.getByText('Choose a photo')); expect(props.onChoose).toHaveBeenCalledOnce();
  });
  it('shows labeled local crops and asks only whether faces look complete', () => {
    setup({ kind: 'ready', detected: 2, crops: [{ face: 1, uri: 'data:image/png;base64,crop' }, { face: 2, uri: null }] });
    expect(screen.getByText('Are the faces upright, with eyes, nose, and mouth visible?')).toBeTruthy();
    expect(screen.getByAltText('Aligned preview of face 1').getAttribute('data-cache')).toBe('none');
    expect(screen.getByText('Could not prepare this face. Try a clearer photo.')).toBeTruthy();
    expect(screen.getByText('Choose another photo')).toBeTruthy();
  });
  it('distinguishes no faces from a failed read', () => {
    const { unmount } = render(<PhotoCheckScreen result={{ kind: 'ready', detected: 0, crops: [] }} busy={false} checking={false} onChoose={() => {}} onCancel={() => {}} />);
    expect(screen.getByText('No faces were found. Try a clearer photo.')).toBeTruthy(); unmount();
    setup({ kind: 'failed', message: 'Could not read this photo.' });
    expect(screen.getByRole('alert').textContent).toBe('Could not read this photo.');
  });
  it('offers cancellation during work while preventing a second selection', () => {
    const props = setup(null, true);
    expect(screen.getByText('Choose a photo')).toHaveProperty('disabled', true);
    fireEvent.click(screen.getByText('Cancel check')); expect(props.onCancel).toHaveBeenCalledOnce();
  });
});

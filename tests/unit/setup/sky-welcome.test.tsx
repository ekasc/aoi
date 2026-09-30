import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { createElement } from 'react';
import { describe, expect, it, vi } from 'vitest';

import { SkyWelcome } from '@/components/home/sky-welcome';

describe('destination sky invitation', () => {
  it('shows the created identity and code, copies it, and enters only on tap', async () => {
    const onEnter = vi.fn();
    render(createElement(SkyWelcome, {
      details: { kind: 'created', name: 'Maya & June', inviteCode: 'MAYA16', photoUri: null, partnerName: '' }, onEnter,
    }));
    expect(screen.getByText('Maya & June')).toBeTruthy();
    expect(screen.getByLabelText('Your invite code, M A Y A 1 6')).toBeTruthy();
    expect(onEnter).not.toHaveBeenCalled();
    const copy = screen.getByLabelText('Copy code');
    expect(copy.getAttribute('accessibilityrole')).toBe('button');
    fireEvent.click(copy);
    await waitFor(() => expect(screen.getByText('Copied to your clipboard')).toBeTruthy());
    expect((globalThis as unknown as Record<string, unknown>).__aoiClipboard).toBe('MAYA16');
    const enter = screen.getByLabelText('Enter your sky');
    expect(enter.getAttribute('accessibilityrole')).toBe('button');
    fireEvent.click(enter);
    expect(onEnter).toHaveBeenCalledOnce();
  });

  it('welcomes the joiner without offering someone else\'s invite code', () => {
    render(createElement(SkyWelcome, {
      details: { kind: 'joined', name: 'Maya & June', inviteCode: '', photoUri: null, partnerName: 'Maya' }, onEnter: vi.fn(),
    }));
    expect(screen.getByText('Maya is already here.')).toBeTruthy();
    expect(screen.queryByLabelText('Copy code')).toBeNull();
    expect(screen.getByLabelText('Enter your sky')).toBeTruthy();
  });
});

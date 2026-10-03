import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { createElement } from 'react';
import { Share } from 'react-native';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { SkyWelcome } from '@/components/home/sky-welcome';
import { inviteAppLink } from '@/features/space/invite-code';

// The real Share opens a native sheet, which no test can observe. It is mocked
// in the global react-native double, and the spy is attached here.
const shareMock = Share.share as unknown as ReturnType<typeof vi.fn>;

beforeEach(() => {
  shareMock.mockReset();
  shareMock.mockResolvedValue({ action: 'sharedAction' });
});

describe('destination sky invitation', () => {
  it('shows the created identity and code, and enters only on tap', async () => {
    const onEnter = vi.fn();
    render(createElement(SkyWelcome, {
      details: { kind: 'created', name: 'Maya & June', inviteCode: 'MAYA16', photoUri: null, partnerName: 'June' }, onEnter,
    }));
    expect(screen.getByText('Maya & June')).toBeTruthy();
    expect(screen.getByLabelText('Your invite code, M A Y A 1 6')).toBeTruthy();
    expect(onEnter).not.toHaveBeenCalled();

    const enter = screen.getByLabelText('Enter your sky');
    expect(enter.getAttribute('accessibilityrole')).toBe('button');
    fireEvent.click(enter);
    expect(onEnter).toHaveBeenCalledOnce();
  });

  it('says it copied on the button itself, not in a line underneath', async () => {
    // The button reporting its own state is the whole point. A second line
    // saying "Copied to your clipboard" repeated the app in two places, and
    // appearing moved everything below it.
    render(createElement(SkyWelcome, {
      details: { kind: 'created', name: 'Maya & June', inviteCode: 'MAYA16', photoUri: null, partnerName: 'June' },
      onEnter: vi.fn(),
    }));
    const copy = screen.getByLabelText('Copy code instead');
    expect(copy.getAttribute('accessibilityrole')).toBe('button');
    expect(screen.queryByText(/Copied to your clipboard/)).toBeNull();

    fireEvent.click(copy);
    await waitFor(() => expect(screen.getByLabelText('Code copied')).toBeTruthy());
    expect((globalThis as unknown as Record<string, unknown>).__aoiClipboard).toBe('MAYA16');
  });

  it('shares a link that opens the app, and still says the code in words', async () => {
    // The link is the good path: six characters typed by hand is friction and
    // one typo. The words in the message are the fallback for a phone that will
    // not open a custom scheme, which is the person most likely to be new here.
    render(createElement(SkyWelcome, {
      details: { kind: 'created', name: 'Maya & June', inviteCode: 'MAYA16', photoUri: null, partnerName: 'June' },
      onEnter: vi.fn(),
    }));
    fireEvent.click(screen.getByLabelText('Share invite'));

    await waitFor(() => expect(shareMock).toHaveBeenCalledOnce());
    const shared = shareMock.mock.calls[0][0] as { message: string; url: string };
    expect(shared.url).toBe(inviteAppLink('MAYA16'));
    expect(shared.message).toContain('June, Maya & June invited you');
    expect(shared.message).toContain('M A Y A 1 6');
  });

  it('offers the code, and says so, when sharing will not open', async () => {
    shareMock.mockRejectedValueOnce(new Error('no share sheet'));
    render(createElement(SkyWelcome, {
      details: { kind: 'created', name: 'Maya & June', inviteCode: 'MAYA16', photoUri: null, partnerName: 'June' },
      onEnter: vi.fn(),
    }));
    fireEvent.click(screen.getByLabelText('Share invite'));

    // A refused share sheet is not a dead end: the code is still copyable, and
    // the screen says which way to go instead.
    await waitFor(() =>
      expect(screen.getByText("Couldn't open sharing. Copy the code instead.")).toBeTruthy(),
    );
    expect(screen.getByLabelText('Copy code instead')).toBeTruthy();
  });

  it('welcomes the joiner without offering someone else\'s invite code', () => {
    render(createElement(SkyWelcome, {
      details: { kind: 'joined', name: 'Maya & June', inviteCode: '', photoUri: null, partnerName: 'Maya' }, onEnter: vi.fn(),
    }));
    expect(screen.getByText('Maya is already here.')).toBeTruthy();
    expect(screen.queryByLabelText('Copy code instead')).toBeNull();
    expect(screen.queryByLabelText('Share invite')).toBeNull();
    expect(screen.getByLabelText('Enter your sky')).toBeTruthy();
  });
});

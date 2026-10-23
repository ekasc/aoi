import { act, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createElement } from 'react';

const state = vi.hoisted(() => ({
  space: null as null | {
    inviteCode: string;
    inviteExpiresAt?: string | null;
    partnerJoined: boolean;
    partnerName: string | null;
  },
  user: { id: 'user-1', displayName: 'Aoi', email: 'aoi@example.com' },
  share: vi.fn(async () => ({})),
  copy: vi.fn(async () => {}),
  refreshSpace: vi.fn(async () => {}),
  regenerateInvite: vi.fn(async () => 'NEWCODE'),
}));

vi.mock('expo-clipboard', () => ({ setStringAsync: (...args: unknown[]) => state.copy(...args) }));

vi.mock('react-native', () => {
  const View = ({ children, style, ...rest }: Record<string, any>) =>
    createElement('div', { style, ...rest }, children);
  const Text = ({ children, ...rest }: Record<string, any>) =>
    createElement('span', rest, children);
  return {
    StyleSheet: { create: (styles: unknown) => styles, hairlineWidth: 1 },
    View,
    ScrollView: View,
    Text,
    Pressable: ({ children, style, onPress, ...rest }: Record<string, any>) => {
      const resolved = typeof style === 'function' ? style({ pressed: false }) : style;
      return createElement(
        'div',
        { ...rest, onClick: onPress, style: resolved },
        typeof children === 'function' ? children({ pressed: false }) : children,
      );
    },
    Share: { share: (...args: unknown[]) => state.share(...args) },
  };
});

vi.mock('@/components/ui/native-sheet', () => ({
  NativeSheet: ({ visible, children }: { visible: boolean; children: React.ReactNode }) =>
    visible ? createElement('div', {}, children) : null,
}));
vi.mock('@/components/ui/button', () => ({
  Button: ({ label, onPress, disabled }: { label: string; onPress: () => void; disabled?: boolean }) =>
    createElement('button', { onClick: onPress, disabled }, label),
}));

vi.mock('@/features/session/session-context', () => ({
  useSession: () => ({ user: state.user }),
}));

vi.mock('@/features/space/space-context', () => ({
  useSpace: () => ({
    space: state.space,
    regenerateInvite: state.regenerateInvite,
    refreshSpace: state.refreshSpace,
  }),
}));

vi.mock('@/features/space/invite-code', () => ({
  inviteMessage: (code: string) => `Join aoi: aoi://join?code=${code}`,
}));

vi.mock('@/hooks/use-theme-color', () => ({
  useThemeColor: () => '#000000',
}));

vi.mock('@/components/themed-text', () => ({
  ThemedText: ({ children, ...rest }: Record<string, any>) =>
    createElement('span', rest, children),
}));

function waitingSpace(overrides: Record<string, any> = {}) {
  return {
    inviteCode: 'ABC123',
    partnerJoined: false,
    partnerName: null,
    ...overrides,
  };
}

async function renderInvitation(variant?: 'section' | 'inline') {
  const { PartnerInvitation } = await import('@/components/space/partner-invitation');
  return render(createElement(PartnerInvitation, variant ? { variant } : null));
}

function openSheet() {
  fireEvent.click(screen.getByText('Invite your partner'));
}

beforeEach(() => {
  state.space = waitingSpace();
  vi.clearAllMocks();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('PartnerInvitation', () => {
  it('shares the invite link on request while waiting', async () => {
    await renderInvitation();

    openSheet();
    await act(async () => {
      fireEvent.click(screen.getByText('Share invite'));
    });
    expect(state.share).toHaveBeenCalledTimes(1);
    expect(state.share).toHaveBeenCalledWith({
      message: expect.stringContaining('aoi://join?code=ABC123'),
    });
  });

  it('does not open sharing just from opening the invitation', async () => {
    await renderInvitation();
    openSheet();
    expect(state.share).not.toHaveBeenCalled();
    expect(state.regenerateInvite).not.toHaveBeenCalled();
  });

  it('regenerates and shares when the old code is still present but expired', async () => {
    state.space = waitingSpace({ inviteExpiresAt: '2000-01-01T00:00:00Z' });
    await renderInvitation();
    openSheet();
    await act(async () => fireEvent.click(screen.getByText('Share invite')));
    expect(state.regenerateInvite).toHaveBeenCalledOnce();
    expect(state.share).toHaveBeenCalledWith({ message: expect.stringContaining('NEWCODE') });
  });

  it('regenerates and shares when there is no code yet', async () => {
    state.space = waitingSpace({ inviteCode: '' });
    await renderInvitation();
    openSheet();
    await act(async () => fireEvent.click(screen.getByText('Share invite')));
    expect(state.regenerateInvite).toHaveBeenCalledOnce();
    expect(state.share).toHaveBeenCalledWith({ message: expect.stringContaining('NEWCODE') });
  });

  it('copies the joining code explicitly', async () => {
    await renderInvitation();
    openSheet();
    await act(async () => fireEvent.click(screen.getByText('Copy invite code')));
    expect(state.copy).toHaveBeenCalledWith('ABC123');
  });

  it('never offers to copy a code that has expired', async () => {
    state.space = waitingSpace({ inviteExpiresAt: '2000-01-01T00:00:00Z' });
    await renderInvitation();
    openSheet();
    expect(screen.queryByText('Copy invite code')).toBeNull();
    expect(screen.getByText('Share invite')).toBeTruthy();
  });

  it('reports share failures without claiming the invite was sent', async () => {
    state.share.mockRejectedValueOnce(new Error('nope'));
    await renderInvitation();
    openSheet();
    await act(async () => fireEvent.click(screen.getByText('Share invite')));
    expect(screen.getByText(/Couldn't open sharing/).getAttribute('accessibilityrole')).toBe('alert');
  });

  it('reports a failed partner-status check and permits retry', async () => {
    state.refreshSpace.mockRejectedValueOnce(new Error('offline'));
    await renderInvitation();
    openSheet();
    await act(async () => fireEvent.click(screen.getByText("Check if they've joined")));
    expect(screen.getByText(/Couldn't check your space/).getAttribute('accessibilityrole')).toBe('alert');
    await act(async () => fireEvent.click(screen.getByText("Check if they've joined")));
    expect(state.refreshSpace).toHaveBeenCalledTimes(2);
    expect(screen.queryByText(/Couldn't check your space/)).toBeNull();
  });

  it('replaces the invite CTA with membership once the server says they joined', async () => {
    await renderInvitation();
    openSheet();
    state.space = waitingSpace({ partnerJoined: true, partnerName: 'June' });
    await act(async () => fireEvent.click(screen.getByText("Check if they've joined")));

    expect(screen.queryByText('Share invite')).toBeNull();
    expect(screen.queryByText('Copy invite code')).toBeNull();
    expect(screen.queryByText("Check if they've joined")).toBeNull();
    expect(screen.getByText(/June has joined/)).toBeTruthy();
  });

  it('shows a stable membership status in Account instead of an invite, once joined', async () => {
    state.space = waitingSpace({ partnerJoined: true, partnerName: 'June' });
    const { container } = await renderInvitation();

    expect(screen.queryByText('Invite your partner')).toBeNull();
    expect(container.textContent).toContain('June');
  });

  it('renders nothing when the space has not loaded', async () => {
    state.space = null;
    const { container } = await renderInvitation();

    expect(container.textContent).toBe('');
  });
});

describe('inline invitation', () => {
  it('offers a quiet invitation while waiting without taking over the page', async () => {
    await renderInvitation('inline');

    openSheet();
    expect(screen.getByText('Share invite')).toBeTruthy();
  });

  it('disappears once the partner has joined', async () => {
    state.space = waitingSpace({ partnerJoined: true, partnerName: 'June' });
    const { container } = await renderInvitation('inline');

    expect(container.textContent).toBe('');
  });
});

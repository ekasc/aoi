import { act, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createElement } from 'react';

const state = vi.hoisted(() => ({
  space: null as null | {
    inviteCode: string;
    partnerJoined: boolean;
    partnerName: string | null;
  },
  segments: ['(app)', '(tabs)', '(memories)'] as string[],
  entry: null as null | { kind: string },
  user: { id: 'user-1', displayName: 'Aoi', email: 'aoi@example.com' },
  share: vi.fn(async () => ({})),
  regenerateInvite: vi.fn(async () => 'NEWCODE'),
}));

vi.mock('react-native', () => {
  const View = ({ children, style, ...rest }: Record<string, any>) =>
    createElement('div', { style, ...rest }, children);
  const Text = ({ children, ...rest }: Record<string, any>) =>
    createElement('span', rest, children);
  return {
    StyleSheet: { create: (styles: unknown) => styles, hairlineWidth: 1 },
    View,
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

vi.mock('react-native-safe-area-context', () => ({
  useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }),
}));

vi.mock('expo-router', () => ({
  useSegments: () => state.segments,
}));

vi.mock('@/components/home/sky-entry-provider', () => ({
  useSkyEntry: () => ({ entry: state.entry }),
}));

vi.mock('@/features/session/session-context', () => ({
  useSession: () => ({ user: state.user }),
}));

vi.mock('@/features/space/space-context', () => ({
  useSpace: () => ({ space: state.space, regenerateInvite: state.regenerateInvite }),
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

vi.mock('@/components/home/compact-sky-geometry', () => ({
  fabBottomOffset: () => 100,
}));

function waitingSpace(overrides: Record<string, any> = {}) {
  return {
    inviteCode: 'ABC123',
    partnerJoined: false,
    partnerName: null,
    ...overrides,
  };
}

async function renderTag() {
  const { InvitePendingTag } = await import('@/components/space/invite-pending-tag');
  return render(createElement(InvitePendingTag));
}

beforeEach(() => {
  state.space = waitingSpace();
  state.segments = ['(app)', '(tabs)', '(memories)'];
  state.entry = null;
  vi.clearAllMocks();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('InvitePendingTag', () => {
  it('shares the invite link on tap while waiting', async () => {
    await renderTag();

    expect(screen.getByText('Invite pending')).toBeTruthy();
    await act(async () => {
      fireEvent.click(screen.getByText('Invite pending'));
    });
    expect(state.share).toHaveBeenCalledTimes(1);
    expect(state.share).toHaveBeenCalledWith({
      message: expect.stringContaining('aoi://join?code=ABC123'),
    });
  });

  it('regenerates and shares when the code expired', async () => {
    state.space = waitingSpace({ inviteCode: '' });
    await renderTag();

    expect(screen.getByText('Invite expired')).toBeTruthy();
    await act(async () => {
      fireEvent.click(screen.getByText('Invite expired'));
    });
    expect(state.regenerateInvite).toHaveBeenCalledTimes(1);
    expect(state.share).toHaveBeenCalledWith({
      message: expect.stringContaining('aoi://join?code=NEWCODE'),
    });
  });

  it('hides once the partner joins', async () => {
    state.space = waitingSpace({ partnerJoined: true });
    const { container } = await renderTag();

    expect(container.textContent).toBe('');
  });

  it('hides off tab routes, even while waiting', async () => {
    state.segments = ['(app)', 'collection', 'new'];
    const { container } = await renderTag();

    expect(container.textContent).toBe('');
  });

  it('hides during the sky entry takeover', async () => {
    state.entry = { kind: 'welcome' };
    const { container } = await renderTag();

    expect(container.textContent).toBe('');
  });

  it('reports share failures without leaving the tab', async () => {
    state.share.mockRejectedValueOnce(new Error('nope'));
    await renderTag();

    await act(async () => {
      fireEvent.click(screen.getByText('Invite pending'));
    });
    const alert = screen.getByText(/sharing/i);
    expect(alert.getAttribute('accessibilityrole')).toBe('alert');
  });
});

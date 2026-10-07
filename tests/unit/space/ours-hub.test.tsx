import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, act } from '@testing-library/react';
import { createElement } from 'react';

let lastAlert: { title?: string; message?: string; buttons?: any[] } | null = null;

// Resolve press-state styles as unpressed; render-prop children invoked.
vi.mock('react-native', () => {
  function flattenStyle(style: unknown): unknown {
    if (Array.isArray(style)) {
      const merged: Record<string, unknown> = {};
      for (const entry of style) {
        const flat = flattenStyle(entry);
        if (flat && typeof flat === 'object') Object.assign(merged, flat);
      }
      return merged;
    }
    return style;
  }

  function withAriaProps(props: Record<string, unknown>): Record<string, unknown> {
    const next: Record<string, unknown> = { ...props };
    if (typeof props.accessibilityLabel === 'string') {
      next['aria-label'] = props.accessibilityLabel;
    }
    if (typeof props.onPress === 'function') {
      next.onClick = props.onPress;
    }
    return next;
  }

  function createDiv(children: unknown, style: unknown, props: Record<string, unknown>) {
    return createElement(
      'div',
      { style: flattenStyle(style), ...withAriaProps(props) },
      children
    );
  }

  const View = (props: Record<string, unknown>) => {
    const { children, style, ...rest } = props;
    return createDiv(children, style, rest);
  };

  const Text = (props: Record<string, unknown>) => {
    const { children, style, ...rest } = props;
    return createElement(
      'span',
      { style: flattenStyle(style), ...withAriaProps(rest) },
      children
    );
  };

  const Pressable = (props: Record<string, unknown>) => {
    const { children, style, ...rest } = props;
    const resolved = typeof style === 'function' ? style({ pressed: false }) : style;
    const content =
      typeof children === 'function'
        ? (children as (state: { pressed: boolean }) => unknown)({ pressed: false })
        : children;
    return createDiv(content, resolved, rest);
  };

  const ActivityIndicator = () => createElement('div', { 'data-testid': 'spinner' });

  return {
    StyleSheet: {
      create: (styles: Record<string, unknown>) => styles,
      hairlineWidth: 1,
      flatten: flattenStyle,
      absoluteFill: {},
    },
    View,
    Text,
    Pressable,
    ScrollView: View,
    Modal: (props: Record<string, unknown>) => {
      if (props.visible === false || props.visible === undefined) {
        return null;
      }
      const { children } = props as { children?: unknown };
      return createElement('div', { 'data-testid': 'modal' }, children);
    },
    ActivityIndicator,
    Animated: {
      View,
      Value: class {
        setValue() {}
        interpolate() {
          return {};
        }
      },
      timing: () => ({ start: (done?: () => void) => done?.() }),
    },
    Easing: {
      bezier: () => ({}),
      out: (curve: unknown) => curve,
      exp: {},
    },
    Alert: {
      alert: (title: string, message: string, buttons: any[]) => {
        lastAlert = { title, message, buttons };
      },
    },
    Linking: { openURL: (...args: unknown[]) => openUrlSpy(...args) },
    Share: { share: (...args: unknown[]) => shareSpy(...args) },
    Platform: { OS: 'ios', select: (options: { ios?: unknown }) => options.ios },
    useWindowDimensions: () => ({ width: 390, height: 844 }),
    useColorScheme: () => 'light',
    AccessibilityInfo: {
      isReduceTransparencyEnabled: () => Promise.resolve(false),
      addEventListener: () => ({ remove: () => {} }),
    },
  };
});

const shareSpy = vi.fn(async () => ({ action: 'sharedAction' }));
const openUrlSpy = vi.fn(async () => {});

const pushSpy = vi.fn();
const replaceSpy = vi.fn();
const backSpy = vi.fn();

vi.mock('expo-router', () => ({
  useRouter: () => ({ push: pushSpy, back: backSpy, replace: replaceSpy }),
  useLocalSearchParams: () => ({}),
  useIsFocused: () => true,
}));

vi.mock('@/features/export/raw-export', () => ({
  exportRawArchive: async () => ({ status: 'shared', mediaErrors: 0 }),
}));

vi.mock('@/features/legal/legal-links', () => ({
  getLegalLinks: () => ({
    privacyUrl: 'https://example.com/privacy',
    termsUrl: 'https://example.com/terms',
    supportUrl: 'https://example.com/support',
  }),
}));

vi.mock('react-native-safe-area-context', () => ({
  useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }),
}));

vi.mock('@/hooks/use-theme-color', () => ({
  useThemeColor: () => '#000000',
}));

vi.mock('@/features/session/session-context', () => ({
  useSession: () => ({
    user: { id: 'user-1', displayName: 'Aoi', email: 'aoi@example.com' },
    signOut: signOutSpy,
    deleteAccount: deleteAccountSpy,
  }),
}));

vi.mock('@/features/space/space-context', () => ({
  useSpace: () => ({
    space: mockSpace,
    status: mockStatus,
    leaveSpace: leaveSpaceSpy,
    regenerateInvite: regenerateInviteSpy,
    refreshSpace: refreshSpaceSpy,
  }),
}));

vi.mock('@/features/subscription/subscription-context', () => ({
  useSubscription: () => ({ isPlus: false, status: 'free', serverPlus: mockServerPlus }),
}));

let mockServerPlus: Record<string, any> | null = {
  isPlus: false,
  status: 'inactive',
  expiresAt: null,
  mediaUsedBytes: 128 * 1024 * 1024,
  mediaLimitBytes: 250 * 1024 * 1024,
  activeFutureLetters: 1,
  futureLetterLimit: 1,
};

vi.mock('@/components/theme/theme-selector', () => ({
  ThemeSelector: () => createElement('div', { 'data-testid': 'theme-selector' }),
}));

// Our lists has its own screen tests; this file is about Ours/Account.
vi.mock('@/components/collections/our-lists', () => ({
  OurLists: () => createElement('div', { 'data-testid': 'our-lists' }),
}));

vi.mock('@/components/home/memory-sky', () => ({
  MemorySky: () => null,
  compactSkyHeightForWindow: () => 100,
}));

vi.mock('@/features/moments/moments-context', () => ({
  useMoments: () => ({ moments: [] }),
}));

vi.mock('@/components/ui/surface', () => ({
  Surface: ({ children }: { children?: unknown }) =>
    createElement('div', {}, children),
}));

const signOutSpy = vi.fn(async () => {});
const deleteAccountSpy = vi.fn(async () => {});
const leaveSpaceSpy = vi.fn(async () => {});
const regenerateInviteSpy = vi.fn(async () => 'NEWCODE');
const refreshSpaceSpy = vi.fn(async () => {});

let mockSpace: Record<string, any> | null = null;
let mockStatus = 'ready';

function waitingSpace(overrides: Record<string, any> = {}) {
  return {
    id: 'space-1',
    name: 'Our Space',
    createdByUserId: 'user-1',
    yourName: 'Aoi',
    partnerName: null,
    relationshipStartDate: null,
    inviteCode: 'ABC123',
    partnerJoined: false,
    inviteExpiresAt: new Date(Date.now() + 20 * 24 * 60 * 60 * 1000).toISOString(),
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    ...overrides,
  };
}

function joinedSpace(overrides: Record<string, any> = {}) {
  return waitingSpace({
    partnerName: 'Partner',
    partnerJoined: true,
    inviteCode: '',
    inviteExpiresAt: null,
    ...overrides,
  });
}

beforeEach(() => {
  mockSpace = null;
  mockStatus = 'ready';
  lastAlert = null;
  pushSpy.mockClear();
  replaceSpy.mockClear();
  backSpy.mockClear();
  shareSpy.mockClear();
  openUrlSpy.mockClear();
  signOutSpy.mockClear();
  deleteAccountSpy.mockClear();
  leaveSpaceSpy.mockClear();
  regenerateInviteSpy.mockClear();
  regenerateInviteSpy.mockResolvedValue('NEWCODE');
  refreshSpaceSpy.mockClear();
});

async function renderOurs() {
  const { default: OursScreen } = await import('@/app/(app)/(tabs)/ours');
  return render(<OursScreen />);
}

async function renderAccount() {
  const { default: AccountScreen } = await import('@/app/(app)/account');
  return render(<AccountScreen />);
}

describe('Ours tab waiting state', () => {
  it('opens list creation from the floating add action', async () => {
    await renderOurs();
    fireEvent.click(screen.getByLabelText('New list'));
    expect(pushSpy).toHaveBeenCalledWith('/(app)/collection/new');
  });
  it('expired waiting state offers regeneration, never a dead code', async () => {
    mockSpace = waitingSpace({ inviteCode: '', inviteExpiresAt: null });
    await renderOurs();

    expect(screen.getByText(/no longer active/)).toBeTruthy();
    expect(screen.queryByText('Share invite')).toBeNull();
    await act(async () => {
      fireEvent.click(screen.getByText('New invite code'));
    });
    expect(regenerateInviteSpy).toHaveBeenCalledTimes(1);
  });

  it('shares the invite through the system sheet', async () => {
    mockSpace = waitingSpace();
    await renderOurs();

    fireEvent.click(screen.getByText('Share invite'));
    expect(shareSpy).toHaveBeenCalledTimes(1);
    expect(shareSpy).toHaveBeenCalledWith({ message: expect.stringContaining('aoi://join?code=ABC123') });
    expect(shareSpy).toHaveBeenCalledWith({ message: expect.stringContaining('A B C 1 2 3') });
  });

  it('loading and failed reads are distinct from the empty shelves state', async () => {
    mockStatus = 'loading';
    const loading = await renderOurs();
    expect(screen.getByText('Loading your space…')).toBeTruthy();
    loading.unmount();

    mockStatus = 'error';
    mockSpace = waitingSpace();
    await renderOurs();
    expect(screen.getByText('Unable to load your lists')).toBeTruthy();
    await act(async () => {
      fireEvent.click(screen.getByText('Try again'));
    });
    expect(refreshSpaceSpy).toHaveBeenCalledTimes(1);
  });
});

describe('Account relationship', () => {
  it('keeps the partner and start date, and does not duplicate the invite while waiting', async () => {
    mockSpace = waitingSpace();
    await renderAccount();

    expect(screen.getByText('Not added yet')).toBeTruthy();
    expect(screen.getByText('Not set')).toBeTruthy();
    expect(screen.getByText('Edit relationship')).toBeTruthy();
    // The invite is surfaced on Ours while waiting, not repeated here.
    expect(screen.queryByText('Share invite')).toBeNull();
    expect(screen.queryByText('New invite code')).toBeNull();
    expect(screen.queryByText('ABC123')).toBeNull();
  });

  it('renders the real partner with no invite confusion', async () => {
    mockSpace = joinedSpace();
    const { container } = await renderAccount();

    expect(screen.getAllByText('Partner')).toHaveLength(2);
    expect(screen.queryByText('ABC123')).toBeNull();
    expect(screen.queryByText('Share invite')).toBeNull();
    expect(screen.queryByText('New invite code')).toBeNull();
    expect(container.textContent).not.toMatch(/Waiting for your partner/);
  });
});

describe('Account Plus usage', () => {
  it('shows truthful Free limits from server state', async () => {
    mockSpace = waitingSpace();
    await renderAccount();

    expect(screen.getByText(/Free Space, 250 MiB media, 1 future letter/)).toBeTruthy();
  });

  it('shows active Plus usage from server state', async () => {
    mockServerPlus = {
      isPlus: true,
      status: 'active',
      expiresAt: null,
      mediaUsedBytes: 128 * 1024 * 1024,
      mediaLimitBytes: 5 * 1024 * 1024 * 1024,
      activeFutureLetters: 0,
      futureLetterLimit: null,
    };
    mockSpace = joinedSpace();
    await renderAccount();

    expect(screen.getByText(/Plus is active on your shared Space/)).toBeTruthy();
    expect(screen.getByText(/128 MiB of 5 GiB media used/)).toBeTruthy();
  });
});

describe('Account controls', () => {
  it('renders appearance, data, session, and danger directly', async () => {
    mockSpace = joinedSpace();
    await renderAccount();
    expect(screen.getByTestId('theme-selector')).toBeTruthy();
    expect(screen.getByText('Export my data')).toBeTruthy();
    expect(screen.getByText('Local photo copies')).toBeTruthy();
    expect(screen.getByText('Sign out')).toBeTruthy();
    expect(screen.getByText('Leave space')).toBeTruthy();
    expect(screen.getByText('Delete account')).toBeTruthy();
  });

  it('signs out directly without touching lifecycle APIs', async () => {
    mockSpace = joinedSpace();
    await renderAccount();
    await act(async () => {
      fireEvent.click(screen.getByText('Sign out'));
    });
    expect(signOutSpy).toHaveBeenCalledTimes(1);
    expect(leaveSpaceSpy).not.toHaveBeenCalled();
    expect(replaceSpy).toHaveBeenCalledWith('/(public)');
  });

  // Both confirmations render in the app's own sheet rather than a system
  // alert. What matters is unchanged and still asserted: the reader is asked
  // first, and the retention guarantee is spelled out before they decide.
  it('confirms leaving with the retention contract', async () => {
    mockSpace = joinedSpace();
    await renderAccount();
    fireEvent.click(screen.getByText('Leave space'));
    expect(await screen.findByText('Leave this space?')).toBeTruthy();
    expect(screen.getByText(/partner keeps the shared memories/)).toBeTruthy();
    expect(leaveSpaceSpy).not.toHaveBeenCalled();
    await act(async () => {
      fireEvent.click(screen.getByText('Leave this space'));
    });
    expect(leaveSpaceSpy).toHaveBeenCalledTimes(1);
    expect(replaceSpy).toHaveBeenCalledWith('/(auth)/space-setup');
  });

  it('does not leave twice or dismiss the confirmation during an in-flight request', async () => {
    let finish: () => void = () => {};
    leaveSpaceSpy.mockImplementationOnce(() => new Promise<void>((resolve) => { finish = resolve; }));
    mockSpace = joinedSpace();
    await renderAccount();
    fireEvent.click(screen.getByText('Leave space'));
    fireEvent.click(screen.getByText('Leave this space'));
    fireEvent.click(screen.getByText('Leaving…'));
    fireEvent.click(screen.getByText('Cancel'));
    expect(screen.getByText('Leave this space?')).toBeTruthy();
    expect(leaveSpaceSpy).toHaveBeenCalledOnce();
    expect(replaceSpy).not.toHaveBeenCalled();
    await act(async () => finish());
    expect(replaceSpy).toHaveBeenCalledWith('/(auth)/space-setup');
  });

  it('keeps a failed deletion inside its confirmation so it can be retried', async () => {
    deleteAccountSpy.mockRejectedValueOnce(new Error('offline'));
    mockSpace = joinedSpace();
    await renderAccount();
    fireEvent.click(screen.getByText('Delete account'));
    await act(async () => fireEvent.click(screen.getByText('Delete my account')));
    expect(screen.getByText('Delete your account?')).toBeTruthy();
    expect(screen.getByTestId('native-sheet').textContent).toContain('Failed to delete account. Please try again.');
    expect(replaceSpy).not.toHaveBeenCalled();
    await act(async () => fireEvent.click(screen.getByText('Delete my account')));
    expect(deleteAccountSpy).toHaveBeenCalledTimes(2);
  });

  it('confirms deletion with the retention contract', async () => {
    mockSpace = joinedSpace();
    await renderAccount();
    fireEvent.click(screen.getByText('Delete account'));
    expect(await screen.findByText('Delete your account?')).toBeTruthy();
    expect(screen.getByText(/stay with your partner/)).toBeTruthy();
    expect(screen.getByText(/cannot be undone/)).toBeTruthy();
    expect(deleteAccountSpy).not.toHaveBeenCalled();
    await act(async () => {
      fireEvent.click(screen.getByText('Delete my account'));
    });
    expect(deleteAccountSpy).toHaveBeenCalledTimes(1);
    expect(replaceSpy).toHaveBeenCalledWith('/(public)');
  });

  it('opens legal links', async () => {
    mockSpace = joinedSpace();
    await renderAccount();
    fireEvent.click(screen.getByText('Privacy policy'));
    expect(openUrlSpy).toHaveBeenCalledWith('https://example.com/privacy');
  });
});

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

const replaceSpy = vi.fn();
const backSpy = vi.fn();

vi.mock('expo-router', () => ({
  useRouter: () => ({ push: vi.fn(), back: backSpy, replace: replaceSpy }),
  useLocalSearchParams: () => ({}),
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
    status: 'ready',
    leaveSpace: leaveSpaceSpy,
    regenerateInvite: regenerateInviteSpy,
  }),
}));

vi.mock('@/features/moments/moments-context', () => ({
  useMoments: () => ({ moments: [] }),
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

vi.mock('@/components/ui/surface', () => ({
  Surface: ({ children }: { children?: unknown }) =>
    createElement('div', {}, children),
}));

const signOutSpy = vi.fn(async () => {});
const deleteAccountSpy = vi.fn(async () => {});
const leaveSpaceSpy = vi.fn(async () => {});
const regenerateInviteSpy = vi.fn(async () => 'NEWCODE');

let mockSpace: Record<string, any> | null = null;

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
  lastAlert = null;
  replaceSpy.mockClear();
  backSpy.mockClear();
  shareSpy.mockClear();
  openUrlSpy.mockClear();
  signOutSpy.mockClear();
  deleteAccountSpy.mockClear();
  leaveSpaceSpy.mockClear();
  regenerateInviteSpy.mockClear();
  regenerateInviteSpy.mockResolvedValue('NEWCODE');
});

async function renderSpace() {
  const { default: SpaceScreen } = await import('@/app/(app)/space');
  return render(<SpaceScreen />);
}

describe('Space hub waiting state', () => {
  it('renders invite state with no fake partner or date', async () => {
    mockSpace = waitingSpace();
    const { container } = await renderSpace();

    expect(screen.getByText('ABC123')).toBeTruthy();
    expect(screen.getByText(/Waiting for your partner/)).toBeTruthy();
    expect(screen.getByText('Not added yet')).toBeTruthy();
    expect(screen.getByText('Not set')).toBeTruthy();
    expect(screen.getByText(/Expires /)).toBeTruthy();
    expect(container.textContent).not.toMatch(/Unknown partner|1970|NaN/);
    expect(screen.getByText('Share invite')).toBeTruthy();
  });

  it('expired waiting state offers regeneration, never a dead code', async () => {
    mockSpace = waitingSpace({ inviteCode: '', inviteExpiresAt: null });
    await renderSpace();

    expect(screen.getByText(/no longer active/)).toBeTruthy();
    expect(screen.queryByText('Share invite')).toBeNull();
    await act(async () => {
      fireEvent.click(screen.getByText('New invite code'));
    });
    expect(regenerateInviteSpy).toHaveBeenCalledTimes(1);
  });

  it('shares the invite through the system sheet', async () => {
    mockSpace = waitingSpace();
    await renderSpace();

    fireEvent.click(screen.getByText('Share invite'));
    expect(shareSpy).toHaveBeenCalledTimes(1);
  });
});

describe('Space hub joined state', () => {
  it('renders the real partner with no invite confusion', async () => {
    mockSpace = joinedSpace();
    const { container } = await renderSpace();

    expect(screen.getAllByText('Partner')).toHaveLength(2);
    expect(screen.queryByText('ABC123')).toBeNull();
    expect(screen.queryByText('Share invite')).toBeNull();
    expect(screen.queryByText('New invite code')).toBeNull();
    expect(screen.queryByText(/Waiting for your partner/)).toBeNull();
    expect(container.textContent).toMatch(/is in this space with you/);
  });
});

describe('Space hub Plus usage', () => {
  it('shows truthful Free limits from server state', async () => {
    mockSpace = waitingSpace();
    await renderSpace();

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
    await renderSpace();

    expect(screen.getByText(/Plus is active on your shared Space/)).toBeTruthy();
    expect(screen.getByText(/128 MiB of 5 GiB media used/)).toBeTruthy();
  });
});

describe('Space account segment (same screen, no nested settings route)', () => {
  async function openAccount() {
    mockSpace = joinedSpace();
    await renderSpace();
    fireEvent.click(screen.getByText('Account'));
  }

  it('hides account controls until the Account segment is chosen', async () => {
    mockSpace = joinedSpace();
    await renderSpace();
    expect(screen.getByText('Edit relationship')).toBeTruthy();
    expect(screen.queryByText('Sign out')).toBeNull();
    expect(screen.queryByText('Leave space')).toBeNull();
    fireEvent.click(screen.getByText('Account'));
    expect(screen.getByTestId('theme-selector')).toBeTruthy();
    expect(screen.getByText('Sign out')).toBeTruthy();
    expect(screen.getByText('Leave space')).toBeTruthy();
  });

  it('signs out directly without touching lifecycle APIs', async () => {
    await openAccount();
    await act(async () => {
      fireEvent.click(screen.getByText('Sign out'));
    });
    expect(signOutSpy).toHaveBeenCalledTimes(1);
    expect(leaveSpaceSpy).not.toHaveBeenCalled();
    expect(replaceSpy).toHaveBeenCalledWith('/(public)');
  });

  it('confirms leaving with the retention contract', async () => {
    await openAccount();
    fireEvent.click(screen.getByText('Leave space'));
    expect(lastAlert?.title).toBe('Leave this space?');
    expect(lastAlert?.message ?? '').toMatch(/partner keeps the shared memories/);
    await act(async () => {
      lastAlert?.buttons?.find((b) => b.style === 'destructive')?.onPress?.();
    });
    expect(leaveSpaceSpy).toHaveBeenCalledTimes(1);
    expect(replaceSpy).toHaveBeenCalledWith('/(auth)/space-setup');
  });

  it('confirms deletion with the retention contract', async () => {
    await openAccount();
    fireEvent.click(screen.getByText('Delete account'));
    expect(lastAlert?.title).toBe('Delete your account?');
    expect(lastAlert?.message ?? '').toMatch(/stay with your partner/);
    expect(lastAlert?.message ?? '').toMatch(/cannot be undone/);
    await act(async () => {
      lastAlert?.buttons?.find((b) => b.style === 'destructive')?.onPress?.();
    });
    expect(deleteAccountSpy).toHaveBeenCalledTimes(1);
    expect(replaceSpy).toHaveBeenCalledWith('/(public)');
  });

  it('opens legal links', async () => {
    await openAccount();
    fireEvent.click(screen.getByText('Privacy policy'));
    expect(openUrlSpy).toHaveBeenCalledWith('https://example.com/privacy');
  });
});

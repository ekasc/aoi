import { act, render } from '@testing-library/react';
import { createElement, type PropsWithChildren } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import RootLayout from '@/app/_layout';
import { BeachThemes } from '@/constants/theme-presets';

const state = vi.hoisted(() => ({
  theme: false,
  session: false,
  space: false,
  hideNative: vi.fn(async () => {}),
  navigate: vi.fn(),
  launch: null as null | { ready: boolean; onLayout: () => void; onHidden: () => void },
}));

vi.mock('@/features/session/session-context', () => ({
  SessionProvider: ({ children }: PropsWithChildren) => children,
  useSession: () => ({ isHydrated: state.session, user: null }),
}));
vi.mock('@/features/space/space-context', () => ({
  SpaceProvider: ({ children }: PropsWithChildren) => children,
  useSpace: () => ({ isHydrated: state.space }),
}));
vi.mock('@/features/theme/theme-context', () => ({
  AoiThemeProvider: ({ children }: PropsWithChildren) => children,
  useAoiTheme: () => ({ mode: 'light', colors: BeachThemes.beach.light, isHydrated: state.theme }),
}));
vi.mock('@/features/subscription/subscription-context', () => ({ SubscriptionProvider: ({ children }: PropsWithChildren) => children }));
vi.mock('@/features/moments/moments-context', () => ({ MomentsProvider: ({ children }: PropsWithChildren) => children }));
vi.mock('@/components/home/sky-entry-provider', () => ({ SkyEntryProvider: ({ children }: PropsWithChildren) => children }));
vi.mock('@/components/dev/debug-harness', () => ({ DebugHarness: ({ children }: PropsWithChildren) => children }));
vi.mock('@/features/dev/dev-seed', () => ({ ensureDevSeed: async () => {} }));
vi.mock('@/features/crypto/global-crypto', () => ({ installGlobalCrypto: () => {} }));
vi.mock('@/features/notifications/notifications-module', () => ({ notificationsModule: () => null, guardPushNotificationIOS: () => {} }));
vi.mock('@/features/space/use-invite-link', () => ({ useInviteLink: () => null }));
vi.mock('expo-splash-screen', () => ({ preventAutoHideAsync: async () => true, hideAsync: state.hideNative }));
vi.mock('expo-router', () => ({ useRouter: () => ({ replace: vi.fn() }) }));
vi.mock('expo-router/react-navigation', () => ({
  ThemeProvider: ({ children }: PropsWithChildren) => children,
  DarkTheme: { colors: {} }, DefaultTheme: { colors: {} },
}));
vi.mock('expo-router/stack', () => ({
  Stack: Object.assign(() => { state.navigate(); return null; }, { Screen: () => null }),
}));
vi.mock('@/components/launch-splash', () => ({
  LaunchSplash: (props: NonNullable<typeof state.launch>) => { state.launch = props; return null; },
}));

beforeEach(() => {
  state.theme = false;
  state.session = false;
  state.space = false;
  state.launch = null;
  vi.clearAllMocks();
});

async function mountRoot() {
  const view = render(createElement(RootLayout));
  await act(async () => {});
  return view;
}

describe('native to themed startup', () => {
  it('does not render the default scene or hide native before the saved theme hydrates', async () => {
    await mountRoot();
    expect(state.launch).toBeNull();
    expect(state.hideNative).not.toHaveBeenCalled();
    expect(state.navigate).not.toHaveBeenCalled();
  });

  it('hides native only after the themed view lays out, and waits for local providers', async () => {
    state.theme = true;
    await mountRoot();
    expect(state.launch?.ready).toBe(false);
    expect(state.hideNative).not.toHaveBeenCalled();
    act(() => state.launch?.onLayout());
    expect(state.hideNative).toHaveBeenCalledTimes(1);
    expect(state.navigate).not.toHaveBeenCalled();
    expect(state.launch?.ready).toBe(false);
  });

  it('mounts navigation underneath the outgoing splash, without a branding timer', async () => {
    state.theme = true;
    state.session = true;
    const { rerender } = await mountRoot();
    act(() => state.launch?.onLayout());
    expect(state.launch?.ready).toBe(false);
    state.space = true;
    rerender(createElement(RootLayout));
    expect(state.navigate).toHaveBeenCalled();
    expect(state.launch?.ready).toBe(true);
    const navigationMounts = state.navigate.mock.calls.length;
    act(() => state.launch?.onHidden());
    expect(state.navigate.mock.calls.length).toBeGreaterThanOrEqual(navigationMounts);
  });
});

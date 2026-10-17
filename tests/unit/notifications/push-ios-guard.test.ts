import { describe, it, expect, vi, afterEach } from 'vitest';

import {
  guardPushNotificationIOS,
  shouldGuardPushNotificationIOS,
} from '@/features/notifications/notifications-module';

/**
 * Mirrors React Native's extracted module on a build without the native
 * side: touching the lazy getter throws before any call is made.
 */
function crashingExports(): Record<string, unknown> {
  const exportsObject: Record<string, unknown> = {};
  Object.defineProperty(exportsObject, 'PushNotificationIOS', {
    configurable: true,
    enumerable: true,
    get(): unknown {
      throw new Error(`'new NativeEventEmitter()' requires a non-null argument.`);
    },
  });
  return exportsObject;
}

const absentProbe = () => ({ platformOS: 'ios' as const, present: false as const });
const presentProbe = () => ({ platformOS: 'ios' as const, present: true as const });

describe('shouldGuardPushNotificationIOS', () => {
  it('guards only a definite iOS-without-native-module', () => {
    expect(shouldGuardPushNotificationIOS('ios', false)).toBe(true);
    expect(shouldGuardPushNotificationIOS('ios', true)).toBe(false);
    // Unknowns fail open: a missed guard is a visible RedBox, a wrong guard
    // would silently stub working push.
    expect(shouldGuardPushNotificationIOS('ios', null)).toBe(false);
    expect(shouldGuardPushNotificationIOS('android', false)).toBe(false);
    expect(shouldGuardPushNotificationIOS(undefined, false)).toBe(false);
  });
});

describe('guardPushNotificationIOS', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('leaves builds with working push untouched', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const exportsObject = crashingExports();
    guardPushNotificationIOS(exportsObject, presentProbe);
    expect(warn).not.toHaveBeenCalled();
    // Untouched: the fatal getter still throws (proving no stub was fitted).
    expect(() => exportsObject.PushNotificationIOS).toThrow();
  });

  it('leaves builds without the lazy getter untouched', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const exportsObject: Record<string, unknown> = {};
    guardPushNotificationIOS(exportsObject, absentProbe);
    expect(warn).not.toHaveBeenCalled();
    expect('PushNotificationIOS' in exportsObject).toBe(false);
  });

  it('replaces a fatal lazy getter with a no-op stub and logs the first touch', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const exportsObject = crashingExports();
    guardPushNotificationIOS(exportsObject, absentProbe);

    const touched = exportsObject.PushNotificationIOS as {
      addEventListener: (...args: unknown[]) => unknown;
    };
    expect(() => touched.addEventListener('notification', () => {})).not.toThrow();
    expect(warn).toHaveBeenCalledOnce();
    expect(String(warn.mock.calls[0]?.[0])).toContain('PushNotificationIOS');

    // Later touches stay silent; the stack is for finding the caller once.
    const touchedAgain = exportsObject.PushNotificationIOS as {
      addEventListener: (...args: unknown[]) => unknown;
    };
    touchedAgain.addEventListener('register', () => {});
    expect(warn).toHaveBeenCalledOnce();
  });

  it('never throws, even when the exports object cannot be redefined', () => {
    const exportsObject = Object.freeze(crashingExports());
    expect(() => guardPushNotificationIOS(exportsObject, absentProbe)).not.toThrow();
  });
});

import { NOTIFICATIONS_ENABLED } from '@/constants/notifications';

/** The module's own shape, taken from its types. */
export type NotificationsModule = typeof import('expo-notifications');

let loaded: NotificationsModule | null | undefined;
let guardInstalled = false;

/**
 * The notifications module, or null where it must not be used.
 *
 * Importing `expo-notifications` is itself the failure in Expo Go on Android:
 * the module throws as it loads, before any call is made, so a top-level
 * import cannot be defended against by guarding the calls. Everything that
 * needs it asks here instead, and the require is only reached once
 * `NOTIFICATIONS_ENABLED` says notifications are on.
 */
export function notificationsModule(): NotificationsModule | null {
	if (!NOTIFICATIONS_ENABLED) {
		return null;
	}
	if (loaded === undefined) {
		try {
			// eslint-disable-next-line @typescript-eslint/no-require-imports -- see above: a static import throws on Android in Expo Go.
			loaded = require('expo-notifications') as NotificationsModule;
		} catch {
			loaded = null;
		}
	}
	return loaded;
}

/**
 * A no-op stand-in for React Native's PushNotificationIOS, for builds where
 * its native module cannot exist. Every property reads as a no-op function
 * (never thenable, so awaiting it cannot hang); construction returns another
 * stub. The first touch logs a stack so the accessor can be found and fixed
 * instead of silently depending on the stub.
 */
function makePushNotificationIOSStub(notify: () => void): (...args: never[]) => unknown {
	const target = () => undefined;
	const handler: ProxyHandler<typeof target> = {
		get(_target, property) {
			notify();
			if (property === Symbol.toPrimitive) {
				return () => '[PushNotificationIOS stub: native module missing]';
			}
			if (property === 'then') {
				return undefined;
			}
			return (..._args: unknown[]) => undefined;
		},
		set() {
			notify();
			return true;
		},
		apply() {
			notify();
			return undefined;
		},
		construct() {
			notify();
			return makePushNotificationIOSStub(notify);
		},
	};
	return new Proxy(target, handler);
}

/**
 * Whether the PushNotificationIOS guard must install.
 *
 * Fails open on purpose: only a definite "iOS without the native module"
 * installs anything. An unknown platform or an unreadable registry leaves
 * the genuine getter alone — a missed guard is a visible RedBox, while a
 * wrong guard would silently stub working push.
 */
export function shouldGuardPushNotificationIOS(
	platformOS: string | undefined,
	hasPushNativeModule: boolean | null,
): boolean {
	if (platformOS !== 'ios') {
		return false;
	}
	return hasPushNativeModule === false;
}

/**
 * Probe the environment behind PushNotificationIOS without loading the fatal
 * JS module. Never throws; `present: null` means the probe itself failed.
 */
function probePushNativeModule(): { platformOS: string | undefined; present: boolean | null } {
	try {
		// eslint-disable-next-line @typescript-eslint/no-require-imports -- module-scope guard installed before any screen runs; see notificationsModule above.
		const rn = require('react-native') as {
			Platform?: { OS?: string };
		};
		const platformOS = rn.Platform?.OS;
		if (platformOS !== 'ios') {
			return { platformOS, present: true };
		}
		// eslint-disable-next-line @typescript-eslint/no-require-imports -- deep import mirrors the spec's own source of truth; guarded, fail-open.
		const registry = require('react-native/Libraries/TurboModule/TurboModuleRegistry') as {
			get?: (name: string) => unknown;
		};
		if (typeof registry.get !== 'function') {
			return { platformOS, present: null };
		}
		return { platformOS, present: registry.get('PushNotificationManager') != null };
	} catch {
		return { platformOS: undefined, present: null };
	}
}

/**
 * Neutralize React Native's extracted PushNotificationIOS getter — but only
 * where its native module is definitely absent.
 *
 * On builds without the push entitlement iOS never provides the
 * PushNotificationManager native module, and
 * `Libraries/PushNotificationIOS/PushNotificationIOS.js` runs
 * `new NativeEventEmitter(nativeModule)` at module scope. Metro's own
 * `importAll` (async-require / Fast Refresh) enumerates the react-native
 * exports, which runs that module scope — and Metro reports the throw as
 * fatal *while it propagates*, so catching it at the getter is too late.
 * The guard therefore probes the native module first and never runs the
 * fatal require at all: the replacement getter returns a no-op stub
 * directly and logs the first touch's stack (so the caller can be found
 * and fixed). Builds with a working native module are untouched.
 * Idempotent. Never throws.
 */
export function guardPushNotificationIOS(
	reactNativeExports?: Record<string, unknown>,
	probe: () => { platformOS: string | undefined; present: boolean | null } = probePushNativeModule,
): void {
	try {
		if (guardInstalled) {
			return;
		}
		const { platformOS, present } = probe();
		if (!shouldGuardPushNotificationIOS(platformOS, present)) {
			return;
		}
		// eslint-disable-next-line @typescript-eslint/no-require-imports -- module-scope guard installed before any screen runs; see notificationsModule above.
		const exportsObject = reactNativeExports ?? (require('react-native') as Record<string, unknown>);
		const descriptor = Object.getOwnPropertyDescriptor(exportsObject, 'PushNotificationIOS');
		if (!descriptor || typeof descriptor.get !== 'function') {
			return;
		}
		let warned = false;
		const notify = () => {
			if (warned) {
				return;
			}
			warned = true;
			console.warn(
				`[push] PushNotificationIOS touched but its native module is missing in this build; using a no-op stub. First touch:${new Error('trace').stack ?? ''}`,
			);
		};
		Object.defineProperty(exportsObject, 'PushNotificationIOS', {
			configurable: true,
			enumerable: descriptor.enumerable,
			get: () => {
				notify();
				return makePushNotificationIOSStub(notify);
			},
		});
		guardInstalled = true;
	} catch {
		// The guard must never break launch.
	}
}

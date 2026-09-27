/**
 * Local build overrides for a free Apple Developer account.
 *
 * A personal team cannot hold two capabilities this app asks for:
 * `aps-environment` (push) and `com.apple.developer.applesignin`. Apple will
 * not issue a provisioning profile for an app requesting either, so no dev
 * build can be installed on a physical device until the account is on the
 * paid programme. That is Apple policy, and no build service bypasses it.
 *
 * So for local device builds only, both capabilities come off. What that
 * costs in a *local* build: push does not arrive, and sign-in goes through
 * the stub backend rather than Apple. Neither has anything to do with the
 * album, and the real build is untouched.
 *
 * The bundle id also gains `.dev` so the stripped build installs alongside
 * the real one instead of replacing it, and so the two never share keychain
 * entries.
 *
 * This file is not the app's config. It layers over `app.json` and returns
 * it untouched unless asked:
 *
 *   AOI_DEV_NO_CAPABILITIES=1 npx expo run:ios --device <udid>
 *
 * Anything built without that variable is the real app, with both
 * capabilities and the production bundle id.
 */
const STRIP = process.env.AOI_DEV_NO_CAPABILITIES === '1';

const DEV_BUNDLE_SUFFIX = '.dev';
const PROD_BUNDLE_ID = 'com.ekasc.aoi';

module.exports = ({ config }) => {
  if (!STRIP) {
    return config;
  }

  const ios = config.ios ?? {};
  const bundleId = ios.bundleIdentifier ?? PROD_BUNDLE_ID;

  return {
    ...config,
    ios: {
      ...ios,
      bundleIdentifier: `${bundleId}${DEV_BUNDLE_SUFFIX}`,
      // Dropped for a personal team. Both are re-added by the real build.
      entitlements: {
        'com.apple.developer.applesignin': undefined,
        'aps-environment': undefined,
      },
    },
    extra: {
      ...config.extra,
      // A stripped build has no push, and no Apple sign-in, so it must not
      // pretend to. Anything that branches on these should read them.
      devStrippedCapabilities: true,
    },
  };
};

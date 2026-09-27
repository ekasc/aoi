const { withEntitlementsPlist } = require('expo/config-plugins');

/**
 * Drops the two capabilities a free Apple Developer team cannot hold.
 *
 * Apple will not issue a provisioning profile for an app requesting push
 * notifications or Sign in with Apple on a personal team, so a local device
 * build fails at signing with a message that looks like a misconfiguration
 * and is not one. The entitlements file is generated during prebuild, which
 * is the only place this can be fixed.
 *
 * Off unless asked, and then both capabilities come back:
 *
 *   AOI_DEV_NO_CAPABILITIES=1 npx expo run:ios --device <udid>
 *
 * What a stripped build loses: push never arrives, and sign-in goes through
 * the stub backend. Neither touches the album, and the real build is
 * untouched.
 */
module.exports = function withNoPersonalTeamCapabilities(config) {
  if (process.env.AOI_DEV_NO_CAPABILITIES !== '1') {
    return config;
  }

  return withEntitlementsPlist(config, (config) => {
    if (!config.modResults) {
      config.modResults = {};
    }
    delete config.modResults['aps-environment'];
    delete config.modResults['com.apple.developer.applesignin'];
    return config;
  });
};

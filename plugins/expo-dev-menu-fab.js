/**
 * Disables the expo-dev-menu floating action button (blue gear) in
 * development builds via the manifest flag the dev menu reads natively
 * (`EXDevMenuShowFloatingActionButton`, default true). The dev menu itself
 * stays reachable through the shake gesture — only the always-on-top
 * button is removed so design captures read as production.
 */
const { withAndroidManifest } = require('@expo/config-plugins');

const FLAG = 'EXDevMenuShowFloatingActionButton';

module.exports = function withDevMenuFabDisabled(config) {
  return withAndroidManifest(config, (config) => {
    const application = config.modResults.manifest.application?.[0];
    if (!application) {
      return config;
    }
    application['meta-data'] = application['meta-data'] ?? [];
    const existing = application['meta-data'].find(
      (entry) => entry.$?.['android:name'] === FLAG
    );
    if (existing) {
      existing.$['android:value'] = 'false';
    } else {
      application['meta-data'].push({
        $: { 'android:name': FLAG, 'android:value': 'false' },
      });
    }
    return config;
  });
};

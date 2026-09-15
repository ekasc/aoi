/**
 * Production release-config validation (P9B). Pure functions over explicit
 * env maps so they run identically in unit tests, a release script, and
 * (for the worker half) a preflight check. Development/stub mode is
 * untouched — these gates only apply to production releases.
 *
 * Philosophy: production must fail LOUD (a blocking list) rather than boot
 * with placeholders like `aoi.example` or silently missing secrets.
 */

export type ReleaseProblem = {
  /** Machine-stable key, e.g. 'oauth.google-client-id'. */
  key: string;
  /** Human remediation, naming the exact env/config name. */
  fix: string;
};

const PLACEHOLDER_HOSTS = ['aoi.example', 'example.com', 'localhost', '127.0.0.1'];

function isPlaceholderUrl(value: string | undefined): boolean {
  if (!value) return true;
  const lowered = value.trim().toLowerCase();
  return PLACEHOLDER_HOSTS.some((host) => lowered.includes(host));
}

function isWeakSecret(value: string | undefined): boolean {
  if (!value) return true;
  const trimmed = value.trim();
  if (trimmed.length < 16) return true;
  return /^(test|dev|changeme|placeholder|secret)/i.test(trimmed);
}

/**
 * Client (Expo) production requirements. Pass `process.env` in app code;
 * tests inject maps.
 */
export function validateClientReleaseConfig(
  env: Record<string, string | undefined> = process.env as Record<string, string | undefined>
): ReleaseProblem[] {
  const problems: ReleaseProblem[] = [];

  if (env.EXPO_PUBLIC_AUTH_STUB_MODE !== 'false') {
    problems.push({
      key: 'auth.stub-mode',
      fix: 'Set EXPO_PUBLIC_AUTH_STUB_MODE=false for any production build.',
    });
  }

  const apiBase = env.EXPO_PUBLIC_AUTH_API_BASE_URL?.trim();
  if (!apiBase || !apiBase.startsWith('https://') || isPlaceholderUrl(apiBase)) {
    problems.push({
      key: 'auth.api-base-url',
      fix: 'Set EXPO_PUBLIC_AUTH_API_BASE_URL to the production worker https URL (no placeholders, no localhost).',
    });
  }

  for (const [key, name] of [
    ['auth.google-client-id', 'EXPO_PUBLIC_GOOGLE_CLIENT_ID'],
    ['auth.google-ios-client-id', 'EXPO_PUBLIC_GOOGLE_IOS_CLIENT_ID'],
  ] as const) {
    if (!env[name]?.trim()) {
      problems.push({ key, fix: `Set ${name} to the production OAuth client id.` });
    }
  }

  // RevenueCat: submission needs the iOS key at minimum; Android without
  // one is a fail-closed store, which is only acceptable if Android is
  // deliberately out of scope for the release.
  if (!env.EXPO_PUBLIC_REVENUECAT_IOS_KEY?.trim()) {
    problems.push({
      key: 'billing.revenuecat-ios-key',
      fix: 'Set EXPO_PUBLIC_REVENUECAT_IOS_KEY to the production public SDK key.',
    });
  }
  if (!env.EXPO_PUBLIC_REVENUECAT_ANDROID_KEY?.trim()) {
    problems.push({
      key: 'billing.revenuecat-android-key',
      fix: 'Set EXPO_PUBLIC_REVENUECAT_ANDROID_KEY, or formally descope Android purchasing (store goes fail-closed).',
    });
  }

  for (const [key, name] of [
    ['legal.privacy-url', 'EXPO_PUBLIC_PRIVACY_URL'],
    ['legal.terms-url', 'EXPO_PUBLIC_TERMS_URL'],
    ['legal.support-url', 'EXPO_PUBLIC_SUPPORT_URL'],
  ] as const) {
    const value = env[name]?.trim();
    if (!value || !/^(https:\/\/|mailto:)/i.test(value) || isPlaceholderUrl(value)) {
      problems.push({
        key,
        fix: `Set ${name} to the real https:// (or mailto: for support) destination. Placeholder links are a release blocker.`,
      });
    }
  }

  return problems;
}

/**
 * Worker production requirements. `env` is the wrangler vars+secrets map
 * (or a subset in tests). Placeholders and short/test secrets fail loudly.
 */
export function validateWorkerReleaseConfig(
  env: Record<string, string | undefined>
): ReleaseProblem[] {
  const problems: ReleaseProblem[] = [];

  if (isWeakSecret(env.BETTER_AUTH_SECRET)) {
    problems.push({
      key: 'auth.secret',
      fix: 'Set a strong BETTER_AUTH_SECRET via `wrangler secret put` (≥16 chars, not test/dev).',
    });
  }

  for (const [key, name] of [
    ['auth.google-client-id', 'GOOGLE_CLIENT_ID'],
    ['auth.google-client-secret', 'GOOGLE_CLIENT_SECRET'],
    ['auth.apple-client-id', 'APPLE_CLIENT_ID'],
    ['auth.apple-client-secret', 'APPLE_CLIENT_SECRET'],
    ['auth.apple-bundle-id', 'APPLE_APP_BUNDLE_ID'],
    ['billing.webhook-secret', 'REVENUECAT_WEBHOOK_SECRET'],
  ] as const) {
    if (!env[name]?.trim()) {
      problems.push({ key, fix: `Set ${name} via \`wrangler secret put\` (production values).` });
    }
  }
  if (isWeakSecret(env.REVENUECAT_WEBHOOK_SECRET)) {
    problems.push({
      key: 'billing.webhook-secret-strength',
      fix: 'REVENUECAT_WEBHOOK_SECRET must be a strong random value matching the RevenueCat dashboard.',
    });
  }

  const cors = env.CORS_ORIGIN?.trim();
  if (!cors || !cors.startsWith('https://') || isPlaceholderUrl(cors)) {
    problems.push({
      key: 'net.cors-origin',
      fix: 'Set CORS_ORIGIN to the production app origin (https, no aoi.example placeholder).',
    });
  }

  const appBase = env.APP_BASE_URL?.trim();
  if (!appBase || !appBase.startsWith('https://') || isPlaceholderUrl(appBase)) {
    problems.push({
      key: 'net.app-base-url',
      fix: 'Set APP_BASE_URL to the production worker URL.',
    });
  }

  return problems;
}

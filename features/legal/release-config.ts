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
  try {
    const url = new URL(value.trim());
    return url.protocol !== 'https:' || !!url.username || !!url.password ||
      PLACEHOLDER_HOSTS.some((host) => url.hostname === host || url.hostname.endsWith(`.${host}`));
  } catch {
    return true;
  }
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

  for (const name of ['EXPO_PUBLIC_DEV_SEED', 'AOI_DEV_NO_CAPABILITIES']) {
    if (env[name]?.trim() && env[name] !== 'false' && env[name] !== '0') {
      problems.push({ key: `dev.${name}`, fix: `Unset ${name} for a production build.` });
    }
  }

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

  if (!env.EXPO_PUBLIC_REVENUECAT_IOS_KEY?.trim().startsWith('appl_')) {
    problems.push({
      key: 'billing.revenuecat-ios-key',
      fix: 'Set EXPO_PUBLIC_REVENUECAT_IOS_KEY to the Apple public SDK key (appl_), not a test or secret key.',
    });
  }
  if (!env.EXPO_PUBLIC_REVENUECAT_ANDROID_KEY?.trim().startsWith('goog_')) {
    problems.push({
      key: 'billing.revenuecat-android-key',
      fix: 'Set EXPO_PUBLIC_REVENUECAT_ANDROID_KEY to the Google public SDK key (goog_), not a test or secret key.',
    });
  }

  for (const [key, name] of [
    ['legal.privacy-url', 'EXPO_PUBLIC_PRIVACY_URL'],
    ['legal.terms-url', 'EXPO_PUBLIC_TERMS_URL'],
    ['legal.support-url', 'EXPO_PUBLIC_SUPPORT_URL'],
  ] as const) {
    const value = env[name]?.trim();
    const supportEmail = name === 'EXPO_PUBLIC_SUPPORT_URL' && /^mailto:[^\s@]+@[^\s@]+\.[^\s@]+$/i.test(value ?? '');
    if (!supportEmail && isPlaceholderUrl(value)) {
      problems.push({
        key,
        fix: `Set ${name} to a real HTTPS destination${name === 'EXPO_PUBLIC_SUPPORT_URL' ? ' or support mailto address' : ''}.`,
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

  if (env.AOI_E2E_MODE === 'true' || env.AOI_E2E_SECRET?.trim()) {
    problems.push({ key: 'auth.e2e-config', fix: 'Remove AOI_E2E_MODE and AOI_E2E_SECRET from production.' });
  }

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

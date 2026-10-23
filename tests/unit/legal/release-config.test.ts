import { describe, expect, it } from 'vitest';

import { getLegalLinks } from '@/features/legal/legal-links';
import {
  validateClientReleaseConfig,
  validateWorkerReleaseConfig,
} from '@/features/legal/release-config';

describe('getLegalLinks', () => {
  it('returns configured https/mailto destinations', () => {
    expect(
      getLegalLinks({
        EXPO_PUBLIC_PRIVACY_URL: 'https://aoiapp.com/privacy',
        EXPO_PUBLIC_TERMS_URL: 'https://aoiapp.com/terms',
        EXPO_PUBLIC_SUPPORT_URL: 'mailto:support@aoiapp.com',
      })
    ).toEqual({
      privacyUrl: 'https://aoiapp.com/privacy',
      termsUrl: 'https://aoiapp.com/terms',
      supportUrl: 'mailto:support@aoiapp.com',
    });
  });

  it('renders nothing configurable when absent — never a fake link', () => {
    expect(getLegalLinks({})).toEqual({
      privacyUrl: null,
      termsUrl: null,
      supportUrl: null,
    });
  });

  it('rejects non-https/non-mailto schemes', () => {
    expect(
      getLegalLinks({
        EXPO_PUBLIC_PRIVACY_URL: 'http://aoiapp.com/privacy',
        EXPO_PUBLIC_TERMS_URL: 'javascript:alert(1)',
        EXPO_PUBLIC_SUPPORT_URL: 'aoiapp.com/support',
      })
    ).toEqual({ privacyUrl: null, termsUrl: null, supportUrl: null });
  });
});

const GOOD_CLIENT_ENV = {
  EXPO_PUBLIC_AUTH_STUB_MODE: 'false',
  EXPO_PUBLIC_AUTH_API_BASE_URL: 'https://api.aoiapp.com',
  EXPO_PUBLIC_GOOGLE_CLIENT_ID: 'web-id',
  EXPO_PUBLIC_GOOGLE_IOS_CLIENT_ID: 'ios-id',
  EXPO_PUBLIC_REVENUECAT_IOS_KEY: 'appl_key',
  EXPO_PUBLIC_REVENUECAT_ANDROID_KEY: 'goog_key',
  EXPO_PUBLIC_PRIVACY_URL: 'https://aoiapp.com/privacy',
  EXPO_PUBLIC_TERMS_URL: 'https://aoiapp.com/terms',
  EXPO_PUBLIC_SUPPORT_URL: 'mailto:support@aoiapp.com',
};

const GOOD_WORKER_ENV = {
  BETTER_AUTH_SECRET: 'a-very-long-random-secret-value-123',
  GOOGLE_CLIENT_ID: 'web-id',
  GOOGLE_CLIENT_SECRET: 'web-secret',
  APPLE_CLIENT_ID: 'services-id',
  APPLE_CLIENT_SECRET: 'es256-secret',
  APPLE_APP_BUNDLE_ID: 'com.ekasc.aoi',
  REVENUECAT_WEBHOOK_SECRET: 'a-very-long-random-webhook-secret-1',
  CORS_ORIGIN: 'https://aoiapp.com',
  APP_BASE_URL: 'https://api.aoiapp.com',
};

describe('validateClientReleaseConfig', () => {
  it('passes a complete production env', () => {
    expect(validateClientReleaseConfig(GOOD_CLIENT_ENV)).toEqual([]);
  });

  it('fails stub mode, placeholders, and missing legal URLs', () => {
    const problems = validateClientReleaseConfig({
      ...GOOD_CLIENT_ENV,
      EXPO_PUBLIC_AUTH_STUB_MODE: 'true',
      EXPO_PUBLIC_AUTH_API_BASE_URL: 'http://localhost:8787',
      EXPO_PUBLIC_PRIVACY_URL: undefined,
    });
    expect(problems.map((p) => p.key)).toEqual(
      expect.arrayContaining([
        'auth.stub-mode',
        'auth.api-base-url',
        'legal.privacy-url',
      ])
    );
  });

  it('fails a missing iOS store key', () => {
    const { EXPO_PUBLIC_REVENUECAT_IOS_KEY: _omit, ...rest } = GOOD_CLIENT_ENV;
    expect(
      validateClientReleaseConfig(rest).map((p) => p.key)
    ).toContain('billing.revenuecat-ios-key');
  });
});

describe('validateWorkerReleaseConfig', () => {
  it('passes a complete production env', () => {
    expect(validateWorkerReleaseConfig(GOOD_WORKER_ENV)).toEqual([]);
  });

  it('fails weak secrets, missing values, and placeholder origins', () => {
    const problems = validateWorkerReleaseConfig({
      ...GOOD_WORKER_ENV,
      BETTER_AUTH_SECRET: 'test',
      GOOGLE_CLIENT_SECRET: undefined,
      REVENUECAT_WEBHOOK_SECRET: '',
      CORS_ORIGIN: 'https://aoi.example',
    });
    expect(problems.map((p) => p.key)).toEqual(
      expect.arrayContaining([
        'auth.secret',
        'auth.google-client-secret',
        'billing.webhook-secret',
        'billing.webhook-secret-strength',
        'net.cors-origin',
      ])
    );
  });
});


describe('store release boundaries', () => {
  it('requires store-specific public billing key prefixes', () => {
    const env = { ...GOOD_CLIENT_ENV };
    env.EXPO_PUBLIC_REVENUECAT_IOS_KEY = 'invalid';
    env.EXPO_PUBLIC_REVENUECAT_ANDROID_KEY = 'invalid';
    expect(validateClientReleaseConfig(env).map((problem) => problem.key)).toEqual(
      expect.arrayContaining(['billing.revenuecat-ios-key', 'billing.revenuecat-android-key'])
    );
  });

  it('rejects test authentication mode on the production worker', () => {
    expect(validateWorkerReleaseConfig({ ...GOOD_WORKER_ENV, AOI_E2E_MODE: 'true' })
      .map((problem) => problem.key)).toContain('auth.e2e-config');
  });

  it.each(['mailto:policy@aoiapp.com', 'https://', 'https://user:pass@aoiapp.com/privacy'])(
    'rejects a non-public policy destination %s', (url) => {
      expect(getLegalLinks({ EXPO_PUBLIC_PRIVACY_URL: url }).privacyUrl).toBeNull();
      expect(validateClientReleaseConfig({ ...GOOD_CLIENT_ENV, EXPO_PUBLIC_PRIVACY_URL: url })
        .map((problem) => problem.key)).toContain('legal.privacy-url');
    }
  );

  it.each(['EXPO_PUBLIC_DEV_SEED', 'AOI_DEV_NO_CAPABILITIES'])(
    'blocks a development override %s in production', (name) => {
      expect(validateClientReleaseConfig({ ...GOOD_CLIENT_ENV, [name]: '1' })
        .map((problem) => problem.key)).toContain(`dev.${name}`);
    }
  );

  it('reads the inlined legal environment without requiring an injected map', () => {
    const previous = process.env.EXPO_PUBLIC_PRIVACY_URL;
    process.env.EXPO_PUBLIC_PRIVACY_URL = GOOD_CLIENT_ENV.EXPO_PUBLIC_PRIVACY_URL;
    try {
      expect(getLegalLinks().privacyUrl).toBe(GOOD_CLIENT_ENV.EXPO_PUBLIC_PRIVACY_URL);
    } finally {
      if (previous === undefined) delete process.env.EXPO_PUBLIC_PRIVACY_URL;
      else process.env.EXPO_PUBLIC_PRIVACY_URL = previous;
    }
  });
});

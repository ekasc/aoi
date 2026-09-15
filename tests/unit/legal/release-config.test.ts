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
        EXPO_PUBLIC_PRIVACY_URL: 'https://aoi.app/privacy',
        EXPO_PUBLIC_TERMS_URL: 'https://aoi.app/terms',
        EXPO_PUBLIC_SUPPORT_URL: 'mailto:support@aoi.app',
      })
    ).toEqual({
      privacyUrl: 'https://aoi.app/privacy',
      termsUrl: 'https://aoi.app/terms',
      supportUrl: 'mailto:support@aoi.app',
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
        EXPO_PUBLIC_PRIVACY_URL: 'http://aoi.app/privacy',
        EXPO_PUBLIC_TERMS_URL: 'javascript:alert(1)',
        EXPO_PUBLIC_SUPPORT_URL: 'aoi.app/support',
      })
    ).toEqual({ privacyUrl: null, termsUrl: null, supportUrl: null });
  });
});

const GOOD_CLIENT_ENV = {
  EXPO_PUBLIC_AUTH_STUB_MODE: 'false',
  EXPO_PUBLIC_AUTH_API_BASE_URL: 'https://api.aoi.app',
  EXPO_PUBLIC_GOOGLE_CLIENT_ID: 'web-id',
  EXPO_PUBLIC_GOOGLE_IOS_CLIENT_ID: 'ios-id',
  EXPO_PUBLIC_REVENUECAT_IOS_KEY: 'appl_key',
  EXPO_PUBLIC_REVENUECAT_ANDROID_KEY: 'goog_key',
  EXPO_PUBLIC_PRIVACY_URL: 'https://aoi.app/privacy',
  EXPO_PUBLIC_TERMS_URL: 'https://aoi.app/terms',
  EXPO_PUBLIC_SUPPORT_URL: 'mailto:support@aoi.app',
};

const GOOD_WORKER_ENV = {
  BETTER_AUTH_SECRET: 'a-very-long-random-secret-value-123',
  GOOGLE_CLIENT_ID: 'web-id',
  GOOGLE_CLIENT_SECRET: 'web-secret',
  APPLE_CLIENT_ID: 'services-id',
  APPLE_CLIENT_SECRET: 'es256-secret',
  APPLE_APP_BUNDLE_ID: 'com.ekasc.aoi',
  REVENUECAT_WEBHOOK_SECRET: 'a-very-long-random-webhook-secret-1',
  CORS_ORIGIN: 'https://aoi.app',
  APP_BASE_URL: 'https://api.aoi.app',
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

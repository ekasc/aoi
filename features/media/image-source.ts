import { getApiBaseUrl, getApiTokens } from '@/features/api-client';
import { resolveStagedUri } from '@/features/composer/staged-uri';

export type AppImageSource = {
  uri: string;
  headers?: Record<string, string>;
};

function isProtectedMediaPath(value: string): boolean {
  return value.startsWith('/v1/media/') && value.includes('/object?variant=');
}

function configuredApiOrigin(): { baseUrl: string; origin: string } | null {
  try {
    const baseUrl = getApiBaseUrl().replace(/\/$/, '');
    if (!baseUrl) return null;
    return { baseUrl, origin: new URL(baseUrl).origin };
  } catch {
    return null;
  }
}

/**
 * Builds an image source without ever sending session credentials to a public
 * URL. Protected media paths are resolved only against the configured API
 * origin and receive the current in-memory access token.
 */
export function imageSourceForUri(value: string): AppImageSource | null {
  if (!value) return null;
  if (isProtectedMediaPath(value)) {
    const api = configuredApiOrigin();
    const accessToken = getApiTokens()?.accessToken;
    if (!api || !accessToken) return null;
    return {
      uri: `${api.baseUrl}${value}`,
      headers: { Authorization: `Bearer ${accessToken}` },
    };
  }

  if (/^https?:\/\//i.test(value)) {
    const api = configuredApiOrigin();
    try {
      const parsed = new URL(value);
      if (api && parsed.origin === api.origin && isProtectedMediaPath(parsed.pathname + parsed.search)) {
        const accessToken = getApiTokens()?.accessToken;
        if (!accessToken) return null;
        return { uri: value, headers: { Authorization: `Bearer ${accessToken}` } };
      }
    } catch {
      return null;
    }
    return { uri: value };
  }

  return { uri: resolveStagedUri(value) };
}

import { getAuthApiBaseUrl, isAuthStubMode } from '@/features/auth/auth-config';
import { getAuthApi } from '@/features/auth/auth-api';
import type { AuthSessionTokens } from '@/features/auth/types';

let currentTokens: AuthSessionTokens | null = null;

export function setApiTokens(tokens: AuthSessionTokens | null) {
  currentTokens = tokens;
}

export function getApiTokens() {
  return currentTokens;
}

export function getApiBaseUrl(): string {
  return getAuthApiBaseUrl();
}

export function isStubMode(): boolean {
  return isAuthStubMode();
}

async function refreshTokens(): Promise<boolean> {
  const tokens = currentTokens;
  if (!tokens?.refreshToken) return false;

  try {
    const authApi = getAuthApi();
    // The refresh endpoint is public (validates refresh token internally)
    const response = await fetch(`${getApiBaseUrl()}/v1/auth/refresh`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ refreshToken: tokens.refreshToken }),
    });

    if (!response.ok) return false;

    const data = await response.json();
    const newTokens: AuthSessionTokens = {
      accessToken: data.accessToken,
      refreshToken: data.refreshToken,
      expiresAt: new Date(Date.now() + data.expiresInSec * 1000).toISOString(),
    };
    setApiTokens(newTokens);
    return true;
  } catch {
    return false;
  }
}

export async function apiFetch<T>(
  path: string,
  options: RequestInit = {}
): Promise<T> {
  if (isStubMode()) {
    throw new Error('API client is in stub mode. Set EXPO_PUBLIC_AUTH_STUB_MODE=false');
  }

  const baseUrl = getApiBaseUrl();
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    ...(options.headers as Record<string, string>),
  };

  if (currentTokens?.accessToken) {
    headers['Authorization'] = `Bearer ${currentTokens.accessToken}`;
  }

  let response = await fetch(`${baseUrl}${path}`, {
    ...options,
    headers,
  });

  // If 401, try refreshing the token and retry once
  if (response.status === 401 && currentTokens?.refreshToken) {
    const refreshed = await refreshTokens();
    if (refreshed && currentTokens?.accessToken) {
      headers['Authorization'] = `Bearer ${currentTokens.accessToken}`;
      response = await fetch(`${baseUrl}${path}`, {
        ...options,
        headers,
      });
    }
  }

  if (!response.ok) {
    const errorBody = await response.json().catch(() => null);
    const message = errorBody?.error?.message ?? `Request failed: ${response.status}`;
    throw new Error(message);
  }

  return response.json() as Promise<T>;
}

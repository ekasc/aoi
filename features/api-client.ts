import { getAuthApiBaseUrl, isAuthStubMode } from '@/features/auth/auth-config';
import type { AuthSessionTokens } from '@/features/auth/types';

let currentTokens: AuthSessionTokens | null = null;
let tokenGeneration = 0;

export function setApiTokens(tokens: AuthSessionTokens | null) {
  currentTokens = tokens;
  tokenGeneration += 1;
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

/**
 * Refresh with a captured session snapshot. Publishes ONLY when the live
 * session is still the same object/generation (same-session refresh).
 * If the account switched while the refresh was in flight, the stale
 * result is dropped — never published, never retried.
 */
async function refreshWithCaptured(
  captured: AuthSessionTokens | null,
  capturedGeneration: number
): Promise<AuthSessionTokens | null> {
  if (!captured?.refreshToken) return null;
  if (currentTokens !== captured || tokenGeneration !== capturedGeneration) return null;
  try {
    // The refresh endpoint is public (validates refresh token internally).
    const response = await fetch(`${getApiBaseUrl()}/v1/auth/refresh`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ refreshToken: captured.refreshToken }),
    });
    if (!response.ok) return null;
    const data = await response.json();
    const newTokens: AuthSessionTokens = {
      accessToken: data.accessToken,
      refreshToken: data.refreshToken,
      expiresAt: new Date(Date.now() + data.expiresInSec * 1000).toISOString(),
    };
    // Same-session check: only the captured session may publish. A switch
    // during the await drops the stale result (never setApiTokens).
    if (currentTokens !== captured || tokenGeneration !== capturedGeneration) return null;
    setApiTokens(newTokens);
    return newTokens;
  } catch {
    return null;
  }
}

/**
 * Authenticated fetch with a generation-snapshotted Bearer token (+401
 * refresh-and-retry once for the SAME session only). The request captures
 * its tokens + generation up front; if the generation/identity changed
 * (account switch) before or during the refresh, it NEVER refreshes,
 * retries, or publishes — the original 401 is returned so an A request can
 * never replay on B credentials. Shared by JSON and binary reads.
 * Throws on stub mode and on non-OK statuses after the refresh attempt.
 */
async function authorizedFetch(path: string, options: RequestInit = {}): Promise<Response> {
  if (isStubMode()) {
    throw new Error('API client is in stub mode. Set EXPO_PUBLIC_AUTH_STUB_MODE=false');
  }

  const captured = currentTokens;
  const capturedGeneration = tokenGeneration;
  const baseUrl = getApiBaseUrl();
  const headers: Record<string, string> = {
    ...(options.headers as Record<string, string>),
  };

  if (captured?.accessToken) {
    headers['Authorization'] = `Bearer ${captured.accessToken}`;
  }

  let response = await fetch(`${baseUrl}${path}`, {
    ...options,
    headers,
  });

  // If 401, try refreshing the captured session and retry once — same
  // session only. Any generation drift aborts with zero further network.
  if (response.status === 401 && captured?.refreshToken) {
    if (currentTokens !== captured || tokenGeneration !== capturedGeneration) {
      return response;
    }
    const fresh = await refreshWithCaptured(captured, capturedGeneration);
    if (!fresh) return response;
    if (currentTokens !== fresh) return response;
    const retryHeaders: Record<string, string> = {
      ...(options.headers as Record<string, string>),
      Authorization: `Bearer ${fresh.accessToken}`,
    };
    response = await fetch(`${baseUrl}${path}`, {
      ...options,
      headers: retryHeaders,
    });
  }

  return response;
}

export async function apiFetch<T>(
  path: string,
  options: RequestInit = {}
): Promise<T> {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    ...(options.headers as Record<string, string>),
  };

  const response = await authorizedFetch(path, { ...options, headers });

  if (!response.ok) {
    const errorBody = await response.json().catch(() => null);
    const message = errorBody?.error?.message ?? `Request failed: ${response.status}`;
    const error = new Error(message) as Error & {
      status?: number;
      code?: string;
      details?: unknown;
    };
    error.status = response.status;
    // Machine-readable failure identity (e.g. LIMIT_EXCEEDED + LimitDetails)
    // so callers can intercept quota/product limits without parsing text.
    if (typeof errorBody?.error?.code === 'string') {
      error.code = errorBody.error.code;
    }
    if (errorBody?.error && 'details' in errorBody.error) {
      error.details = (errorBody.error as { details?: unknown }).details;
    }
    throw error;
  }

  return response.json() as Promise<T>;
}

export type ApiBytesResult = {
  bytes: Uint8Array;
  contentType: string | null;
  status: number;
};

/**
 * Authenticated binary read (media assets for keepsake staging). Same
 * Bearer behavior as apiFetch; the status travels on the error so callers
 * can report 401/403 honestly instead of pretending the asset succeeded.
 */
export async function apiFetchBytes(path: string): Promise<ApiBytesResult> {
  const response = await authorizedFetch(path);

  if (!response.ok) {
    const error = new Error(`Media request failed: ${response.status}`) as Error & {
      status?: number;
    };
    error.status = response.status;
    throw error;
  }

  const buffer = await response.arrayBuffer();
  const contentType = response.headers?.get?.('content-type') ?? null;
  return { bytes: new Uint8Array(buffer), contentType, status: response.status };
}

import { refreshResponseSchema } from '@aoi/shared';

import { getAuthApiBaseUrl, isAuthStubMode } from '@/features/auth/auth-config';
import type { AuthSessionTokens } from '@/features/auth/types';
import { withRequestDeadline } from '@/features/request-deadline';

let currentTokens: AuthSessionTokens | null = null;
let tokenGeneration = 0;
let unauthorizedHandler: (() => void) | null = null;

/** Session teardown for a dead refresh token. Set by SessionProvider. */
export function setUnauthorizedHandler(handler: (() => void) | null) {
  unauthorizedHandler = handler;
}

function notifyUnauthorized() {
  unauthorizedHandler?.();
}

// One refresh POST per refresh token, ever concurrently: the server treats a
// rotated-out refresh token presented twice as theft and revokes ALL of the
// user's sessions (packages/api/src/routes/auth.ts), so requests 401ing
// together must share one refresh, never race two.
const refreshInflight = new Map<string, Promise<AuthSessionTokens | null>>();

// The latest rotation this client performed: which refresh token it consumed
// and which tokens it produced. Lets a request whose 401 lands AFTER a
// rotation completed retry once with its own lineage — without this, every
// reload with an expired access token bricks a random panel ("Offline")
// until a manual retry.
let lastRotation: { fromRefreshToken: string; tokens: AuthSessionTokens } | null = null;

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
async function doRefresh(
  captured: AuthSessionTokens | null,
  capturedGeneration: number
): Promise<AuthSessionTokens | null> {
  if (!captured?.refreshToken) return null;
  if (currentTokens !== captured || tokenGeneration !== capturedGeneration) return null;
  try {
    // The refresh endpoint is public (validates refresh token internally).
    const data = await withRequestDeadline(async (signal) => {
      const response = await fetch(`${getApiBaseUrl()}/v1/auth/refresh`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ refreshToken: captured.refreshToken }),
        signal,
      });
      if (!response.ok) return null;
      return refreshResponseSchema.parse(await response.json());
    });
    if (!data) return null;
    const newTokens: AuthSessionTokens = {
      accessToken: data.accessToken,
      refreshToken: data.refreshToken,
      expiresAt: new Date(Date.now() + data.expiresInSec * 1000).toISOString(),
    };
    // Same-session check: only the captured session may publish. A switch
    // during the await drops the stale result (never setApiTokens).
    if (currentTokens !== captured || tokenGeneration !== capturedGeneration) return null;
    setApiTokens(newTokens);
    lastRotation = { fromRefreshToken: captured.refreshToken, tokens: newTokens };
    return newTokens;
  } catch {
    return null;
  }
}

/**
 * The single flight for one refresh-token lineage: concurrent 401s share
 * the first refresh instead of each POSTing (which the server reads as
 * token reuse and answers by revoking every session). Registration is
 * synchronous — no await sits between the miss and the set — so two
 * continuations cannot both start one.
 */
function startRefresh(
  captured: AuthSessionTokens,
  capturedGeneration: number
): Promise<AuthSessionTokens | null> {
  const refreshToken = captured.refreshToken;
  if (!refreshToken) return Promise.resolve(null);
  const running = refreshInflight.get(refreshToken);
  if (running) return running;
  const pending = doRefresh(captured, capturedGeneration);
  refreshInflight.set(refreshToken, pending);
  const cleanup = () => {
    if (refreshInflight.get(refreshToken) === pending) {
      refreshInflight.delete(refreshToken);
    }
  };
  pending.then(cleanup, cleanup);
  return pending;
}

/**
 * Authenticated fetch with a generation-snapshotted Bearer token (+401
 * refresh-and-retry once for the SAME session only). The request captures
 * its tokens + generation up front; if the generation/identity changed
 * (account switch) before or during the refresh, it NEVER refreshes,
 * retries, or publishes — the original 401 is returned so an A request can
 * never replay on B credentials. Concurrent 401s share one refresh flight
 * (the server revokes all sessions on refresh-token reuse), and a loser
 * whose 401 lands after our own rotation completed retries once with that
 * rotation's lineage. Shared by JSON and binary reads.
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
  if (options.signal?.aborted) throw options.signal.reason ?? new Error('Request cancelled');

  // If 401, refresh the captured lineage and retry once — same session
  // only. An account switch anywhere in the flight aborts with zero further
  // network, so an A request can never replay on B credentials.
  if (response.status === 401 && captured?.refreshToken) {
    // A refresh is already running for our lineage: join it instead of
    // POSTing a second one (the server revokes all sessions on reuse).
    // The shared tokens are provably ours, so liveness is reference
    // equality with them — not the capture (the winner's own publish
    // always drifts a joiner). Anything else means a switch intervened.
    const running = refreshInflight.get(captured.refreshToken);
    if (running) {
      const fresh = await running;
      if (!fresh || currentTokens !== fresh) return response;
      return retryWithToken(baseUrl, path, options, fresh.accessToken);
    }
    // No refresh running: start one only if the session hasn't moved under
    // us. A move means another account (or our own rotation, below).
    if (currentTokens !== captured || tokenGeneration !== capturedGeneration) {
      // ...unless the move WAS our own rotation completing first (the late
      // loser of a same-session race): then the live tokens are provably our
      // lineage — same refresh token in, current tokens out — so retry once.
      // A switch fails the identity half (live !== rotated) and still 401s.
      const rotated = lastRotation;
      if (
        rotated &&
        rotated.fromRefreshToken === captured.refreshToken &&
        currentTokens === rotated.tokens &&
        rotated.tokens.accessToken !== captured.accessToken
      ) {
        return retryWithToken(baseUrl, path, options, rotated.tokens.accessToken);
      }
      return response;
    }
    const fresh = await startRefresh(captured, capturedGeneration);
    if (!fresh) return response;
    if (currentTokens !== fresh) return response;
    return retryWithToken(baseUrl, path, options, fresh.accessToken);
  }

  return response;
}

function retryWithToken(
  baseUrl: string,
  path: string,
  options: RequestInit,
  accessToken: string
): Promise<Response> {
  if (options.signal?.aborted) throw options.signal.reason ?? new Error('Request cancelled');
  const retryHeaders: Record<string, string> = {
    ...(options.headers as Record<string, string>),
    Authorization: `Bearer ${accessToken}`,
  };
  return fetch(`${baseUrl}${path}`, {
    ...options,
    headers: retryHeaders,
  });
}

export async function apiFetch<T>(
  path: string,
  options: RequestInit = {}
): Promise<T> {
  return withRequestDeadline(
    (signal) => apiFetchJson<T>(path, { ...options, signal }),
    { signal: options.signal }
  );
}

async function apiFetchJson<T>(
  path: string,
  options: RequestInit
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
    if (error.status === 401) notifyUnauthorized();
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
  return withRequestDeadline((signal) => readApiBytes(path, signal));
}

async function readApiBytes(path: string, signal: AbortSignal): Promise<ApiBytesResult> {
  const response = await authorizedFetch(path, { signal });

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

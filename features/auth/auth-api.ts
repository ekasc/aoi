import { getAuthApiBaseUrl, isAuthStubMode } from './auth-config';
import { mockAuthApi } from './mock-auth-api';
import type {
  AppleIdTokenSignInRequest,
  AuthApi,
  AuthSessionPayload,
  GoogleIdTokenSignInRequest,
  IdTokenSignInResponse,
} from './types';

/**
 * Remote auth API — thin adapters over the worker's Better Auth-backed
 * `/v1/auth/*` endpoints (see `packages/api/src/routes/session-auth.ts`).
 *
 * The worker keeps the client's Bearer contract: sign-in returns
 * `{ accessToken, refreshToken, expiresInSec, user }` where the token is a
 * Better Auth session token. This adapter maps that to the app's
 * `{ user, tokens }` payload shape (expiresAt derived from expiresInSec).
 */
class RemoteAuthApi implements AuthApi {
  constructor(private readonly baseUrl: string) {}

  async signInWithAppleIdToken(input: AppleIdTokenSignInRequest) {
    return this.postIdTokenSignIn('/v1/auth/apple', input);
  }

  async signInWithGoogleIdToken(input: GoogleIdTokenSignInRequest) {
    return this.postIdTokenSignIn('/v1/auth/google', input);
  }

  private async postIdTokenSignIn(
    pathname: string,
    payload: AppleIdTokenSignInRequest | GoogleIdTokenSignInRequest
  ): Promise<AuthSessionPayload> {
    const response = await this.post<IdTokenSignInResponse>(pathname, payload);
    return {
      user: response.user,
      tokens: {
        accessToken: response.accessToken,
        refreshToken: response.refreshToken,
        expiresAt: new Date(Date.now() + response.expiresInSec * 1000).toISOString(),
      },
    };
  }

  async getSession(accessToken: string) {
    const response = await fetch(`${this.baseUrl}/v1/auth/session`, {
      method: 'GET',
      headers: {
        Authorization: `Bearer ${accessToken}`,
      },
    });

    if (!response.ok) {
      throw new Error('Unable to fetch session.');
    }

    const payload = (await response.json()) as { user: AuthSessionPayload['user'] };
    return payload.user;
  }

  async logout(accessToken: string, refreshToken?: string) {
    await fetch(`${this.baseUrl}/v1/auth/logout`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${accessToken}`,
      },
      body: JSON.stringify(
        refreshToken ? { refreshToken } : {}
      ),
    });
  }

  async deleteAccount(accessToken: string) {
    await fetch(`${this.baseUrl}/v1/auth/account`, {
      method: 'DELETE',
      headers: {
        Authorization: `Bearer ${accessToken}`,
      },
    });
  }

  private async post<T>(pathname: string, payload: unknown) {
    const response = await fetch(`${this.baseUrl}${pathname}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(payload),
    });

    if (!response.ok) {
      throw new Error(`Auth request failed: ${response.status}`);
    }

    return (await response.json()) as T;
  }
}

let authApi: AuthApi | null = null;

export function getAuthApi() {
  if (!authApi) {
    authApi = isAuthStubMode()
      ? mockAuthApi
      : new RemoteAuthApi(getAuthApiBaseUrl());
  }

  return authApi;
}

/** Test hook: inject a fake AuthApi (see tests/unit/session). */
export function setAuthApi(api: AuthApi | null) {
  authApi = api;
}

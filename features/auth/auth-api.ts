import { getAuthApiBaseUrl, isAuthStubMode } from './auth-config';
import { mockAuthApi } from './mock-auth-api';
import type {
  AuthApi,
  OAuthCallbackResponse,
  OAuthCallbackRequest,
  OAuthNativeCallbackRequest,
  OAuthStartRequest,
  SessionResponse,
} from './types';

class RemoteAuthApi implements AuthApi {
  constructor(private readonly baseUrl: string) {}

  async oauthStart(input: OAuthStartRequest) {
    return this.post<Awaited<ReturnType<AuthApi['oauthStart']>>>(
      '/v1/auth/oauth/start',
      input
    );
  }

  async oauthCallback(input: OAuthCallbackRequest) {
    const response = await this.post<OAuthCallbackResponse>(
      '/v1/auth/oauth/callback',
      input
    );

    return this.toAuthSessionPayload(response);
  }

  async oauthNativeCallback(input: OAuthNativeCallbackRequest) {
    const response = await this.post<OAuthCallbackResponse>(
      '/v1/auth/oauth/native/callback',
      input
    );

    return this.toAuthSessionPayload(response);
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

    const payload = (await response.json()) as SessionResponse;
    return payload.user;
  }

  async logout(accessToken: string, refreshToken?: string) {
    await fetch(`${this.baseUrl}/v1/auth/logout`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${accessToken}`,
      },
      body: JSON.stringify({
        refreshToken: refreshToken ?? '',
      }),
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

  private toAuthSessionPayload(input: OAuthCallbackResponse) {
    return {
      user: input.user,
      tokens: {
        accessToken: input.accessToken,
        refreshToken: input.refreshToken,
        expiresAt: new Date(Date.now() + input.expiresInSec * 1000).toISOString(),
      },
    };
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

export function setAuthApi(nextApi: AuthApi) {
  authApi = nextApi;
}

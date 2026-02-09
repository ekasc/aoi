import { getAuthApiBaseUrl, isAuthStubMode } from '@/features/auth/auth-config';
import { mockAuthApi } from '@/features/auth/mock-auth-api';
import type {
  AuthApi,
  OAuthCallbackRequest,
  OAuthStartRequest,
} from '@/features/auth/types';

class RemoteAuthApi implements AuthApi {
  constructor(private readonly baseUrl: string) {}

  async oauthStart(input: OAuthStartRequest) {
    return this.post<Awaited<ReturnType<AuthApi['oauthStart']>>>(
      '/v1/auth/oauth/start',
      input
    );
  }

  async oauthCallback(input: OAuthCallbackRequest) {
    return this.post<Awaited<ReturnType<AuthApi['oauthCallback']>>>(
      '/v1/auth/oauth/callback',
      input
    );
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

    return (await response.json()) as Awaited<ReturnType<AuthApi['getSession']>>;
  }

  async logout(accessToken: string) {
    await fetch(`${this.baseUrl}/v1/auth/logout`, {
      method: 'POST',
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

export function setAuthApi(nextApi: AuthApi) {
  authApi = nextApi;
}

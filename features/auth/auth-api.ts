import { getAuthApiBaseUrl, isAuthStubMode } from './auth-config';
import { mockAuthApi } from './mock-auth-api';
import type {
  AuthApi,
  AuthSessionPayload,
  WorkOSAuthorizeRequest,
  WorkOSCallbackRequest,
  WorkOSAppleNativeRequest,
} from './types';

class RemoteAuthApi implements AuthApi {
  constructor(private readonly baseUrl: string) {}

  async workosAuthorize(input: WorkOSAuthorizeRequest) {
    return this.post<Awaited<ReturnType<AuthApi['workosAuthorize']>>>(
      '/v1/auth/workos/authorize',
      input
    );
  }

  async workosCallback(input: WorkOSCallbackRequest) {
    return this.post<AuthSessionPayload>('/v1/auth/workos/callback', input);
  }

  async workosAppleNative(input: WorkOSAppleNativeRequest) {
    return this.post<AuthSessionPayload>('/v1/auth/workos/apple', input);
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

    const payload = (await response.json()) as AuthSessionPayload;
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

export function setAuthApi(nextApi: AuthApi) {
  authApi = nextApi;
}

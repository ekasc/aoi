import { afterEach, describe, expect, it, vi } from 'vitest';

import { startBoundaryServer, TOKEN_A, TOKEN_B, USER_A, SPACE_ID, NOW } from './helpers/http-harness';

let reset = () => {};
afterEach(() => {
  reset();
  vi.unstubAllEnvs();
});

describe('persistent sessions over real HTTP and D1', () => {
  it('keeps an old session and its space, then revokes only the requested account on global sign-out', async () => {
    const server = await startBoundaryServer();
    try {
      vi.stubEnv('EXPO_PUBLIC_AUTH_STUB_MODE', 'false');
      vi.stubEnv('EXPO_PUBLIC_AUTH_API_BASE_URL', server.baseUrl);
      const { apiFetch, setApiTokens, setUnauthorizedHandler } = await import('@/features/api-client');
      const { getAuthApi, setAuthApi } = await import('@/features/auth/auth-api');
      reset = () => {
        setApiTokens(null);
        setAuthApi(null);
        setUnauthorizedHandler(null);
      };
      server.harness.d1.runSync('update user_sessions set expires_at = ?', NOW - 365 * 24 * 60 * 60 * 1000);
      server.harness.d1.runSync(
        'insert into user_sessions (id, user_id, token, expires_at) values (?, ?, ?, ?)',
        'second-device', USER_A, 'second-device-token', NOW - 1,
      );
      server.harness.d1.runSync(
        'insert into push_tokens (id, user_id, expo_push_token) values (?, ?, ?)',
        'push-alice', USER_A, 'ExponentPushToken[aaaaaaaaaaaaaaaaaaaaaa]',
      );
      setApiTokens({ accessToken: TOKEN_A, refreshToken: TOKEN_A });
      expect((await getAuthApi().getSession(TOKEN_A)).id).toBe(USER_A);
      expect((await apiFetch<{ space: { id: string } }>('/v1/spaces/current')).space.id).toBe(SPACE_ID);

      await getAuthApi().revokeAllSessions(TOKEN_A);
      const revoked = vi.fn();
      setUnauthorizedHandler(revoked);
      await expect(apiFetch('/v1/spaces/current')).rejects.toMatchObject({ status: 401 });
      expect(revoked).toHaveBeenCalledOnce();
      const otherDevice = await fetch(`${server.baseUrl}/v1/auth/session`, {
        headers: { Authorization: 'Bearer second-device-token' },
      });
      expect(otherDevice.status).toBe(401);
      expect(server.harness.d1.rawDb.prepare('select count(*) as n from push_tokens where user_id = ?').get(USER_A)).toEqual({ n: 0 });

      setApiTokens({ accessToken: TOKEN_B, refreshToken: TOKEN_B });
      expect((await apiFetch<{ space: { id: string } }>('/v1/spaces/current')).space.id).toBe(SPACE_ID);
      server.harness.d1.runSync(
        'insert into user_sessions (id, user_id, token, expires_at) values (?, ?, ?, ?)',
        'signed-in-again', USER_A, 'new-session', NOW - 1,
      );
      setApiTokens({ accessToken: 'new-session', refreshToken: 'new-session' });
      expect((await apiFetch<{ space: { id: string } }>('/v1/spaces/current')).space.id).toBe(SPACE_ID);
    } finally {
      await server.close();
      server.harness.d1.rawDb.close();
    }
  });
});

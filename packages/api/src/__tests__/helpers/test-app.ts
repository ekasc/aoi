import { SignJWT } from 'jose';
import { app } from '../../app.js';

export const TEST_USER_ID = '00000000-0000-0000-0000-000000000001';
export const TEST_OTHER_USER_ID = '00000000-0000-0000-0000-000000000002';
export const TEST_SPACE_ID = '00000000-0000-0000-0000-000000000010';
export const TEST_MOMENT_ID = '00000000-0000-0000-0000-000000000020';
export const TEST_EVENT_ID = '00000000-0000-0000-0000-000000000030';

let _jwt: string | undefined;

export async function getTestJwt(userId = TEST_USER_ID): Promise<string> {
  if (userId === TEST_USER_ID && _jwt) return _jwt;
  const secret = new TextEncoder().encode('test-jwt-secret-for-testing');
  const token = await new SignJWT({ sub: userId, role: 'user' })
    .setProtectedHeader({ alg: 'HS256' })
    .setIssuedAt()
    .setExpirationTime('15m')
    .sign(secret);
  if (userId === TEST_USER_ID) _jwt = token;
  return token;
}

export function req(method: string, path: string, opts?: { jwt?: string; body?: unknown }): Request {
  return new Request(`http://localhost${path}`, {
    method,
    headers: {
      'Content-Type': 'application/json',
      ...(opts?.jwt ? { Authorization: `Bearer ${opts.jwt}` } : {}),
    },
    body: opts?.body ? JSON.stringify(opts.body) : undefined,
  });
}

export { app };

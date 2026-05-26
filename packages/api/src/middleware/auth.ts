import { createMiddleware } from 'hono/factory';
import { verifyAccessToken, type AccessTokenPayload } from '../lib/jwt.js';
import { unauthorized } from '../lib/errors.js';

declare module 'hono' {
  interface ContextVariableMap {
    userId: string;
    tokenPayload: AccessTokenPayload;
  }
}

export const authMiddleware = createMiddleware(async (c, next) => {
  const authHeader = c.req.header('Authorization');
  if (!authHeader?.startsWith('Bearer ')) {
    throw unauthorized('Missing or invalid Authorization header');
  }

  const token = authHeader.slice(7);
  try {
    const payload = await verifyAccessToken(token);
    c.set('userId', payload.sub);
    c.set('tokenPayload', payload);
    await next();
  } catch {
    throw unauthorized('Invalid or expired access token');
  }
});

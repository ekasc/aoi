import { SignJWT, jwtVerify, type JWTPayload } from 'jose';

const getSecret = () => {
  const secret = process.env.JWT_SECRET;
  if (!secret) {
    throw new Error('JWT_SECRET environment variable is required');
  }
  return new TextEncoder().encode(secret);
};

export type AccessTokenPayload = {
  sub: string;        // user id
  role: string;       // always 'user' for now
} & JWTPayload;

export type RefreshTokenPayload = {
  sub: string;        // user id
  jti: string;        // session id (token id)
} & JWTPayload;

export function signAccessToken(userId: string): Promise<string> {
  return new SignJWT({ sub: userId, role: 'user' })
    .setProtectedHeader({ alg: 'HS256' })
    .setIssuedAt()
    .setExpirationTime('15m')
    .sign(getSecret());
}

export function signRefreshToken(userId: string, sessionId: string): Promise<string> {
  return new SignJWT({ sub: userId, jti: sessionId })
    .setProtectedHeader({ alg: 'HS256' })
    .setIssuedAt()
    .setExpirationTime('30d')
    .sign(getSecret());
}

export async function verifyAccessToken(token: string): Promise<AccessTokenPayload> {
  const { payload } = await jwtVerify(token, getSecret(), {
    algorithms: ['HS256'],
  });
  return payload as AccessTokenPayload;
}

export async function verifyRefreshToken(token: string): Promise<RefreshTokenPayload> {
  const { payload } = await jwtVerify(token, getSecret(), {
    algorithms: ['HS256'],
  });
  return payload as RefreshTokenPayload;
}

import { Hono } from 'hono';
import type { Context } from 'hono';
import { HTTPException } from 'hono/http-exception';
import { z } from 'zod';
import { zValidator } from '@hono/zod-validator';
import { eq, and, isNull } from 'drizzle-orm';
import { db } from '../db/index.js';
import { users, authAccounts, userSessions, userPreferences } from '../db/schema.js';
import { signAccessToken, signRefreshToken, verifyRefreshToken } from '../lib/jwt.js';
import { hashToken } from '../lib/crypto.js';
import { unauthorized, notFound, badRequest, internal } from '../lib/errors.js';
import { userRowToApi } from '../lib/db.js';
import { authMiddleware } from '../middleware/auth.js';
import { rateLimit } from '../middleware/rate-limit.js';
import {
  getAuthorizationUrl,
  authenticateWithCode,
  authenticateWithAppleNative,
} from '../lib/workos-auth.js';

const auth = new Hono();

// Rate limiting for auth endpoints
const authRateLimit = rateLimit({
  max: 10,
  windowSec: 60,
  keyFn: (c) =>
    c.req.header('cf-connecting-ip') ??
    c.req.header('x-forwarded-for') ??
    c.req.header('x-real-ip') ??
    'unknown',
});

// ── WorkOS Authorize ──────────────────────────────────────────────────────
// Generates a WorkOS authorization URL for the given provider.

const workosAuthorizeSchema = z.object({
  provider: z.string().min(1),
  redirectUri: z.string(),
});

auth.post('/v1/auth/workos/authorize', authRateLimit, zValidator('json', workosAuthorizeSchema), async (c) => {
  const { provider, redirectUri } = c.req.valid('json');

  const authorizationUrl = await getAuthorizationUrl(provider, redirectUri);

  return c.json({ authorizationUrl });
});

// ── WorkOS Callback ────────────────────────────────────────────────────────
// Exchanges a WorkOS authorization code for user profile and session tokens.

const workosCallbackSchema = z.object({
  code: z.string().min(1),
});

auth.post('/v1/auth/workos/callback', authRateLimit, zValidator('json', workosCallbackSchema), async (c) => {
  const { code } = c.req.valid('json');

  const { user: workosUser, accessToken: workosAccessToken, refreshToken: workosRefreshToken } =
    await authenticateWithCode(code);

  return handleOAuthUser(
    c,
    'google',
    workosUser.id,
    workosUser.email,
    workosUser.displayName,
    workosUser.avatarUrl,
  );
});

// ── WorkOS Apple Native ─────────────────────────────────────────────────────
// Authenticates with Apple native sign-in via WorkOS.

const workosAppleSchema = z.object({
  idToken: z.string().min(1),
  nonce: z.string().min(1),
  displayName: z.string().optional(),
});

auth.post('/v1/auth/workos/apple', authRateLimit, zValidator('json', workosAppleSchema), async (c) => {
  const { idToken, nonce, displayName } = c.req.valid('json');

  const { user: workosUser, accessToken: workosAccessToken, refreshToken: workosRefreshToken } =
    await authenticateWithAppleNative(idToken, nonce);

  return handleOAuthUser(
    c,
    'apple',
    workosUser.id,
    workosUser.email,
    displayName || workosUser.displayName,
    workosUser.avatarUrl,
  );
});

// ── Session (GET) ─────────────────────────────────────────────────────────

auth.get('/v1/auth/session', authMiddleware, async (c) => {
  const userId = c.var.userId;

  const [user] = await db
    .select()
    .from(users)
    .where(and(eq(users.id, userId), isNull(users.deletedAt)))
    .limit(1);

  if (!user) {
    throw notFound('User not found');
  }

  return c.json({
    authenticated: true,
    user: userRowToApi(user),
    expiresAt: c.var.tokenPayload.exp
      ? new Date((c.var.tokenPayload.exp as number) * 1000).toISOString()
      : new Date(Date.now() + 15 * 60 * 1000).toISOString(),
  });
});

// ── Refresh Token ────────────────────────────────────────────────────────

const refreshSchema = z.object({
  refreshToken: z.string().min(1),
});

auth.post('/v1/auth/refresh', authRateLimit, zValidator('json', refreshSchema), async (c) => {
  const { refreshToken } = c.req.valid('json');

  try {
    const payload = await verifyRefreshToken(refreshToken);
    const sessionId = payload.jti;
    const userId = payload.sub;

    const [session] = await db
      .select()
      .from(userSessions)
      .where(eq(userSessions.id, sessionId))
      .limit(1);

    if (!session) {
      throw unauthorized('Session not found or revoked');
    }

    if (session.revokedAt) {
      await db
        .update(userSessions)
        .set({ revokedAt: new Date() })
        .where(and(eq(userSessions.userId, userId), isNull(userSessions.revokedAt)));

      throw unauthorized('Session has been revoked due to suspected token theft');
    }

    // The stored hash must match the presented token exactly. A mismatch means
    // a rotated-out token is being replayed — treat it as theft and revoke all
    // of the user's sessions.
    if (hashToken(refreshToken) !== session.refreshTokenHash) {
      await db
        .update(userSessions)
        .set({ revokedAt: new Date() })
        .where(and(eq(userSessions.userId, userId), isNull(userSessions.revokedAt)));

      throw unauthorized('Refresh token mismatch; all sessions revoked');
    }

    if (new Date() > session.expiresAt) {
      throw unauthorized('Session expired');
    }

    await db
      .update(userSessions)
      .set({ revokedAt: new Date() })
      .where(eq(userSessions.id, sessionId));

    const newSessionId = crypto.randomUUID();
    const newAccessToken = await signAccessToken(userId);
    const signedRefreshToken = await signRefreshToken(userId, newSessionId);

    await db.insert(userSessions).values({
      id: newSessionId,
      userId,
      refreshTokenHash: hashToken(signedRefreshToken),
      expiresAt: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
    });

    return c.json({
      accessToken: newAccessToken,
      refreshToken: signedRefreshToken,
      expiresInSec: 900,
    });
  } catch (err) {
    if (err instanceof HTTPException) {
      throw err;
    }
    throw unauthorized('Invalid refresh token');
  }
});

// ── Logout ───────────────────────────────────────────────────────────────

const logoutSchema = z.object({
  refreshToken: z.string().optional(),
});

auth.post('/v1/auth/logout', authMiddleware, zValidator('json', logoutSchema), async (c) => {
  const userId = c.var.userId;
  const { refreshToken } = c.req.valid('json');

  if (refreshToken) {
    try {
      const payload = await verifyRefreshToken(refreshToken);
      const sessionId = payload.jti;
      await db
        .update(userSessions)
        .set({ revokedAt: new Date() })
        .where(and(eq(userSessions.id, sessionId), eq(userSessions.userId, userId)));
    } catch {
      // If refresh token is invalid, still proceed with logout
    }
  } else {
    await db
      .update(userSessions)
      .set({ revokedAt: new Date() })
      .where(and(eq(userSessions.userId, userId), isNull(userSessions.revokedAt)));
  }

  return c.json({ ok: true });
});

// ── Delete Account ────────────────────────────────────────────────────────

auth.delete('/v1/auth/account', authMiddleware, async (c) => {
  const userId = c.var.userId;

  await db
    .update(users)
    .set({ deletedAt: new Date() })
    .where(eq(users.id, userId));

  await db
    .update(userSessions)
    .set({ revokedAt: new Date() })
    .where(and(eq(userSessions.userId, userId), isNull(userSessions.revokedAt)));

  return c.json({ ok: true });
});

// ── Shared Logic ─────────────────────────────────────────────────────────

async function handleOAuthUser(
  c: Context,
  provider: 'apple' | 'google',
  providerSubject: string,
  email: string,
  displayName: string,
  avatarUrl?: string,
) {
  const [existingAccount] = await db
    .select()
    .from(authAccounts)
    .where(
      and(eq(authAccounts.provider, provider), eq(authAccounts.providerSubject, providerSubject))
    )
    .limit(1);

  let userId: string;

  if (existingAccount) {
    userId = existingAccount.userId;
  } else {
    const [existingUser] = await db
      .select()
      .from(users)
      .where(eq(users.email, email))
      .limit(1);

    if (existingUser) {
      userId = existingUser.id;
    } else {
      const [newUser] = await db
        .insert(users)
        .values({
          email,
          displayName,
          avatarUrl: avatarUrl ?? null,
        })
        .returning();

      userId = newUser.id;

      await db.insert(userPreferences).values({
        userId,
        themeId: 'sunset-shore',
      }).onConflictDoNothing();
    }

    await db.insert(authAccounts).values({
      userId,
      provider,
      providerSubject,
    });
  }

  const [userRow] = await db
    .select()
    .from(users)
    .where(eq(users.id, userId))
    .limit(1);

  if (!userRow) {
    throw internal('User creation failed');
  }

  const sessionId = crypto.randomUUID();
  const accessToken = await signAccessToken(userId);
  const refreshToken = await signRefreshToken(userId, sessionId);

  await db.insert(userSessions).values({
    id: sessionId,
    userId,
    refreshTokenHash: hashToken(refreshToken),
    expiresAt: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
  });

  return c.json({
    accessToken,
    refreshToken,
    expiresInSec: 900,
    user: userRowToApi(userRow),
  });
}

export { auth };

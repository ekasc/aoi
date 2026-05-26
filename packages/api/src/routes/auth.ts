import { Hono } from 'hono';
import { z } from 'zod';
import { zValidator } from '@hono/zod-validator';
import { eq, and, isNull } from 'drizzle-orm';
import { db } from '../db/index.js';
import { users, authAccounts, userSessions, userPreferences, oauthStates } from '../db/schema.js';
import { signAccessToken, signRefreshToken, verifyRefreshToken } from '../lib/jwt.js';
import { hashToken, randomToken } from '../lib/crypto.js';
import { unauthorized, notFound, conflict, badRequest, internal } from '../lib/errors.js';
import { userRowToApi } from '../lib/db.js';
import { authMiddleware } from '../middleware/auth.js';

const auth = new Hono();

// ── OAuth Start ──────────────────────────────────────────────────────────
// Returns the authorization URL the client should open.
// In production, this would construct the proper Google/Apple OAuth URL.

const oauthStartSchema = z.object({
  provider: z.enum(['apple', 'google']),
  platform: z.enum(['ios', 'android']),
  clientId: z.string().min(1),
  redirectUri: z.string().url(),
  codeChallenge: z.string().optional(),
  codeChallengeMethod: z.literal('S256').optional(),
  nonce: z.string().optional(),
});

auth.post('/v1/auth/oauth/start', zValidator('json', oauthStartSchema), async (c) => {
  const { provider, platform, clientId, redirectUri, codeChallenge, codeChallengeMethod, nonce } = c.req.valid('json');

  const state = randomToken(16);
  const codeVerifier = randomToken(32);

  let authorizationUrl: string;

  if (provider === 'google') {
    const params = new URLSearchParams({
      client_id: clientId,
      redirect_uri: redirectUri,
      response_type: 'code',
      scope: 'openid email profile',
      state,
      ...(codeChallenge && { code_challenge: codeChallenge }),
      ...(codeChallengeMethod && { code_challenge_method: codeChallengeMethod }),
    });
    authorizationUrl = `https://accounts.google.com/o/oauth2/v2/auth?${params}`;
  } else {
    // Apple
    const params = new URLSearchParams({
      client_id: clientId,
      redirect_uri: redirectUri,
      response_type: 'code id_token',
      scope: 'name email',
      state,
      response_mode: 'form_post',
      ...(nonce && { nonce }),
    });
    authorizationUrl = `https://appleid.apple.com/auth/authorize?${params}`;
  }

  // Store state for callback validation
  await db.insert(oauthStates).values({
    state,
    provider,
    codeVerifier: codeVerifier ?? null,
    nonce: nonce ?? null,
    redirectUri,
    expiresAt: new Date(Date.now() + 10 * 60 * 1000), // 10 minutes
  });

  return c.json({
    authorizationUrl,
    state,
    codeVerifier,
  });
});

// ── OAuth Callback ───────────────────────────────────────────────────────

const oauthCallbackSchema = z.object({
  provider: z.enum(['apple', 'google']),
  platform: z.enum(['ios', 'android']),
  code: z.string().min(1),
  state: z.string().min(1),
  codeVerifier: z.string().optional(),
});

auth.post('/v1/auth/oauth/callback', zValidator('json', oauthCallbackSchema), async (c) => {
  const { provider, code, state, codeVerifier } = c.req.valid('json');

  // Validate state exists and hasn't been consumed
  const [storedState] = await db
    .select()
    .from(oauthStates)
    .where(and(eq(oauthStates.state, state), isNull(oauthStates.consumedAt)))
    .limit(1);

  if (!storedState) {
    throw badRequest('Invalid or expired OAuth state');
  }

  if (storedState.provider !== provider) {
    throw badRequest('OAuth provider mismatch');
  }

  if (new Date() > storedState.expiresAt) {
    throw badRequest('OAuth state has expired');
  }

  // Mark state as consumed (one-time use)
  await db
    .update(oauthStates)
    .set({ consumedAt: new Date() })
    .where(eq(oauthStates.state, state));

  // In production: exchange `code` with the provider's token endpoint
  // to get id_token, then verify id_token, extract sub + email + name.
  // Also validate codeVerifier against the stored one for PKCE.
  // For now, we simulate with the code as provider subject (stub).
  const providerSubject = `stub_${provider}_${code.slice(0, 8)}`;
  const email = `user_${code.slice(0, 6)}@example.com`;
  const displayName = provider === 'apple' ? 'Apple User' : 'Google User';

  return handleOAuthUser(c, provider, providerSubject, email, displayName);
});

// ── OAuth Native Callback (Apple iOS native) ─────────────────────────────

const oauthNativeCallbackSchema = z.object({
  provider: z.literal('apple'),
  platform: z.literal('ios'),
  idToken: z.string().min(1),
  nonce: z.string().min(1),
  displayName: z.string().optional(),
});

auth.post('/v1/auth/oauth/native/callback', zValidator('json', oauthNativeCallbackSchema), async (c) => {
  const { idToken, displayName } = c.req.valid('json');

  // In production: verify the idToken (Apple's JWT) using Apple's public keys.
  // Extract sub (user id from Apple), email, and name.
  // For now: stub with idToken prefix.
  const providerSubject = `apple_native_${idToken.slice(0, 12)}`;
  const email = `apple_user_${idToken.slice(0, 6)}@example.com`;
  const name = displayName ?? 'Apple User';

  return handleOAuthUser(c, 'apple', providerSubject, email, name);
});

// ── Session (GET) ───────────────────────────────────────────────────────

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

auth.post('/v1/auth/refresh', zValidator('json', refreshSchema), async (c) => {
  const { refreshToken } = c.req.valid('json');

  try {
    const payload = await verifyRefreshToken(refreshToken);
    const sessionId = payload.jti;
    const userId = payload.sub;

    // First, find session by ID regardless of revocation status
    const [session] = await db
      .select()
      .from(userSessions)
      .where(eq(userSessions.id, sessionId))
      .limit(1);

    if (!session) {
      throw unauthorized('Session not found or revoked');
    }

    // Token theft detection: if session is already revoked,
    // someone reused a rotated token — revoke ALL sessions for this user
    if (session.revokedAt) {
      await db
        .update(userSessions)
        .set({ revokedAt: new Date() })
        .where(and(eq(userSessions.userId, userId), isNull(userSessions.revokedAt)));

      throw unauthorized('Session has been revoked due to suspected token theft');
    }

    if (new Date() > session.expiresAt) {
      throw unauthorized('Session expired');
    }

    // Rotate refresh token: revoke old, create new session row
    await db
      .update(userSessions)
      .set({ revokedAt: new Date() })
      .where(eq(userSessions.id, sessionId));

    const newSessionId = crypto.randomUUID();
    const newRefreshToken = randomToken(32);
    const newRefreshHash = hashToken(newRefreshToken);

    await db.insert(userSessions).values({
      id: newSessionId,
      userId,
      refreshTokenHash: newRefreshHash,
      expiresAt: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
    });

    const newAccessToken = await signAccessToken(userId);
    const signedRefreshToken = await signRefreshToken(userId, newSessionId);

    return c.json({
      accessToken: newAccessToken,
      refreshToken: signedRefreshToken,
      expiresInSec: 900, // 15 min
    });
  } catch (err) {
    if (err instanceof Error && err.message.includes('Session')) {
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
      // Revoke just this session
      await db
        .update(userSessions)
        .set({ revokedAt: new Date() })
        .where(and(eq(userSessions.id, sessionId), eq(userSessions.userId, userId)));
    } catch {
      // If refresh token is invalid, still proceed with logout
    }
  } else {
    // Revoke ALL sessions for this user
    await db
      .update(userSessions)
      .set({ revokedAt: new Date() })
      .where(and(eq(userSessions.userId, userId), isNull(userSessions.revokedAt)));
  }

  return c.json({ ok: true });
});

// ── Shared Logic ─────────────────────────────────────────────────────────

async function handleOAuthUser(
  c: any,
  provider: 'apple' | 'google',
  providerSubject: string,
  email: string,
  displayName: string
) {
  // Check if this provider account already exists
  const [existingAccount] = await db
    .select()
    .from(authAccounts)
    .where(
      and(eq(authAccounts.provider, provider), eq(authAccounts.providerSubject, providerSubject))
    )
    .limit(1);

  let userId: string;
  let user: typeof users.$inferSelect;

  if (existingAccount) {
    userId = existingAccount.userId;
  } else {
    // Check if user with this email exists
    const [existingUser] = await db
      .select()
      .from(users)
      .where(eq(users.email, email))
      .limit(1);

    if (existingUser) {
      userId = existingUser.id;
    } else {
      // Create new user
      const [newUser] = await db
        .insert(users)
        .values({
          email,
          displayName,
        })
        .returning();

      userId = newUser.id;

      // Create default preferences
      await db.insert(userPreferences).values({
        userId,
        themeId: 'sunset-shore',
      }).onConflictDoNothing();
    }

    // Link provider account
    await db.insert(authAccounts).values({
      userId,
      provider,
      providerSubject,
    });
  }

  // Fetch user
  const [userRow] = await db
    .select()
    .from(users)
    .where(eq(users.id, userId))
    .limit(1);

  if (!userRow) {
    throw internal('User creation failed');
  }

  // Create session
  const sessionId = crypto.randomUUID();
  const refreshTokenRaw = randomToken(32);
  const refreshTokenHash = hashToken(refreshTokenRaw);

  await db.insert(userSessions).values({
    id: sessionId,
    userId,
    refreshTokenHash,
    expiresAt: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
  });

  const accessToken = await signAccessToken(userId);
  const refreshToken = await signRefreshToken(userId, sessionId);

  return c.json({
    accessToken,
    refreshToken,
    expiresInSec: 900,
    user: userRowToApi(userRow),
  });
}

export { auth };

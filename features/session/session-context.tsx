import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type PropsWithChildren,
} from 'react';
import * as SecureStore from 'expo-secure-store';

import { getAuthApi } from '@/features/auth/auth-api';
import { isAuthStubMode } from '@/features/auth/auth-config';
import { setApiTokens } from '@/features/api-client';
import { getLocalStressConfig } from '@/features/dev/local-stress-config';
import {
  OAuthClientError,
  signInWithOAuthProvider,
} from '@/features/auth/oauth-client';
import { unregisterPushToken } from '@/features/push/push-api';
import type {
  SessionContextValue,
  SessionStatus,
  SessionTokens,
  SessionUser,
} from '@/features/session/types';

const SESSION_STORAGE_KEY = 'aoi.session.v1';

type StoredSession = {
  user: SessionUser;
  tokens: SessionTokens;
};

function isValidStoredSession(value: unknown): value is StoredSession {
  if (!value || typeof value !== 'object') {
    return false;
  }

  const candidate = value as Partial<StoredSession>;

  return Boolean(
    candidate.user?.id &&
      candidate.user?.email &&
      candidate.user?.displayName &&
      candidate.tokens?.accessToken
  );
}

function parseStoredSession(rawValue: string) {
  try {
    const parsedValue: unknown = JSON.parse(rawValue);

    if (isValidStoredSession(parsedValue)) {
      return parsedValue;
    }

    return null;
  } catch {
    return null;
  }
}

/**
 * Whether a failed session check means the stored credentials are dead.
 * Only an explicit 401 discards: network failures, server hiccups, and
 * unparseable bodies keep the stored session (fail open — a missed 401
 * retries next launch, but wrongly deleted credentials strand a valid
 * sign-in and force a fresh login).
 */
function isSessionRejected(error: unknown): boolean {
  if (error instanceof TypeError) {
    return false;
  }
  const status = (error as { status?: unknown } | null)?.status;
  return status === 401;
}

/**
 * Exported for dev-preview routes, which provide seed values directly
 * (headless environments have no SecureStore, so the real provider can
 * never sign in there). Never used by app UI.
 */
export const SessionContext = createContext<SessionContextValue | undefined>(undefined);

export function SessionProvider({ children }: PropsWithChildren) {
  const authApi = useMemo(() => getAuthApi(), []);
  const [status, setStatus] = useState<SessionStatus>('loading');
  const [isHydrated, setIsHydrated] = useState(false);
  const [user, setUser] = useState<SessionUser | null>(null);
  const [tokens, setTokens] = useState<SessionTokens | null>(null);

  const clearStoredSession = useCallback(async () => {
    if (getLocalStressConfig()) return;
    await SecureStore.deleteItemAsync(SESSION_STORAGE_KEY);
  }, []);

  const persistSession = useCallback(
    async (nextUser: SessionUser, nextTokens: SessionTokens) => {
      if (getLocalStressConfig()) return;
      const serializedSession = JSON.stringify({
        user: nextUser,
        tokens: nextTokens,
      } satisfies StoredSession);
      await SecureStore.setItemAsync(SESSION_STORAGE_KEY, serializedSession);
    },
    []
  );

  const restoreSession = useCallback(async () => {
    setStatus('loading');

    try {
      const stress = getLocalStressConfig();
      const storedRawSession = stress ? JSON.stringify(stress.session) : await SecureStore.getItemAsync(SESSION_STORAGE_KEY);

      if (!storedRawSession) {
        setUser(null);
        setTokens(null);
        setApiTokens(null);
        setStatus('signed_out');
        return;
      }

      const storedSession = parseStoredSession(storedRawSession);

      if (!storedSession) {
        await clearStoredSession();
        setUser(null);
        setTokens(null);
        setApiTokens(null);
        setStatus('signed_out');
        return;
      }

      let resolvedUser = storedSession.user;

      try {
        resolvedUser = await authApi.getSession(storedSession.tokens.accessToken);
      } catch (err) {
        if (!isAuthStubMode() && isSessionRejected(err)) {
          // Only sign out on dead credentials (explicit 401), not network
          // failures or server hiccups — fetch throws TypeError for network
          // errors; auth API throws status-carrying Errors for HTTP errors.
          await clearStoredSession();
          setUser(null);
          setTokens(null);
          setApiTokens(null);
          setStatus('signed_out');
          return;
        }
        // Network error, server hiccup, or stub: stay signed in with the
        // stored user data.
      }

      setUser(resolvedUser);
      setTokens(storedSession.tokens);
      // Token plumbing: the api-client reads module state, so every session
      // restore must republish the tokens or remote calls go out without an
      // Authorization header (was: setApiTokens never called → remote mode
      // always 401d).
      setApiTokens(storedSession.tokens);
      setStatus('signed_in');
      await persistSession(resolvedUser, storedSession.tokens);
    } catch {
      setUser(null);
      setTokens(null);
      setApiTokens(null);
      setStatus('signed_out');
      await clearStoredSession().catch(() => {});
    } finally {
      setIsHydrated(true);
    }
  }, [authApi, clearStoredSession, persistSession]);

  useEffect(() => {
    // Hydrates external SecureStore/API state, rather than deriving state from props.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void restoreSession();
  }, [restoreSession]);

  const signInWithProvider = useCallback(
    async (provider: 'apple' | 'google') => {
      // Stay on the current status while the native sheet is up: flipping to
      // 'loading' unmounts the landing behind the sheet (every route guard
      // renders null while loading) and replays the boot sequence on
      // resolution. The buttons already show progress via activeProvider.
      try {
        const authSession = await signInWithOAuthProvider(provider, authApi);

        setUser(authSession.user);
        setTokens(authSession.tokens);
        // Token plumbing: publish the fresh tokens to the api-client so
        // remote calls carry the Bearer header.
        setApiTokens(authSession.tokens);
        setStatus('signed_in');
        await persistSession(authSession.user, authSession.tokens);

        return { ok: true };
      } catch (error) {
        setUser(null);
        setTokens(null);
        setApiTokens(null);
        setStatus('signed_out');

        if (error instanceof OAuthClientError && error.code === 'cancelled') {
          return { ok: false, error: 'Sign in was canceled.' };
        }

        return { ok: false, error: 'Unable to sign in right now. Please try again.' };
      }
    },
    [authApi, persistSession]
  );

  const signOut = useCallback(async () => {
    const accessToken = tokens?.accessToken;
    const refreshToken = tokens?.refreshToken;

    // Single choke point for letting go of this device's push registration —
    // every sign-out path goes through here, while the access token is still
    // valid. Failures are swallowed inside (tender-error policy), and the
    // call is idempotent, so a repeated sign-out never double-unregisters.
    await unregisterPushToken().catch(() => {});

    if (accessToken) {
      await authApi.logout(accessToken, refreshToken).catch(() => {});
    }

    await clearStoredSession().catch(() => {});
    setUser(null);
    setTokens(null);
    setApiTokens(null);
    setStatus('signed_out');
  }, [authApi, clearStoredSession, tokens?.accessToken, tokens?.refreshToken]);

  const deleteAccountFn = useCallback(async () => {
    const accessToken = tokens?.accessToken;

    // The local teardown is what makes the deletion irreversible on this
    // device, so it waits for the server to confirm. Clearing the session in a
    // `finally` ran on rejection too: the app guard redirects on `signed_out`,
    // so a failed delete ejected the user *and* unmounted the account screen
    // before it could say anything, leaving the account alive behind a phone
    // that looked signed out. A failure now propagates instead, so the caller
    // keeps the user in place and renders the error. Dropping this device's
    // session is still one tap away on the account screen's Sign out row, so a
    // user who cannot reach the server is never trapped.
    if (accessToken) {
      await authApi.deleteAccount(accessToken);
    }

    await clearStoredSession().catch(() => {});
    setUser(null);
    setTokens(null);
    setApiTokens(null);
    setStatus('signed_out');
  }, [authApi, clearStoredSession, tokens?.accessToken]);

  const value = useMemo<SessionContextValue>(
    () => ({
      status,
      isHydrated,
      user,
      tokens,
      signInWithProvider,
      restoreSession,
      signOut,
      deleteAccount: deleteAccountFn,
    }),
    [
      isHydrated,
      restoreSession,
      signInWithProvider,
      signOut,
      deleteAccountFn,
      status,
      tokens,
      user,
    ]
  );

  return (
    <SessionContext.Provider value={value}>{children}</SessionContext.Provider>
  );
}

export function useSession() {
  const context = useContext(SessionContext);

  if (!context) {
    throw new Error('useSession must be used within SessionProvider');
  }

  return context;
}

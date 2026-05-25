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
import {
  OAuthClientError,
  signInWithOAuthProvider,
} from '@/features/auth/oauth-client';
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

const SessionContext = createContext<SessionContextValue | undefined>(undefined);

export function SessionProvider({ children }: PropsWithChildren) {
  const authApi = useMemo(() => getAuthApi(), []);
  const [status, setStatus] = useState<SessionStatus>('loading');
  const [isHydrated, setIsHydrated] = useState(false);
  const [user, setUser] = useState<SessionUser | null>(null);
  const [tokens, setTokens] = useState<SessionTokens | null>(null);

  const clearStoredSession = useCallback(async () => {
    await SecureStore.deleteItemAsync(SESSION_STORAGE_KEY);
  }, []);

  const persistSession = useCallback(
    async (nextUser: SessionUser, nextTokens: SessionTokens) => {
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
      const storedRawSession = await SecureStore.getItemAsync(SESSION_STORAGE_KEY);

      if (!storedRawSession) {
        setUser(null);
        setTokens(null);
        setStatus('signed_out');
        return;
      }

      const storedSession = parseStoredSession(storedRawSession);

      if (!storedSession) {
        await clearStoredSession();
        setUser(null);
        setTokens(null);
        setStatus('signed_out');
        return;
      }

      let resolvedUser = storedSession.user;

      try {
        resolvedUser = await authApi.getSession(storedSession.tokens.accessToken);
      } catch (err) {
        if (!isAuthStubMode()) {
          // Only sign out on auth errors (non-ok HTTP response), not network failures
          // fetch throws TypeError for network errors; auth API throws Error for HTTP errors
          const isNetworkError = err instanceof TypeError;
          if (!isNetworkError) {
            await clearStoredSession();
            setUser(null);
            setTokens(null);
            setStatus('signed_out');
            return;
          }
          // Network error: stay signed in with stored user data
        }
      }

      setUser(resolvedUser);
      setTokens(storedSession.tokens);
      setStatus('signed_in');
      await persistSession(resolvedUser, storedSession.tokens);
    } catch {
      setUser(null);
      setTokens(null);
      setStatus('signed_out');
      await clearStoredSession().catch(() => {});
    } finally {
      setIsHydrated(true);
    }
  }, [authApi, clearStoredSession, persistSession]);

  useEffect(() => {
    void restoreSession();
  }, [restoreSession]);

  const signInWithProvider = useCallback(
    async (provider: 'apple' | 'google') => {
      setStatus('loading');

      try {
        const authSession = await signInWithOAuthProvider(provider, authApi);

        setUser(authSession.user);
        setTokens(authSession.tokens);
        setStatus('signed_in');
        await persistSession(authSession.user, authSession.tokens);

        return { ok: true };
      } catch (error) {
        setUser(null);
        setTokens(null);
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

    if (accessToken) {
      await authApi.logout(accessToken, refreshToken).catch(() => {});
    }

    await clearStoredSession().catch(() => {});
    setUser(null);
    setTokens(null);
    setStatus('signed_out');
  }, [authApi, clearStoredSession, tokens?.accessToken, tokens?.refreshToken]);

  const value = useMemo<SessionContextValue>(
    () => ({
      status,
      isHydrated,
      user,
      tokens,
      signInWithProvider,
      restoreSession,
      signOut,
    }),
    [
      isHydrated,
      restoreSession,
      signInWithProvider,
      signOut,
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

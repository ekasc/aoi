import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type PropsWithChildren,
} from 'react';
import * as SecureStore from 'expo-secure-store';
import { AppState } from 'react-native';

import { getAuthApi } from '@/features/auth/auth-api';
import { getApiTokens, setApiTokens, setTokensRefreshedHandler, setUnauthorizedHandler } from '@/features/api-client';
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

  if (!('user' in value) || !value.user || typeof value.user !== 'object' ||
      !('tokens' in value) || !value.tokens || typeof value.tokens !== 'object') return false;
  const { user, tokens } = value;
  return 'id' in user && typeof user.id === 'string' && user.id.length > 0 &&
    'email' in user && typeof user.email === 'string' &&
    'displayName' in user && typeof user.displayName === 'string' &&
    (!('avatarUrl' in user) || user.avatarUrl === undefined || typeof user.avatarUrl === 'string') &&
    'accessToken' in tokens && typeof tokens.accessToken === 'string' && tokens.accessToken.length > 0 &&
    (!('refreshToken' in tokens) || tokens.refreshToken === undefined || typeof tokens.refreshToken === 'string') &&
    (!('expiresAt' in tokens) || tokens.expiresAt === undefined || typeof tokens.expiresAt === 'string');
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
  const activeUser = useRef<SessionUser | null>(null);
  const lifecycle = useRef(0);
  const restoreBlocked = useRef(false);
  const storageQueue = useRef(Promise.resolve());

  const store = useCallback((operation: () => Promise<void>) => {
    const pending = storageQueue.current.then(operation);
    storageQueue.current = pending.catch(() => {});
    return pending;
  }, []);

  const clearStoredSession = useCallback(async () => {
    if (getLocalStressConfig()) return;
    const attempt = lifecycle.current;
    await store(async () => {
      if (attempt === lifecycle.current) await SecureStore.deleteItemAsync(SESSION_STORAGE_KEY);
    });
  }, [store]);

  const persistSession = useCallback(
    async (nextUser: SessionUser, nextTokens: SessionTokens) => {
      if (getLocalStressConfig()) return;
      const attempt = lifecycle.current;
      const serializedSession = JSON.stringify({
        user: nextUser,
        tokens: nextTokens,
      } satisfies StoredSession);
      await store(async () => {
        if (attempt === lifecycle.current) await SecureStore.setItemAsync(SESSION_STORAGE_KEY, serializedSession);
      });
    },
    [store]
  );

  const endSession = useCallback(async (reason: 'local' | 'revoked' = 'local') => {
    const attempt = ++lifecycle.current;
    const previousUser = activeUser.current;
    const previousTokens = getApiTokens();
    restoreBlocked.current = false;
    activeUser.current = null;
    setApiTokens(null);
    try {
      await clearStoredSession();
    } catch (error) {
      if (reason === 'local') {
        if (attempt === lifecycle.current) {
          activeUser.current = previousUser;
          setApiTokens(previousTokens);
        }
        throw error;
      }
      // A confirmed revocation cannot be undone by a local keychain failure.
    }
    if (attempt !== lifecycle.current) return;
    setUser(null);
    setTokens(null);
    setStatus('signed_out');
    setIsHydrated(true);
  }, [clearStoredSession]);

  const restoreSession = useCallback(async () => {
    const attempt = ++lifecycle.current;
    restoreBlocked.current = false;

    try {
      const stress = getLocalStressConfig();
      const liveTokens = getApiTokens();
      const liveSession = activeUser.current && liveTokens
        ? { user: activeUser.current, tokens: liveTokens }
        : null;
      const storedRawSession = liveSession
        ? JSON.stringify(liveSession)
        : stress ? JSON.stringify(stress.session)
        : process.env.EXPO_OS === 'web' ? null
        : await SecureStore.getItemAsync(SESSION_STORAGE_KEY);
      if (attempt !== lifecycle.current) return;

      if (!storedRawSession) {
        setUser(null);
        setTokens(null);
        setApiTokens(null);
        setStatus('signed_out');
        return;
      }

      const storedSession = parseStoredSession(storedRawSession);

      if (!storedSession) {
        // Leave unreadable credentials on disk so a later retry can recover them.
        setUser(null);
        setTokens(null);
        setApiTokens(null);
        setStatus('signed_out');
        return;
      }

      activeUser.current = storedSession.user;
      setUser(storedSession.user);
      setTokens(storedSession.tokens);
      setApiTokens(storedSession.tokens);
      setStatus('signed_in');
      setIsHydrated(true);

      try {
        const resolvedUser = await authApi.getSession(storedSession.tokens.accessToken);
        if (attempt !== lifecycle.current) return;
        activeUser.current = resolvedUser;
        setUser(resolvedUser);
        const liveTokens = getApiTokens();
        if (liveTokens) {
          setTokens(liveTokens);
          await persistSession(resolvedUser, liveTokens);
        }
      } catch {
        // Failed validation or metadata persistence must not erase the last login.
      }
    } catch {
      if (attempt === lifecycle.current && !activeUser.current) restoreBlocked.current = true;
    } finally {
      if (attempt === lifecycle.current && !restoreBlocked.current) setIsHydrated(true);
    }
  }, [authApi, persistSession]);

  useEffect(() => {
    // Hydrates external SecureStore/API state, rather than deriving state from props.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void restoreSession();
  }, [restoreSession]);

  useEffect(() => {
    const subscription = AppState.addEventListener('change', (next) => {
      // Keychain access can fail while the phone is locked. Retry after unlock.
      if (next === 'active' && restoreBlocked.current) void restoreSession();
    });
    return () => subscription.remove();
  }, [restoreSession]);

  useLayoutEffect(() => {
    setUnauthorizedHandler(() => {
      void endSession('revoked');
    });
    setTokensRefreshedHandler(async (nextTokens) => {
      const currentUser = activeUser.current;
      const attempt = lifecycle.current;
      if (!currentUser) return;
      await persistSession(currentUser, nextTokens);
      if (attempt === lifecycle.current) setTokens(nextTokens);
    });
    return () => {
      lifecycle.current += 1;
      setUnauthorizedHandler(null);
      setTokensRefreshedHandler(null);
    };
  }, [endSession, persistSession]);

  const signInWithProvider = useCallback(
    async (provider: 'apple' | 'google') => {
      const attempt = ++lifecycle.current;
      // Stay on the current status while the native sheet is up: flipping to
      // 'loading' unmounts the landing behind the sheet (every route guard
      // renders null while loading) and replays the boot sequence on
      // resolution. The buttons already show progress via activeProvider.
      try {
        const authSession = await signInWithOAuthProvider(provider, authApi);
        if (attempt !== lifecycle.current) return { ok: false, error: 'Sign in was canceled.' };

        // Persist before publishing the signed-in state. Route guards react to
        // the status change immediately; if storage then failed, the app would
        // navigate into the authenticated tree and fall back out of it.
        await persistSession(authSession.user, authSession.tokens);
        if (attempt !== lifecycle.current) return { ok: false, error: 'Sign in was canceled.' };

        activeUser.current = authSession.user;
        setUser(authSession.user);
        setTokens(authSession.tokens);
        // Token plumbing: publish the fresh tokens to the api-client so
        // remote calls carry the Bearer header.
        setApiTokens(authSession.tokens);
        setStatus('signed_in');
        setIsHydrated(true);

        return { ok: true };
      } catch (error) {
        if (error instanceof OAuthClientError && error.code === 'cancelled') {
          return { ok: false, error: 'Sign in was canceled.' };
        }

        return { ok: false, error: 'Unable to sign in right now. Please try again.' };
      }
    },
    [authApi, persistSession]
  );

  const signOut = useCallback(async () => {
    const attempt = ++lifecycle.current;

    // This device's registration must be removed before its credential is revoked.
    const pushToken = await unregisterPushToken().catch(() => undefined);
    if (attempt !== lifecycle.current) return;

    const { accessToken, refreshToken } = getApiTokens() ?? {};
    let revoked = false;
    if (accessToken) {
      revoked = await authApi.logout(accessToken, refreshToken, pushToken).then(() => true, () => false);
    }

    if (attempt !== lifecycle.current) return;
    await endSession(revoked ? 'revoked' : 'local');
  }, [authApi, endSession]);

  const signOutEverywhere = useCallback(async () => {
    const attempt = lifecycle.current;
    const accessToken = getApiTokens()?.accessToken;

    if (!accessToken) {
      throw new Error('Not signed in.');
    }
    await authApi.revokeAllSessions(accessToken);
    if (attempt !== lifecycle.current) return;

    await endSession('revoked');
  }, [authApi, endSession]);

  const deleteAccountFn = useCallback(async () => {
    const attempt = lifecycle.current;
    const accessToken = getApiTokens()?.accessToken;

    // The local teardown is what makes the deletion irreversible on this
    // device, so it waits for the server to confirm. Clearing the session in a
    // `finally` ran on rejection too: the app guard redirects on `signed_out`,
    // so a failed delete ejected the user *and* unmounted the account screen
    // before it could say anything, leaving the account alive behind a phone
    // that looked signed out. A failure now propagates instead, so the caller
    // keeps the user in place and renders the error. Dropping this device's
    // session is still one tap away on the account screen's Sign out row, so a
    // user who cannot reach the server is never trapped.
    if (!accessToken) throw new Error('Not signed in.');
    await authApi.deleteAccount(accessToken);
    if (attempt !== lifecycle.current) return;

    await endSession('revoked');
  }, [authApi, endSession]);

  const value = useMemo<SessionContextValue>(
    () => ({
      status,
      isHydrated,
      user,
      tokens,
      signInWithProvider,
      restoreSession,
      signOut,
      signOutEverywhere,
      deleteAccount: deleteAccountFn,
    }),
    [
      isHydrated,
      restoreSession,
      signInWithProvider,
      signOut,
      signOutEverywhere,
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

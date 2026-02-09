import type {
  AuthProvider,
  AuthSessionTokens,
  AuthSessionUser,
} from '@/features/auth/types';

export type SessionStatus = 'loading' | 'signed_out' | 'signed_in';

export type SessionUser = AuthSessionUser;
export type SessionTokens = AuthSessionTokens;

export type SignInResult = {
  ok: boolean;
  error?: string;
};

export type SessionContextValue = {
  status: SessionStatus;
  isHydrated: boolean;
  user: SessionUser | null;
  tokens: SessionTokens | null;
  signInWithProvider: (provider: AuthProvider) => Promise<SignInResult>;
  restoreSession: () => Promise<void>;
  signOut: () => Promise<void>;
};

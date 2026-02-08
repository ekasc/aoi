import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useState,
  type PropsWithChildren,
} from 'react';

import { createMockUser, MOCK_VERIFY_CODE } from '@/features/session/mock-auth';
import type {
  SessionContextValue,
  SessionStatus,
  SessionUser,
  VerifyCodeResult,
} from '@/features/session/types';

const SessionContext = createContext<SessionContextValue | undefined>(undefined);

export function SessionProvider({ children }: PropsWithChildren) {
  const [status, setStatus] = useState<SessionStatus>('signed_out');
  const [user, setUser] = useState<SessionUser | null>(null);
  const [pendingEmail, setPendingEmail] = useState<string | null>(null);

  const signInStart = useCallback((email: string) => {
    setPendingEmail(email.trim().toLowerCase());
  }, []);

  const verifyCode = useCallback(
    (code: string): VerifyCodeResult => {
      if (!pendingEmail) {
        return { ok: false, error: 'Start with your email first.' };
      }

      if (code.trim() !== MOCK_VERIFY_CODE) {
        return { ok: false, error: 'Incorrect code. Use 111111 for now.' };
      }

      const nextUser = createMockUser(pendingEmail);
      setUser(nextUser);
      setStatus('signed_in');
      setPendingEmail(null);
      return { ok: true };
    },
    [pendingEmail]
  );

  const signOut = useCallback(() => {
    setUser(null);
    setPendingEmail(null);
    setStatus('signed_out');
  }, []);

  const value = useMemo<SessionContextValue>(
    () => ({
      status,
      user,
      pendingEmail,
      signInStart,
      verifyCode,
      signOut,
    }),
    [pendingEmail, signInStart, signOut, status, user, verifyCode]
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

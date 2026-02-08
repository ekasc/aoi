export type SessionStatus = 'signed_out' | 'signed_in';

export type SessionUser = {
  id: string;
  email: string;
  displayName: string;
};

export type VerifyCodeResult = {
  ok: boolean;
  error?: string;
};

export type SessionContextValue = {
  status: SessionStatus;
  user: SessionUser | null;
  pendingEmail: string | null;
  signInStart: (email: string) => void;
  verifyCode: (code: string) => VerifyCodeResult;
  signOut: () => void;
};

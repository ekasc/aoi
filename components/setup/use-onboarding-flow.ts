import { useCallback, useRef, useState } from 'react';
import { useRouter } from 'expo-router';

import type { SessionUser } from '@/features/session/types';
import { useSession } from '@/features/session/session-context';
import { isInviteCodeFormat, normalizeInviteCode } from '@/features/space/invite-code';
import { useSpace } from '@/features/space/space-context';

// Post-auth entry: the ONLY pre-Story state is a Space of your own or a
// joined one. Names, dates, photos, and first memories are contextual
// later (Space surface, Story empty state) — never blockers here.
export type OnboardingStep = 'welcome' | 'join';

/** Internal default — never presented as setup homework. */
const DEFAULT_SPACE_NAME = 'Our space';

export type OnboardingFlow = {
  step: OnboardingStep;
  goWelcome: () => void;
  goJoin: () => void;
  inviteCode: string;
  setInviteCode: (value: string) => void;
  isSubmitting: boolean;
  error: string;
  clearError: () => void;
  signOut: () => void;
  canJoin: boolean;
  submitCreate: () => void;
  submitJoin: () => void;
};

function getErrorMessage(value: unknown, fallback: string): string {
  if (value instanceof Error && value.message.trim()) return value.message;
  return fallback;
}

function deriveName(user: SessionUser | null): string {
  if (!user) return '';
  const displayName = user.displayName?.trim();
  if (displayName) return displayName;
  const email = user.email?.trim();
  if (email) {
    const localPart = email.split('@')[0];
    return localPart
      .split(/[._-]/)
      .map((word) => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase())
      .join(' ');
  }
  return '';
}

export function useOnboardingFlow(): OnboardingFlow {
  const router = useRouter();
  const { user, signOut } = useSession();
  const { space, createSpace, joinSpace } = useSpace();

  const [step, setStep] = useState<OnboardingStep>('welcome');
  const [inviteCode, setInviteCode] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState('');
  // Synchronous double-submit guard: state updates don't apply within
  // the same tick, so a rapid second tap would duplicate requests.
  const submittingRef = useRef(false);
  // Set once this flow instance has a Space — either freshly created here or
  // already present on resume. Retries must never issue a second createSpace
  // (the server partial unique is the backstop, not the plan).
  const spaceCreatedRef = useRef(false);

  const clearError = useCallback(() => {
    if (error) setError('');
  }, [error]);

  const goWelcome = useCallback(() => {
    clearError();
    setStep('welcome');
  }, [clearError]);

  const goJoin = useCallback(() => {
    clearError();
    setStep('join');
  }, [clearError]);

  const canJoin = isInviteCodeFormat(normalizeInviteCode(inviteCode));

  const enterStory = useCallback(() => {
    router.replace('/(app)/(tabs)/(memories)');
  }, [router]);

  const submitCreate = useCallback(async () => {
    if (!user) {
      router.replace('/(public)');
      return;
    }
    if (submittingRef.current) return;
    submittingRef.current = true;
    try {
      setIsSubmitting(true);
      clearError();
      // Resume-safe: an already-present Space is never recreated.
      if (!spaceCreatedRef.current && !space) {
        await createSpace({
          name: DEFAULT_SPACE_NAME,
          createdByUserId: user.id,
          yourName: deriveName(user),
        });
      }
      spaceCreatedRef.current = true;
      enterStory();
    } catch (caughtError) {
      setError(getErrorMessage(caughtError, 'Unable to create your space right now.'));
    } finally {
      submittingRef.current = false;
      setIsSubmitting(false);
    }
  }, [user, space, clearError, createSpace, enterStory, router]);

  const submitJoin = useCallback(async () => {
    if (!user) {
      router.replace('/(public)');
      return;
    }
    if (!canJoin) {
      setError('Enter a valid 6-character invite code.');
      return;
    }
    if (submittingRef.current) return;
    submittingRef.current = true;
    try {
      setIsSubmitting(true);
      clearError();
      await joinSpace({ userId: user.id, inviteCode: normalizeInviteCode(inviteCode) });
      enterStory();
    } catch (caughtError) {
      setError(getErrorMessage(caughtError, 'Unable to join with this invite code.'));
    } finally {
      submittingRef.current = false;
      setIsSubmitting(false);
    }
  }, [user, canJoin, inviteCode, clearError, joinSpace, enterStory, router]);

  return {
    step,
    goWelcome,
    goJoin,
    inviteCode,
    setInviteCode,
    isSubmitting,
    error,
    clearError,
    signOut,
    canJoin,
    submitCreate,
    submitJoin,
  };
}

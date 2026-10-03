import { useCallback, useRef, useState } from 'react';
import * as Clipboard from 'expo-clipboard';
import { useRouter } from 'expo-router';

import type { SessionUser } from '@/features/session/types';
import { useSession } from '@/features/session/session-context';
import {
  findInviteCode,
  isInviteCodeFormat,
  normalizeInviteCode,
} from '@/features/space/invite-code';
import { takeInvite } from '@/features/space/invite-handoff';
import type { PartnerName, PartnerNameProblem } from '@/features/space/partner-name';
import { checkPartnerName, spaceNameForPair } from '@/features/space/partner-name';
import { useSpace } from '@/features/space/space-context';

// Post-auth entry: the ONLY pre-Story state is a Space of your own or a
// joined one. The creator's title page (the two names, the start date, the
// cover photo) belongs here rather than later: the sky's calendar, the days
// together count, the question screen's tone and the keepsake's cover all read
// from it, and a relationship the app never dated has no timeline to draw.
// First memories stay contextual. They are the app's content, not its setup.
//
// `minted` and `joined` carry the result to Memories, which presents the
// invitation before revealing the feed.
export type OnboardingStep = 'welcome' | 'identity' | 'join' | 'minted' | 'joined';

export type OnboardingFlow = {
  step: OnboardingStep;
  goWelcome: () => void;
  goJoin: () => void;
  /** The creator's title page: the pair, the date, the cover. */
  goIdentity: () => void;
  /**
   * What the creator calls the other person, and the required field on the
   * title page. The pair is named or the space is not created: an unnamed
   * partner leaves every later screen with nothing to address.
   */
  partnerNameDraft: string;
  setPartnerNameDraft: (value: string) => void;
  /**
   * The typed name parsed into a `PartnerName`, or null while the field holds
   * something that is not a name. A branded type rather than a string, so no
   * caller can pass an empty one onward. The create reads this and nothing
   * else.
   */
  parsedPartnerName: PartnerName | null;
  /**
   * Why the name is not acceptable, or null when it is. Null until the reader
   * has actually tried to continue, so an untouched field never scolds; after
   * that it tracks every keystroke, so the message disappears the moment the
   * input becomes valid.
   */
  nameProblem: PartnerNameProblem | null;
  /**
   * The day the relationship started, which is the sky's calendar.
   *
   * Defaults to today rather than to null, and the field shows it, so the date
   * is never invented behind the reader's back: it is on screen, it is one tap
   * to change, and a null here means the sky loses its timeline entirely.
   */
  startDate: Date;
  setStartDate: (value: Date) => void;
  /** The space's cover photo, chosen on the title page. */
  photoUri: string | null;
  setPhotoUri: (uri: string | null) => void;
  inviteCode: string;
  setInviteCode: (value: string) => void;
  isSubmitting: boolean;
  error: string;
  clearError: () => void;
  signOut: () => void;
  canJoin: boolean;
  submitCreate: () => void;
  submitJoin: () => void;
  /** The code minted for a Space created on this screen. Empty otherwise. */
  mintedCode: string;
  /**
   * The other person's name, as this side should read it. Filled after a
   * join; the creator has nobody to name until someone arrives.
   */
  partnerName: string;
  /** The space's own name and picture, for the beat that shows it exists. */
  spaceName: string;
  spacePhotoUri: string | null;
  /** Fill the code field from the clipboard. False when nothing usable is there. */
  pasteCode: () => Promise<boolean>;
  /** Leave setup for Story. */
  enterStory: () => void;
  /**
   * True when a Space already exists and setup has nothing left to show here.
   * A Space minted on this screen never counts: its code has to be read
   * before the reader leaves.
   */
  skipToStory: boolean;
};

function getErrorMessage(value: unknown, fallback: string): string {
  if (value instanceof Error && value.message.trim()) return value.message;
  return fallback;
}

/** A local calendar day, never a UTC shift of one. */
function toDateKey(value: Date): string {
  const month = `${value.getMonth() + 1}`.padStart(2, '0');
  const day = `${value.getDate()}`.padStart(2, '0');
  return `${value.getFullYear()}-${month}-${day}`;
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

  // An invite link puts the reader on the join step with the code already in
  // the field. Read once, as initial state, rather than in an effect: a link is
  // a direction, not a value that should keep refilling a form the reader is
  // using, and there is no first frame in which the flow should show the fork
  // and then jump to join. Taking it here also consumes it, so a remount cannot
  // resurrect an invite that has already been acted on.
  const [invited] = useState(() => takeInvite());
  const [step, setStep] = useState<OnboardingStep>(invited ? 'join' : 'welcome');
  // The title page, collected before the create call so the code that follows
  // is addressed and the space is whole when it first exists. The draft is the
  // raw field text; `partnerName` below is the only thing the create reads.
  const [partnerNameDraft, setPartnerNameDraft] = useState('');
  // Set by a Continue pressed on a name that would not validate, and cleared by
  // the next keystroke. It decides *when* the field speaks, never *what* it
  // says: the reason and its wording come from checkPartnerName.
  const [createAttempted, setCreateAttempted] = useState(false);
  const [startDate, setStartDate] = useState<Date>(() => new Date());
  const [photoUri, setPhotoUri] = useState<string | null>(null);
  // What the space was actually made with, captured at the create rather than
  // read back from the space context: the context can lag the create, and the
  // preview's stub never populates it at all, so the beat that shows the space
  // exists would have had nothing to show.
  const [mintedIdentity, setMintedIdentity] = useState<{
    name: string;
    photoUri: string | null;
    /**
     * The other person, captured at the create. This used to be joined-only, so
     * a creator's own space arrived at Memories with nobody named, and the
     * share link and the empty feed both had to fall back to "your partner".
     */
    partnerName: string | null;
  }>({ name: '', photoUri: null, partnerName: null });
  const goIdentity = useCallback(() => setStep('identity'), []);
  const [inviteCode, setInviteCode] = useState(invited ?? '');
  const [mintedCode, setMintedCode] = useState('');
  const [joinedPartnerName, setJoinedPartnerName] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState('');
  // Synchronous double-submit guard: state updates don't apply within
  // the same tick, so a rapid second tap would duplicate requests.
  const submittingRef = useRef(false);
  // Set once this flow instance has a Space — either freshly created here or
  // already present on resume. Retries must never issue a second createSpace
  // (the server partial unique is the backstop, not the plan).
  const spaceCreatedRef = useRef(false);
  // True for the window in which a create is in flight. The Space provider
  // publishes its new space the moment the write lands, which would otherwise
  // let `skipToStory` redirect out of the beat before the code was ever seen.
  // State rather than a ref: this one is read during render, and a ref read
  // there is exactly the bug the rule exists to prevent.
  const [creating, setCreating] = useState(false);

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

  /**
   * Fill the code field from the clipboard.
   *
   * Only ever on a tap. Reading the pasteboard unprompted is both a privacy
   * smell and, on iOS 16 and later, a system prompt the reader did not ask
   * for; asking first turns the same read into something they did.
   */
  const pasteCode = useCallback(async () => {
    let text = '';
    try {
      text = (await Clipboard.getStringAsync()) ?? '';
    } catch {
      return false;
    }
    const found = findInviteCode(text);
    if (!found) {
      return false;
    }
    setInviteCode(found);
    clearError();
    return true;
  }, [clearError]);

  /**
   * The name the create will actually use, or null when the field holds
   * something that is not a name. This is the single gate: the submit reads
   * this, never the raw draft, so an unnamed space cannot be created by
   * accident and no caller has to remember to check.
   */
  const nameCheck = checkPartnerName(partnerNameDraft);
  const partnerName = nameCheck.ok ? nameCheck.name : null;
  // Silent until the reader has tried, then honest on every keystroke.
  const nameProblem = createAttempted && !nameCheck.ok ? nameCheck.problem : null;

  const setPartnerName = useCallback((value: string) => {
    setPartnerNameDraft(value);
    setCreateAttempted(false);
  }, []);

  const submitCreate = useCallback(async () => {
    if (!user) {
      router.replace('/(public)');
      return;
    }
    // Resume-safe first: a space that already exists was named on an earlier
    // run, so the gate is about minting, never about stranding a reader who
    // has already answered the question.
    if (spaceCreatedRef.current || space) {
      spaceCreatedRef.current = true;
      enterStory();
      return;
    }
    if (!partnerName) {
      // Not a dead button and not a silent refusal: the field is told which
      // rule it broke, so the reader knows what to do about it.
      setCreateAttempted(true);
      return;
    }
    if (submittingRef.current) return;
    submittingRef.current = true;
    try {
      setIsSubmitting(true);
      setCreating(true);
      clearError();
      setCreateAttempted(false);
      const you = deriveName(user);
      const spaceName = spaceNameForPair(you, partnerName);
      setMintedIdentity({ name: spaceName, photoUri, partnerName });
      const created = await createSpace({
        // Named for the pair, which is how the app already refers to one, so
        // naming the space costs no question of its own. `partnerName` is a
        // PartnerName here, so it cannot be the empty string.
        name: spaceName,
        createdByUserId: user.id,
        yourName: you,
        partnerName,
        relationshipStartDate: toDateKey(startDate),
        ...(photoUri ? { photoUri } : {}),
      });
      spaceCreatedRef.current = true;
      // The code is the whole point of creating: hold the screen on it rather
      // than dropping the reader into Story without ever seeing the thing they
      // now have to send their partner.
      setMintedCode(created.inviteCode);
      setStep('minted');
    } catch (caughtError) {
      setError(getErrorMessage(caughtError, 'Unable to create your space right now.'));
    } finally {
      submittingRef.current = false;
      setCreating(false);
      setIsSubmitting(false);
    }
  }, [user, space, clearError, createSpace, enterStory, router, partnerName, startDate, photoUri]);

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
      setCreating(true);
      clearError();
      const joined = await joinSpace({
        userId: user.id,
        inviteCode: normalizeInviteCode(inviteCode),
        // The server names the joiner from their account; the stub has no
        // account to read, so it is handed the name here.
        yourName: deriveName(user),
      });
      // Proof before arrival. The joiner typed six characters into a space
      // they had never seen; the least the screen owes them is who it belongs
      // to, before it hands over the keys.
      setJoinedPartnerName(joined.partnerName ?? '');
      setMintedIdentity({
        name: joined.name,
        photoUri: joined.photoUri ?? null,
        // For a joiner the other person is the creator, and the space is
        // already shared, so no invite goes out from this side.
        partnerName: null,
      });
      setStep('joined');
    } catch (caughtError) {
      setError(getErrorMessage(caughtError, 'Unable to join with this invite code.'));
    } finally {
      submittingRef.current = false;
      setCreating(false);
      setIsSubmitting(false);
    }
  }, [user, canJoin, inviteCode, clearError, joinSpace, router]);

  return {
    step,
    goWelcome,
    goJoin,
    goIdentity,
    partnerNameDraft,
    setPartnerNameDraft: setPartnerName,
    /** The name as typed, valid or not. `partnerName` is the parsed one. */
    parsedPartnerName: partnerName,
    nameProblem,
    startDate,
    setStartDate,
    photoUri,
    setPhotoUri,
    inviteCode,
    setInviteCode,
    isSubmitting,
    error,
    clearError,
    signOut,
    canJoin,
    submitCreate,
    submitJoin,
    mintedCode,
    partnerName: mintedIdentity.partnerName ?? joinedPartnerName,
    spaceName: mintedIdentity.name,
    spacePhotoUri: mintedIdentity.photoUri,
    pasteCode,
    enterStory,
    // A Space minted or joined here is never skipped past: both beats exist to
    // be read before the reader is handed the app.
    skipToStory:
      space !== null && !creating && step !== 'minted' && step !== 'joined',
  };
}

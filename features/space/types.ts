import type { PartnerName } from '@/features/space/partner-name';

export type SpaceStatus = 'none' | 'ready' | 'loading' | 'error';
export type SpaceMemberRole = 'you' | 'partner';

export type RelationshipSpace = {
  id: string;
  name: string;
  createdByUserId: string;
  yourName: string;
  /** Null until supplied (creation) or joined (server fills from account). */
  partnerName: string | null;
  /**
   * P3: optional at setup. Null/undefined means unset — never synthesize a
   * date. The live Worker still requires a valid date at create (deferred
   * backend alignment); the stub path and client model preserve absence.
   */
  relationshipStartDate: string | null;
  inviteCode: string;
  /**
   * True when another active member exists besides the viewer — the only
   * reliable joined signal (partnerName may be pre-join wording; inviteCode
   * goes quiet on expiry as well as on join).
   */
  partnerJoined: boolean;
  /**
   * Expiry of the presented invite code (ISO), or null when no live invite
   * is shown. Lets the UI state expiry truthfully.
   */
  inviteExpiresAt: string | null;
  photoUri?: string;
  createdAt: string;
  updatedAt: string;
};

export type CreateSpaceInput = {
  name: string;
  createdByUserId: string;
  yourName: string;
  /**
   * The other person, required. A branded type rather than a string so a
   * repository cannot be handed an empty one: every screen that greets the
   * partner needs a name, and an optional field is how a null got there.
   * Build it with `parsePartnerName`.
   */
  partnerName: PartnerName;
  /** Optional: omit when unset. Never synthesize (e.g. never today). */
  relationshipStartDate?: string | null;
  photoUri?: string;
};

export type JoinSpaceInput = {
  userId: string;
  inviteCode: string;
  /**
   * The joiner's own name.
   *
   * The server reads it from the account; the local stub has no account to
   * read, and the space it is joining was written from the other person's
   * side, so without this the joiner's copy would claim the creator's name as
   * their own.
   */
  yourName?: string;
};

export type UpdateSpaceInput = Partial<
  Pick<RelationshipSpace, 'name' | 'partnerName' | 'relationshipStartDate'>
>;

export type SpaceRepository = {
  getSpaceForUser: (userId: string) => Promise<RelationshipSpace | null>;
  createSpace: (input: CreateSpaceInput) => Promise<RelationshipSpace>;
  joinSpace: (input: JoinSpaceInput) => Promise<RelationshipSpace>;
  /** Creator-only fresh invite code (remote); stub returns the live code. */
  regenerateInvite: (userId: string) => Promise<string>;
  updateSpaceForUser: (
    userId: string,
    input: UpdateSpaceInput
  ) => Promise<RelationshipSpace | null>;
  clearSpaceForUser: (userId: string) => Promise<void>;
  leaveSpace: (userId: string) => Promise<void>;
};

export type SpaceContextValue = {
  status: SpaceStatus;
  space: RelationshipSpace | null;
  isHydrated: boolean;
  createSpace: (input: CreateSpaceInput) => Promise<RelationshipSpace>;
  joinSpace: (input: JoinSpaceInput) => Promise<RelationshipSpace>;
  updateSpace: (input: UpdateSpaceInput) => Promise<RelationshipSpace | null>;
  clearSpace: () => Promise<void>;
  leaveSpace: () => Promise<void>;
  /** Refresh the invite code (creator-only remote; stub returns live code). */
  regenerateInvite: () => Promise<string>;
  /**
   * Re-read the space from the repository.
   *
   * Hydration happens once per session, so without this the app keeps
   * believing whatever it read at launch: a partner who arrived while the app
   * was closed would not exist until the next relaunch.
   */
  refreshSpace: () => Promise<void>;
};

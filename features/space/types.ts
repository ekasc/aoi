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
  /** Optional: omit when the user leaves it blank. */
  partnerName?: string;
  /** Optional: omit when unset. Never synthesize (e.g. never today). */
  relationshipStartDate?: string | null;
  photoUri?: string;
};

export type JoinSpaceInput = {
  userId: string;
  inviteCode: string;
};

export type UpdateSpaceInput = Partial<
  Pick<RelationshipSpace, 'name' | 'partnerName' | 'relationshipStartDate'>
>;

export type ImportedMilestoneType = 'note' | 'milestone' | 'date' | 'goal';

export type ImportedMilestoneInput = {
  type: ImportedMilestoneType;
  title: string;
  body?: string;
  occurredAt: string;
  targetAt?: string | null;
};

export type ImportedMilestone = ImportedMilestoneInput & {
  id: string;
  createdAt: string;
};

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
  getImportedMilestonesForUser: (userId: string) => Promise<ImportedMilestone[]>;
  appendImportedMilestonesForUser: (
    userId: string,
    milestones: ImportedMilestone[]
  ) => Promise<ImportedMilestone[]>;
  clearImportedMilestonesForUser: (userId: string) => Promise<void>;
};

export type SpaceContextValue = {
  status: SpaceStatus;
  space: RelationshipSpace | null;
  importedMilestones: ImportedMilestone[];
  isHydrated: boolean;
  createSpace: (input: CreateSpaceInput) => Promise<RelationshipSpace>;
  joinSpace: (input: JoinSpaceInput) => Promise<RelationshipSpace>;
  updateSpace: (input: UpdateSpaceInput) => Promise<RelationshipSpace | null>;
  clearSpace: () => Promise<void>;
  leaveSpace: () => Promise<void>;
  /** Refresh the invite code (creator-only remote; stub returns live code). */
  regenerateInvite: () => Promise<string>;
  importMilestones: (
    inputs: ImportedMilestoneInput[]
  ) => Promise<ImportedMilestone[]>;
};

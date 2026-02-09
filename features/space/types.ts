export type SpaceStatus = 'none' | 'ready' | 'loading';
export type SpaceMemberRole = 'you' | 'partner';

export type RelationshipSpace = {
  id: string;
  name: string;
  createdByUserId: string;
  partnerName: string;
  relationshipStartDate: string;
  inviteCode: string;
  createdAt: string;
  updatedAt: string;
};

export type CreateSpaceInput = {
  name: string;
  createdByUserId: string;
  partnerName: string;
  relationshipStartDate: string;
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
  updateSpaceForUser: (
    userId: string,
    input: UpdateSpaceInput
  ) => Promise<RelationshipSpace | null>;
  clearSpaceForUser: (userId: string) => Promise<void>;
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
  importMilestones: (
    inputs: ImportedMilestoneInput[]
  ) => Promise<ImportedMilestone[]>;
};

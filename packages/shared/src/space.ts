export type SpaceMemberRole = 'you' | 'partner';
export type SpaceMemberState = 'active' | 'left';

export type Space = {
  id: string;
  name: string;
  createdByUserId: string;
  partnerName: string;
  relationshipStartDate: string;
  inviteCode: string;
  createdAt: string;
  updatedAt: string;
};

export type CreateSpaceRequest = {
  name: string;
  partnerName: string;
  relationshipStartDate: string;
};

export type CreateSpaceResponse = {
  space: Space;
  inviteCode: string;
};

export type JoinSpaceRequest = {
  inviteCode: string;
};

export type UpdateSpaceRequest = {
  name?: string;
  partnerName?: string;
  relationshipStartDate?: string;
};

export type ImportedMilestoneType = 'note' | 'milestone' | 'date' | 'goal';

export type ImportedMilestone = {
  id: string;
  type: ImportedMilestoneType;
  title: string;
  body?: string;
  occurredAt: string;
  targetAt?: string;
  createdAt: string;
};

export type CreateImportedMilestoneRequest = {
  type: ImportedMilestoneType;
  title: string;
  body?: string;
  occurredAt: string;
  targetAt?: string;
};

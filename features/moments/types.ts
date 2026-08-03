export type MomentType = 'note' | 'milestone' | 'date' | 'goal' | 'media' | 'trace';
export type MomentAuthorRole = 'you' | 'partner';
export type MomentTag = 'date-idea' | 'milestone' | 'inside-joke' | 'trip';

export type Moment = {
  id: string;
  type: MomentType;
  title: string;
  body: string;
  occurredAt: string;
  targetAt?: string | null;
  createdAt: string;
  updatedAt?: string;
  authorId: string;
  authorRole: MomentAuthorRole;
  authorName: string;
  mediaPreview?: string;
  audioUri?: string | null;
  tags?: MomentTag[];
};

export type CreateMomentInput = {
  type: MomentType;
  title?: string;
  body?: string;
  occurredAt?: string;
  targetAt?: string | null;
  authorId?: string;
  authorRole?: MomentAuthorRole;
  authorName?: string;
  mediaPreview?: string;
  audioUri?: string | null;
  tags?: MomentTag[];
};

export type UpdateMomentInput = {
  type?: MomentType;
  title?: string;
  body?: string;
  occurredAt?: string;
  targetAt?: string | null;
  mediaPreview?: string | null;
  audioUri?: string | null;
};

/**
 * Change-log entry for the space (mirrors @aoi/shared). Privacy rule:
 * fact + actor only — never moment content.
 */
export type SpaceActivityKind = 'moment_deleted' | 'moment_edited';

export type SpaceActivityItem = {
  id: string;
  kind: SpaceActivityKind;
  actorName: string;
  occurredAt: string;
};

export type SpaceActivityResponse = {
  activity: SpaceActivityItem[];
};

export type MomentsContextValue = {
  moments: Moment[];
  /** Recent space activity (tombstones etc.); last 7 days at most. */
  activity: SpaceActivityItem[];
  isLoading: boolean;
  error: string | null;
  addMoment: (input: CreateMomentInput) => Promise<void>;
  updateMoment: (momentId: string, patch: UpdateMomentInput) => Promise<void>;
  removeMoment: (momentId: string) => Promise<void>;
  /** Re-fetches moments + activity (remote mode); no-op in stub mode. */
  refresh: () => Promise<void>;
};

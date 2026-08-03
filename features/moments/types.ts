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

export type MomentsContextValue = {
  moments: Moment[];
  isLoading: boolean;
  error: string | null;
  addMoment: (input: CreateMomentInput) => Promise<void>;
  removeMoment: (momentId: string) => Promise<void>;
};

export type MomentType = 'note' | 'milestone' | 'date' | 'goal' | 'media';
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
  tags?: MomentTag[];
};

export type MomentsContextValue = {
  moments: Moment[];
  addMoment: (input: CreateMomentInput) => void;
  removeMoment: (momentId: string) => void;
};

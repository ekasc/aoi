export type MomentType = 'note' | 'milestone' | 'date' | 'goal' | 'media';
export type MomentAuthorRole = 'you' | 'partner';

export type Moment = {
  id: string;
  type: MomentType;
  title: string;
  body: string;
  occurredAt: string;
  createdAt: string;
  authorId: string;
  authorRole: MomentAuthorRole;
  authorName: string;
  mediaPreview?: string;
};

export type CreateMomentInput = {
  type: MomentType;
  title?: string;
  body?: string;
  occurredAt?: string;
  authorId?: string;
  authorRole?: MomentAuthorRole;
  authorName?: string;
  mediaPreview?: string;
};

export type MomentsContextValue = {
  moments: Moment[];
  addMoment: (input: CreateMomentInput) => void;
  removeMoment: (momentId: string) => void;
};

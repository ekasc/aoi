export type MomentType = 'note' | 'milestone' | 'date' | 'goal' | 'media' | 'trace';
export type MomentAuthorRole = 'you' | 'partner';

export type Moment = {
  id: string;
  type: MomentType;
  title: string;
  body: string;
  occurredAt: string;
  targetAt?: string | null;
  createdAt: string;
  updatedAt: string;
  authorId: string;
  authorRole: MomentAuthorRole;
  authorName: string;
  mediaPreview?: string | null;
  audioUri?: string | null;
};

export type CreateMomentRequest = {
  type: MomentType;
  title?: string;
  body?: string;
  occurredAt?: string;
  targetAt?: string | null;
  mediaPreview?: string | null;
  audioUri?: string | null;
};

export type UpdateMomentRequest = {
  type?: MomentType;
  title?: string;
  body?: string;
  occurredAt?: string;
  targetAt?: string | null;
  mediaPreview?: string | null;
  audioUri?: string | null;
};

export type MomentListResponse = {
  moments: Moment[];
  nextCursor?: string;
};

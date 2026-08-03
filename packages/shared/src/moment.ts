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
  /**
   * Per-request ownership signal: true only when the requesting user authored
   * the moment. Clients must gate edit/delete on this (never on authorRole
   * alone) and treat a missing value as "not own".
   */
  isOwn: boolean;
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

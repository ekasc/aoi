import type { MomentAttachment, MomentAttachmentInput } from '@aoi/shared';

export type { MomentAttachment, MomentAttachmentInput };

export type MomentType = 'note' | 'milestone' | 'date' | 'goal' | 'media' | 'trace';
export type MomentAuthorRole = 'you' | 'partner';
export type MomentTag = 'date-idea' | 'milestone' | 'inside-joke' | 'trip';

/**
 * Legacy creation placeholder for untitled memories. New moments store an
 * empty title instead; display layers treat this string as untitled too, so
 * old rows never print it.
 */
export const UNTITLED_MOMENT_TITLE = 'Untitled moment';

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
  /**
   * Per-request ownership signal from the API (author user id vs viewer).
   * Optional for locally constructed moments; unknown must mean "not own".
   */
  isOwn?: boolean;
  mediaPreview?: string | null;
  audioUri?: string | null;
  /**
   * Dev-preview-only video source. The production media pipeline is
   * image/audio only — video stays out until a privacy-stripping +
   * playback path exists — so this is populated exclusively by the dev
   * seed catalog and is never sent or returned by the API. When present,
   * it renders through VideoPlayer and wins the media slot over
   * `mediaPreview` (which then serves as the poster).
   */
  videoUri?: string | null;
  /**
   * Stable media object id (media_objects.id) when the moment carries
   * media. The API stores the id + a stable serve URL; clients must never
   * persist signed URLs. Unknown/missing ⇒ no media.
   */
  mediaId?: string | null;
  /**
   * Ordered attachments (image/audio only, max 10). Optional so legacy
   * fixtures stay compatible; the API always sends the array (default []).
   * New clients read attachments; legacy mediaPreview/audioUri/mediaId are
   * derived from the first image/audio for old clients.
   */
  attachments?: MomentAttachment[];
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
  mediaPreview?: string | null;
  audioUri?: string | null;
  mediaId?: string | null;
  /**
   * Ordered attachments (image/audio only, max 10, `{ mediaId, kind }` —
   * never device URIs/URLs). Omitted = legacy single-media path;
   * supplied (even `[]`) = the attachment set for the new moment.
   */
  attachments?: MomentAttachmentInput[];
  /**
   * Local-only attachment set. Stub mode uploads return no server media id,
   * so the ordered `attachments` contract cannot be satisfied — without this
   * every image after the first is dropped at create time. Carries device
   * URIs for local rendering only; never sent to the server (the transport
   * whitelists its fields).
   */
  localAttachments?: { kind: 'image' | 'audio'; url: string }[];
  /**
   * Idempotency key for create: a stable id derived from this draft. A
   * double-tap re-sends the same key and the server replays the first
   * result instead of creating a second moment.
   */
  clientId?: string;
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
  mediaId?: string | null;
  /**
   * Optional attachment replacement. Omitted = attachments untouched.
   * Supplied (including `[]` to clear) = atomically replace the set.
   */
  attachments?: MomentAttachmentInput[];
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
  /**
   * True while the server reports another moments page. Any screen may drive
   * pagination via loadMoreMoments; the cursor is shared, pages are bounded,
   * and exhausted cursors never refetch.
   */
  hasMoreMoments: boolean;
  /**
   * Why the last older page failed, if it did. Paging keeps the cursor so a
   * retry asks for the same page; without this, a failed page would look
   * exactly like a page that never arrived.
   */
  pagingError: string | null;
  /**
   * Fetches the next bounded page and appends it (deduped by id). Resolves
   * true while a further page may remain. No-op when exhausted or when a
   * page is already in flight. A failed page leaves the cursor unadvanced
   * so the next call retries the same page.
   */
  loadMoreMoments: () => Promise<boolean>;
  /**
   * Loads every goal moment (Plans-owned future goals), paging the
   * type-filtered read to completion. Independent of — and never advancing
   * — the Story cursor. Goals are few; the read stays bounded by goal
   * count, not archive size.
   */
  loadGoals: () => Promise<Moment[]>;
  /**
   * Loads every memory in an absolute [fromMs, toMs) chapter range, paging
   * internally until the range cursor exhausts (oldest-first). Independent
   * of — and never advancing — the Story cursor.
   */
  loadChapterRange: (fromMs: number, toMs: number) => Promise<Moment[]>;
  addMoment: (input: CreateMomentInput) => Promise<Moment>;
  updateMoment: (momentId: string, patch: UpdateMomentInput) => Promise<void>;
  removeMoment: (momentId: string) => Promise<void>;
  /** Re-fetches moments + activity (remote mode); no-op in stub mode. */
  refresh: () => Promise<void>;
};

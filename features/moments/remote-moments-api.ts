import { apiFetch } from '@/features/api-client';
import type { BucketSummary, TimelineResponse } from '@aoi/shared';
import type {
  CreateMomentInput,
  Moment,
  SpaceActivityResponse,
  UpdateMomentInput,
} from '@/features/moments/types';

export interface MomentListResponse {
  moments: Moment[];
  nextCursor?: string;
}

export async function fetchMoments(
  cursor?: string,
  limit = 20,
  range?: { fromMs?: number; toMs?: number; type?: string }
): Promise<MomentListResponse> {
  let path = `/v1/spaces/current/moments?limit=${limit}`;
  if (cursor) {
    path += `&cursor=${encodeURIComponent(cursor)}`;
  }
  if (range?.fromMs !== undefined) {
    path += `&fromMs=${range.fromMs}`;
  }
  if (range?.toMs !== undefined) {
    path += `&toMs=${range.toMs}`;
  }
  if (range?.type !== undefined) {
    path += `&type=${encodeURIComponent(range.type)}`;
  }
  return apiFetch<MomentListResponse>(path);
}

/**
 * Bounded chapter-discovery summary over client-computed absolute bounds
 * (no moment bodies). One request for up to 24 buckets + explicit hasOlder.
 */
export async function fetchBucketSummary(
  buckets: { fromMs: number; toMs: number }[]
): Promise<{ buckets: BucketSummary[]; hasOlder: boolean }> {
  const encoded = buckets.map((bucket) => `${bucket.fromMs}:${bucket.toMs}`).join(',');
  return apiFetch<{ buckets: BucketSummary[]; hasOlder: boolean }>(
    `/v1/spaces/current/moments/summary?buckets=${encodeURIComponent(encoded)}`
  );
}

export async function createMoment(input: CreateMomentInput): Promise<Moment> {
  return apiFetch<Moment>('/v1/spaces/current/moments', {
    method: 'POST',
    body: JSON.stringify({
      type: input.type,
      title: input.title,
      body: input.body,
      occurredAt: input.occurredAt,
      targetAt: input.targetAt ?? null,
      mediaPreview: input.mediaPreview ?? null,
      audioUri: input.audioUri ?? null,
      mediaId: input.mediaId ?? null,
      // Ordered attachments (image/audio only, max 10, `{ mediaId, kind }`).
      // Omitted = legacy single-media path; supplied = the attachment set.
      // The server re-derives legacy mediaPreview/audioUri/mediaId from the
      // first image/audio for old clients.
      ...(input.attachments !== undefined ? { attachments: input.attachments } : {}),
      // Draft-derived idempotency key: a double-tap replays the first
      // result server-side instead of creating a second moment.
      clientId: input.clientId,
    }),
  });
}

export async function updateMoment(
  momentId: string,
  input: UpdateMomentInput
): Promise<Moment> {
  return apiFetch<Moment>(`/v1/moments/${momentId}`, {
    method: 'PATCH',
    body: JSON.stringify({
      type: input.type,
      title: input.title,
      body: input.body,
      occurredAt: input.occurredAt,
      targetAt: input.targetAt,
      mediaPreview: input.mediaPreview,
      audioUri: input.audioUri,
      mediaId: input.mediaId,
      // Omitted = attachments untouched; supplied (even `[]`) = replace.
      ...(input.attachments !== undefined ? { attachments: input.attachments } : {}),
    }),
  });
}

export async function deleteMoment(momentId: string): Promise<void> {
  await apiFetch(`/v1/moments/${momentId}`, {
    method: 'DELETE',
  });
}

export async function fetchActivity(): Promise<SpaceActivityResponse> {
  return apiFetch<SpaceActivityResponse>('/v1/spaces/current/activity');
}

/**
 * Bidirectional chronological timeline (chat-style, latest at bottom).
 * Separate from the legacy newest-first list so old clients never regress:
 * ascending (occurredAt, id), bounded window around the server-computed
 * FIRST unread (or latest when fully read). Cursors are opaque
 * `occurredAtMs|id`; before/after are mutually exclusive.
 */
export async function fetchTimeline(options?: {
  before?: string;
  after?: string;
  anchor?: string;
  limit?: number;
}): Promise<TimelineResponse> {
  const limit = Math.min(Math.max(options?.limit ?? 30, 1), 100);
  const params = new URLSearchParams();
  params.set('limit', String(limit));
  if (options?.before) {
    params.set('before', options.before);
  }
  if (options?.after) {
    params.set('after', options.after);
  }
  if (options?.anchor) {
    params.set('anchor', options.anchor);
  }
  return apiFetch<TimelineResponse>(
    `/v1/spaces/current/moments/timeline?${params.toString()}`
  );
}

/**
 * Mark moments read for the viewer. Viewer-scoped, partner-only,
 * idempotent; own/deleted/goal/outside-space ids are silently skipped
 * server-side. Small bounded batch (1..100 uuids). Never enqueues a
 * notification and never surfaces read receipts to the partner UI.
 */
export async function markMomentsRead(momentIds: string[]): Promise<{ ok: true }> {
  return apiFetch<{ ok: true }>('/v1/spaces/current/moments/read', {
    method: 'POST',
    body: JSON.stringify({ momentIds }),
  });
}
